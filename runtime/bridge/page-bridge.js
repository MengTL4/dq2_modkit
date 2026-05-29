(function () {
  if (window.__codexLocalTrainerBridge) return;

  const bridge = {
    version: "0.2.9",
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    processed: Object.create(null),
    originals: Object.create(null),
    options: {
      expRate: 1,
      goldRate: 1,
      dropRate: 1,
      skillRate: 1,
      noSkillCost: false
    },
    rateDepth: 0,
    suppressRates: 0,
    noCostDepth: 0,
    suppressNoCost: 0,
    noCostBaselines: Object.create(null),
    skillProgressBaselines: Object.create(null),
    rateStats: Object.create(null),
    battleStats: Object.create(null),
    hookTargets: [],
    hooksPatched: false,
    lastError: null
  };
  window.__codexLocalTrainerBridge = bridge;

  function tryRequire(name) {
    try {
      if (typeof require === "function") return require(name);
    } catch (error) {
      bridge.lastError = String(error && error.stack || error);
    }
    return null;
  }

  const fs = tryRequire("fs");
  const path = tryRequire("path");
  if (!fs || !path || typeof process === "undefined") {
    bridge.lastError = "Node require/process is unavailable in page context";
    return;
  }

  const gameRoot = process.env.DQ2_GAME_ROOT || process.cwd();
  const projectRoot = process.env.DQ2_MODKIT_ROOT || path.join(gameRoot, "dq2_modkit");
  const bridgeDir = path.join(projectRoot, "runtime", "bridge-state");
  const saveDir = path.join(gameRoot, "www", "save");
  const commandPath = path.join(bridgeDir, "commands.jsonl");
  const eventPath = path.join(bridgeDir, "events.jsonl");
  const statePath = path.join(bridgeDir, "state.json");
  const logPath = path.join(bridgeDir, "bridge.log");

  function ensureDir() {
    try {
      fs.mkdirSync(bridgeDir, { recursive: true });
    } catch (error) {
      bridge.lastError = String(error && error.stack || error);
    }
  }

  function append(file, value) {
    ensureDir();
    fs.appendFileSync(file, JSON.stringify(value) + "\n", "utf8");
  }

  function log(message, extra) {
    ensureDir();
    const line = `[${new Date().toISOString()}] ${message}${extra ? " " + JSON.stringify(extra) : ""}\n`;
    fs.appendFileSync(logPath, line, "utf8");
  }

  function event(command, ok, payload) {
    append(eventPath, {
      ts: Date.now(),
      commandId: command && command.__codexQueueId || commandQueueId(command),
      type: command && command.type,
      ok,
      payload
    });
  }

  function callAlias(name) {
    try {
      const tk = window.TK && window.TK.$;
      const fn = tk && tk[name];
      if (typeof fn === "function") return fn();
      return null;
    } catch (_) {
      return null;
    }
  }

  function tkValue(name) {
    try {
      const tk = window.TK && window.TK.$;
      return tk && tk[name] || null;
    } catch (_) {
      return null;
    }
  }

  function uniqueTargets(targets) {
    const seen = [];
    return targets.filter((target) => {
      if (!target || !target.object || seen.includes(target.object)) return false;
      seen.push(target.object);
      return true;
    });
  }

  function resolveBattleManagers() {
    return uniqueTargets([
      { label: "TK.$.BattleMrg", object: tkValue("BattleMrg") },
      { label: "TK.$.BattleManager", object: tkValue("BattleManager") },
      { label: "window.BattleManager", object: window.BattleManager }
    ]);
  }

  function resolveSceneManager() {
    return tkValue("SceneMrg") || tkValue("SceneManager") || window.SceneManager || null;
  }

  function resolveConfigManager() {
    return tkValue("ConfigMrg") || tkValue("ConfigManager") || window.ConfigManager || null;
  }

  function resolvePrototypeTargets(globalName, aliases) {
    const candidates = [{ label: `window.${globalName}`, object: window[globalName] }];
    aliases.forEach((name) => candidates.push({ label: `TK.$.${name}`, object: tkValue(name) }));
    return uniqueTargets(candidates
      .map((candidate) => {
        const ctor = candidate.object;
        return ctor && ctor.prototype ? { label: `${candidate.label}.prototype`, object: ctor.prototype } : null;
      }));
  }

  function resolveParty() {
    return callAlias("gameParty") || window.$gameParty || null;
  }

  function resolveSystem() {
    return callAlias("gameSystem") || window.$gameSystem || null;
  }

  function resolveVariables() {
    return callAlias("gameVariables") || window.$gameVariables || null;
  }

  function resolveSwitches() {
    return callAlias("gameSwitches") || window.$gameSwitches || null;
  }

  function resolveActors() {
    return callAlias("gameActors") || window.$gameActors || null;
  }

  function resolveTroop() {
    return callAlias("gameTroop") || window.$gameTroop || null;
  }

  function resolveTemp() {
    return callAlias("gameTemp") || window.$gameTemp || null;
  }

  function resolveMap() {
    return callAlias("gameMap") || window.$gameMap || null;
  }

  function resolvePlayer() {
    return callAlias("gamePlayer") || window.$gamePlayer || null;
  }

  function resolveData(kind) {
    const names = {
      item: "dataItems",
      weapon: "dataWeapons",
      armor: "dataArmors",
      skill: "dataSkills",
      actor: "dataActors",
      enemy: "dataEnemies"
    };
    const globals = {
      item: "$dataItems",
      weapon: "$dataWeapons",
      armor: "$dataArmors",
      skill: "$dataSkills",
      actor: "$dataActors",
      enemy: "$dataEnemies"
    };
    return callAlias(names[kind]) || window[globals[kind]] || null;
  }

  function resolveCommonEvents() {
    return callAlias("dataCommonEvents") || window.$dataCommonEvents || null;
  }

  function resolveDataManager() {
    const tk = window.TK && window.TK.$;
    return tk && tk.DataMrg || window.DataManager || null;
  }

  function saveFilePath(savefileId) {
    const id = Number(savefileId);
    const fileName = id === 0 ? "global.rpgsave" : `file${id}.rpgsave`;
    return path.join(saveDir, fileName);
  }

  function patchStorageObject(storage, label) {
    if (!storage || storage.__codexSavePathPatched) return false;
    try {
      const original = {
        localFileDirectoryPath: storage.localFileDirectoryPath,
        localFilePath: storage.localFilePath,
        localFileExists: storage.localFileExists,
        localFileBackupExists: storage.localFileBackupExists,
        isLocalMode: storage.isLocalMode
      };
      Object.defineProperty(storage, "__codexOriginalStorage", {
        value: original,
        configurable: true
      });
      storage.localFileDirectoryPath = function () {
        return saveDir + path.sep;
      };
      storage.localFilePath = function (savefileId) {
        return saveFilePath(savefileId);
      };
      storage.localFileExists = function (savefileId) {
        return fs.existsSync(saveFilePath(savefileId));
      };
      storage.localFileBackupExists = function (savefileId) {
        return fs.existsSync(saveFilePath(savefileId) + ".bak");
      };
      storage.isLocalMode = function () {
        return true;
      };
      Object.defineProperty(storage, "__codexSavePathPatched", {
        value: true,
        configurable: true
      });
      log("patched storage save path", { label, saveDir });
      return true;
    } catch (error) {
      bridge.lastError = String(error && error.stack || error);
      log("storage patch failed", { label, error: bridge.lastError });
      return false;
    }
  }

  function patchSavePaths() {
    let patched = false;
    try {
      patched = patchStorageObject(window.StorageManager, "StorageManager") || patched;
      const tkStorage = window.TK && window.TK.$ && window.TK.$.StorageMrg;
      patched = patchStorageObject(tkStorage, "TK.$.StorageMrg") || patched;
      if (patched) writeState();
    } catch (error) {
      bridge.lastError = String(error && error.stack || error);
    }
    return patched;
  }

  function refreshTitleContinueCommand() {
    try {
      const dataManager = resolveDataManager();
      if (dataManager && typeof dataManager.loadGlobalInfo === "function") {
        dataManager._globalInfo = dataManager.loadGlobalInfo();
      }
      const sceneManager = resolveSceneManager();
      const scene = sceneManager && sceneManager._scene;
      const commandWindow = scene && scene._commandWindow;
      if (commandWindow && typeof commandWindow.refresh === "function") {
        commandWindow.refresh();
        if (typeof commandWindow.activate === "function") commandWindow.activate();
      }
      return true;
    } catch (error) {
      bridge.lastError = String(error && error.stack || error);
      return false;
    }
  }

  function safeGold(party) {
    if (!party) return null;
    try {
      if (typeof party.gold === "function") return party.gold();
      if (typeof party._gold === "number") return party._gold;
    } catch (_) {}
    return null;
  }

  function toBool(value) {
    return value === true || value === "true" || value === 1 || value === "1";
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function bumpRateStat(name, payload) {
    bridge.rateStats[name] = Number(bridge.rateStats[name] || 0) + 1;
    if (payload) {
      bridge.rateStats.last = {
        name,
        ts: Date.now(),
        ...payload
      };
    }
  }

  function bumpBattleStat(name, payload) {
    bridge.battleStats[name] = Number(bridge.battleStats[name] || 0) + 1;
    if (payload) {
      bridge.battleStats.last = {
        name,
        ts: Date.now(),
        ...payload
      };
    }
  }

  function withRatesSuppressed(fn) {
    bridge.suppressRates += 1;
    try {
      return fn();
    } finally {
      bridge.suppressRates = Math.max(0, bridge.suppressRates - 1);
    }
  }

  function withRateContext(fn) {
    bridge.rateDepth += 1;
    try {
      return fn();
    } finally {
      bridge.rateDepth = Math.max(0, bridge.rateDepth - 1);
    }
  }

  function isInBattleRewardContext() {
    if (bridge.rateDepth > 0) return true;
    try {
      const party = resolveParty();
      if (party && typeof party.inBattle === "function" && party.inBattle()) return true;
    } catch (_) {}
    try {
      const managers = resolveBattleManagers();
      const battle = managers[0] && managers[0].object;
      if (battle && battle._phase && battle._phase !== "init") return true;
    } catch (_) {}
    return false;
  }

  function scaledPositiveAmount(amount, rate) {
    const number = Number(amount);
    if (!Number.isFinite(number) || number <= 0) return amount;
    return Math.max(0, Math.floor(number * rate));
  }

  function isActorBattler(battler) {
    try {
      if (!battler) return false;
      if (typeof battler.isActor === "function") return !!battler.isActor();
      return actorIdOf(battler) != null;
    } catch (_) {
      return false;
    }
  }

  function isEnemyBattler(battler) {
    try {
      return !!(battler && typeof battler.isEnemy === "function" && battler.isEnemy());
    } catch (_) {
      return false;
    }
  }

  function battlerHp(battler) {
    if (!battler) return 0;
    return Math.max(0, Number(battler.hp == null ? battler._hp : battler.hp) || 0);
  }

  function actorResourceSnapshot(actor) {
    return {
      mp: Number(actor && (actor.mp == null ? actor._mp : actor.mp) || 0),
      tp: Number(actor && (actor.tp == null ? actor._tp : actor.tp) || 0)
    };
  }

  function actorNoCostKey(actor, index) {
    const id = actorIdOf(actor);
    if (id != null) return `actor:${id}`;
    return `party:${index}`;
  }

  function setActorResource(actor, name, value) {
    const method = name === "mp" ? "setMp" : "setTp";
    const field = name === "mp" ? "_mp" : "_tp";
    withNoCostSuppressed(() => {
      if (actor && typeof actor[method] === "function") actor[method](value);
      else if (actor) actor[field] = value;
    });
  }

  function resetNoCostBaselines() {
    bridge.noCostBaselines = Object.create(null);
  }

  function preserveNoCostResources(reason) {
    if (!bridge.options.noSkillCost) {
      resetNoCostBaselines();
      return { active: false, restored: 0 };
    }
    const party = resolveParty();
    const members = getPartyMembers(party);
    let restored = 0;
    members.forEach((actor, index) => {
      if (!actor) return;
      const key = actorNoCostKey(actor, index);
      const current = actorResourceSnapshot(actor);
      const base = bridge.noCostBaselines[key] || { mp: current.mp, tp: current.tp };
      if (current.mp < base.mp) {
        setActorResource(actor, "mp", base.mp);
        restored += 1;
      } else if (current.mp > base.mp) {
        base.mp = current.mp;
      }
      if (current.tp < base.tp) {
        setActorResource(actor, "tp", base.tp);
        restored += 1;
      } else if (current.tp > base.tp) {
        base.tp = current.tp;
      }
      bridge.noCostBaselines[key] = base;
    });
    if (restored > 0) {
      bumpBattleStat("noSkillCostGuard", { reason, restored });
      refreshMapAndWindows();
    }
    return { active: true, restored };
  }

  function restoreActorResources(actor, snapshot, source) {
    if (!actor || !snapshot) return;
    const current = actorResourceSnapshot(actor);
    let restored = false;
    if (snapshot.mp > current.mp) {
      setActorResource(actor, "mp", snapshot.mp);
      restored = true;
    }
    if (snapshot.tp > current.tp) {
      setActorResource(actor, "tp", snapshot.tp);
      restored = true;
    }
    if (restored) {
      refreshActor(actor);
      bumpBattleStat("noSkillCostRestore", { source, mp: snapshot.mp, tp: snapshot.tp });
    }
  }

  function withNoCostPreserved(actor, source, fn) {
    if (!bridge.options.noSkillCost || !isActorBattler(actor)) return fn();
    const snapshot = actorResourceSnapshot(actor);
    bridge.noCostDepth += 1;
    try {
      return fn();
    } finally {
      bridge.noCostDepth = Math.max(0, bridge.noCostDepth - 1);
      restoreActorResources(actor, snapshot, source);
    }
  }

  function withNoCostSuppressed(fn) {
    bridge.suppressNoCost += 1;
    try {
      return fn();
    } finally {
      bridge.suppressNoCost = Math.max(0, bridge.suppressNoCost - 1);
    }
  }

  function shouldBlockResourceDecrease(actor, value, resourceName) {
    if (!bridge.options.noSkillCost || bridge.suppressNoCost > 0 || !isActorBattler(actor)) return false;
    if (bridge.noCostDepth <= 0) {
      try {
        const party = resolveParty();
        if (!(party && typeof party.inBattle === "function" && party.inBattle())) return false;
      } catch (_) {
        return false;
      }
    }
    const current = Number(actor && (actor[resourceName] == null ? actor[`_${resourceName}`] : actor[resourceName]) || 0);
    return Number(value) < current;
  }

  function getPartyMembers(party) {
    if (!party) return [];
    try {
      if (typeof party.allMembers === "function") return party.allMembers().filter(Boolean);
      if (typeof party.members === "function") return party.members().filter(Boolean);
    } catch (_) {}
    return [];
  }

  function actorIdOf(actor) {
    if (!actor) return null;
    try {
      if (typeof actor.actorId === "function") return actor.actorId();
      return actor._actorId || null;
    } catch (_) {
      return null;
    }
  }

  function actorNameOf(actor) {
    if (!actor) return "";
    try {
      if (typeof actor.name === "function") return actor.name();
      const data = typeof actor.actor === "function" ? actor.actor() : null;
      return data && data.name || actor._name || "";
    } catch (_) {
      return "";
    }
  }

  function actorInfo(actor) {
    if (!actor) return null;
    let skills = [];
    try {
      if (typeof actor.skills === "function") {
        skills = actor.skills().filter(Boolean).map(skill => ({ id: skill.id, name: skill.name }));
      } else if (Array.isArray(actor._skills)) {
        skills = actor._skills.map(id => ({ id, name: "" }));
      }
    } catch (_) {}
    return {
      id: actorIdOf(actor),
      name: actorNameOf(actor),
      level: actor.level == null ? null : actor.level,
      hp: actor.hp == null ? null : actor.hp,
      mhp: actor.mhp == null ? null : actor.mhp,
      mp: actor.mp == null ? null : actor.mp,
      mmp: actor.mmp == null ? null : actor.mmp,
      tp: actor.tp == null ? null : actor.tp,
      skills
    };
  }

  function currentMapInfo() {
    const map = resolveMap();
    const player = resolvePlayer();
    let mapId = null;
    let x = null;
    let y = null;
    let direction = null;
    try {
      if (map && typeof map.mapId === "function") mapId = map.mapId();
      else if (map && map._mapId != null) mapId = map._mapId;
    } catch (_) {}
    try {
      if (player) {
        x = readGameValue(player, "x", "_x");
        y = readGameValue(player, "y", "_y");
        direction = readGameValue(player, "direction", "_direction");
      }
    } catch (_) {}
    return {
      mapId,
      x,
      y,
      direction
    };
  }

  function readGameValue(object, name, fallbackName) {
    const value = object && object[name];
    if (typeof value === "function") return value.call(object);
    if (value != null) return value;
    return object && object[fallbackName];
  }

  function resolveActor(actorId) {
    const id = Math.floor(requireNumber(actorId, "actorId"));
    const actors = resolveActors();
    if (actors && typeof actors.actor === "function") {
      const actor = actors.actor(id);
      if (actor) return actor;
    }
    const party = resolveParty();
    const members = getPartyMembers(party);
    return members.find(actor => actorIdOf(actor) === id) || null;
  }

  function requireActor(actorId) {
    const actor = resolveActor(actorId);
    if (!actor) throw new Error(`actor ${actorId} is unavailable`);
    return actor;
  }

  function refreshActor(actor) {
    try {
      if (actor && typeof actor.refresh === "function") actor.refresh();
    } catch (_) {}
  }

  function actorSkillProgressKey(actor, index) {
    const id = actorIdOf(actor);
    if (id != null) return `actor:${id}`;
    return `party:${index}`;
  }

  function skillProgressSnapshot(table) {
    const snapshot = Object.create(null);
    if (!table || typeof table !== "object") return snapshot;
    Object.keys(table).forEach((key) => {
      if (key.charAt(0) === "@") return;
      const value = Number(table[key]);
      if (Number.isFinite(value)) snapshot[key] = value;
    });
    return snapshot;
  }

  function syncSkillProgressBaseline(baseline, current) {
    Object.keys(baseline).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(current, key)) delete baseline[key];
    });
    Object.keys(current).forEach((key) => {
      baseline[key] = current[key];
    });
  }

  function scaleSkillProgressTable(table, baseline, current, rate) {
    if (!table || typeof table !== "object") {
      syncSkillProgressBaseline(baseline, current);
      return 0;
    }
    let bonus = 0;
    Object.keys(baseline).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(current, key)) delete baseline[key];
    });
    Object.keys(current).forEach((key) => {
      const base = Object.prototype.hasOwnProperty.call(baseline, key) ? Number(baseline[key] || 0) : 0;
      const value = Number(current[key] || 0);
      if (value > base && rate > 1) {
        const extra = Math.floor((value - base) * (rate - 1));
        if (extra > 0) {
          table[key] = value + extra;
          baseline[key] = table[key];
          bonus += extra;
          return;
        }
      }
      baseline[key] = value;
    });
    return bonus;
  }

  function applySkillProgressRate(reason) {
    const party = resolveParty();
    const members = getPartyMembers(party);
    const rate = Number(bridge.options.skillRate || 1);
    let bonus = 0;
    members.forEach((actor, index) => {
      if (!actor) return;
      const key = actorSkillProgressKey(actor, index);
      const exp = skillProgressSnapshot(actor._skillExp);
      const masteryExp = skillProgressSnapshot(actor._skillMasteryExp);
      if (!bridge.skillProgressBaselines[key]) {
        bridge.skillProgressBaselines[key] = { exp, masteryExp };
        return;
      }
      const baseline = bridge.skillProgressBaselines[key];
      baseline.exp = baseline.exp || Object.create(null);
      baseline.masteryExp = baseline.masteryExp || Object.create(null);
      if (rate <= 1) {
        syncSkillProgressBaseline(baseline.exp, exp);
        syncSkillProgressBaseline(baseline.masteryExp, masteryExp);
        return;
      }
      bonus += scaleSkillProgressTable(actor._skillExp, baseline.exp, exp, rate);
      bonus += scaleSkillProgressTable(actor._skillMasteryExp, baseline.masteryExp, masteryExp, rate);
    });
    if (bonus > 0) {
      bumpRateStat("skillProgressRate", { reason, bonus, rate });
      refreshMapAndWindows();
    }
    return { members: members.length, bonus, rate };
  }

  function resetSkillProgressBaselines() {
    bridge.skillProgressBaselines = Object.create(null);
  }

  function refreshMapAndWindows() {
    try {
      const player = resolvePlayer();
      if (player && typeof player.refresh === "function") player.refresh();
      const sceneManager = resolveSceneManager();
      const scene = sceneManager && sceneManager._scene;
      if (scene && scene._statusWindow && typeof scene._statusWindow.refresh === "function") scene._statusWindow.refresh();
      if (scene && scene._itemWindow && typeof scene._itemWindow.refresh === "function") scene._itemWindow.refresh();
      if (scene && scene._skillWindow && typeof scene._skillWindow.refresh === "function") scene._skillWindow.refresh();
    } catch (_) {}
  }

  function setTrainerOptions(options) {
    if (!options || typeof options !== "object") return { ...bridge.options };
    const previousNoCost = bridge.options.noSkillCost;
    const previousSkillRate = bridge.options.skillRate;
    if (Object.prototype.hasOwnProperty.call(options, "expRate")) bridge.options.expRate = clampNumber(options.expRate, 0, 999, bridge.options.expRate);
    if (Object.prototype.hasOwnProperty.call(options, "goldRate")) bridge.options.goldRate = clampNumber(options.goldRate, 0, 999, bridge.options.goldRate);
    if (Object.prototype.hasOwnProperty.call(options, "dropRate")) bridge.options.dropRate = clampNumber(options.dropRate, 0, 999, bridge.options.dropRate);
    if (Object.prototype.hasOwnProperty.call(options, "skillRate")) bridge.options.skillRate = clampNumber(options.skillRate, 0, 999, bridge.options.skillRate);
    if (Object.prototype.hasOwnProperty.call(options, "noSkillCost")) bridge.options.noSkillCost = toBool(options.noSkillCost);
    if (previousNoCost !== bridge.options.noSkillCost) {
      resetNoCostBaselines();
      if (bridge.options.noSkillCost) preserveNoCostResources("enabled");
    }
    if (previousSkillRate !== bridge.options.skillRate) {
      resetSkillProgressBaselines();
      applySkillProgressRate("rateChanged");
    }
    patchTrainerHooks();
    return { ...bridge.options };
  }

  function patchMethod(owner, name, key, wrapper) {
    if (!owner || typeof owner[name] !== "function") return false;
    if (owner[name].__codexTrainerPatched) return true;
    if (!bridge.originals[key]) bridge.originals[key] = owner[name];
    const original = bridge.originals[key];
    const patched = function () {
      return wrapper.call(this, original, arguments);
    };
    Object.defineProperty(patched, "__codexTrainerPatched", { value: true, configurable: true });
    owner[name] = patched;
    return true;
  }

  function patchTrainerHooks() {
    let count = 0;
    const hooked = [];
    const enemyProtos = resolvePrototypeTargets("Game_Enemy", ["Game_Enemy", "GameEnemy"]);
    enemyProtos.forEach((target) => {
      if (patchMethod(target.object, "dropItemRate", `${target.label}.dropItemRate`, function (original, args) {
        const base = Number(original.apply(this, args) || 0);
        const value = Math.max(0, base * bridge.options.dropRate);
        bumpRateStat("dropItemRate", { base, value, rate: bridge.options.dropRate });
        return value;
      })) {
        count += 1;
        hooked.push(`${target.label}.dropItemRate`);
      }
      if (patchMethod(target.object, "makeDropItems", `${target.label}.makeDropItems`, function (original, args) {
        const result = original.apply(this, args);
        if (!Array.isArray(result) || bridge.options.dropRate <= 1) return result;
        const enemy = typeof this.enemy === "function" ? this.enemy() : null;
        const drops = enemy && Array.isArray(enemy.dropItems) ? enemy.dropItems : [];
        const tables = [null, resolveData("item"), resolveData("weapon"), resolveData("armor")];
        const existing = new Set(result.filter(Boolean).map((item) => `${item.id}:${item.name}`));
        drops.forEach((drop) => {
          if (!drop || !drop.kind || !drop.dataId) return;
          const table = tables[drop.kind];
          const item = table && table[drop.dataId];
          if (!item) return;
          const key = `${item.id}:${item.name}`;
          const denominator = Math.max(1, Number(drop.denominator || 1));
          const chance = Math.min(1, bridge.options.dropRate / denominator);
          if (!existing.has(key) && Math.random() < chance) {
            result.push(item);
            existing.add(key);
          }
        });
        bumpRateStat("makeDropItems", { count: result.length, rate: bridge.options.dropRate });
        return result;
      })) {
        count += 1;
        hooked.push(`${target.label}.makeDropItems`);
      }
    });

    const applyRewards = function (manager) {
      const rewards = manager && manager._rewards;
      if (!rewards) return false;
      if (!rewards.__codexBaseRewards) {
        const baseRewards = {
          exp: Number(rewards.exp || 0),
          gold: Number(rewards.gold || 0)
        };
        try {
          Object.defineProperty(rewards, "__codexBaseRewards", {
            value: baseRewards,
            configurable: true
          });
        } catch (_) {
          rewards.__codexBaseRewards = baseRewards;
        }
      }
      rewards.exp = Math.max(0, Math.floor(rewards.__codexBaseRewards.exp * bridge.options.expRate));
      rewards.gold = Math.max(0, Math.floor(rewards.__codexBaseRewards.gold * bridge.options.goldRate));
      bumpRateStat("battleRewards", {
        exp: rewards.exp,
        gold: rewards.gold,
        expRate: bridge.options.expRate,
        goldRate: bridge.options.goldRate
      });
      return true;
    };
    resolveBattleManagers().forEach((target) => {
      if (patchMethod(target.object, "makeRewards", `${target.label}.makeRewards`, function (original, args) {
        const result = original.apply(this, args);
        applyRewards(this);
        return result;
      })) {
        count += 1;
        hooked.push(`${target.label}.makeRewards`);
      }
      if (patchMethod(target.object, "gainRewards", `${target.label}.gainRewards`, function (original, args) {
        const scaled = applyRewards(this);
        return scaled
          ? withRatesSuppressed(() => original.apply(this, args))
          : withRateContext(() => original.apply(this, args));
      })) {
        count += 1;
        hooked.push(`${target.label}.gainRewards`);
      }
      if (patchMethod(target.object, "gainExp", `${target.label}.gainExp`, function (original, args) {
        const scaled = applyRewards(this);
        return scaled
          ? withRatesSuppressed(() => original.apply(this, args))
          : withRateContext(() => original.apply(this, args));
      })) {
        count += 1;
        hooked.push(`${target.label}.gainExp`);
      }
      if (patchMethod(target.object, "gainGold", `${target.label}.gainGold`, function (original, args) {
        const scaled = applyRewards(this);
        return scaled
          ? withRatesSuppressed(() => original.apply(this, args))
          : withRateContext(() => original.apply(this, args));
      })) {
        count += 1;
        hooked.push(`${target.label}.gainGold`);
      }
    });

    resolvePrototypeTargets("Game_Actor", ["Game_Actor", "GameActor"]).forEach((target) => {
      if (patchMethod(target.object, "gainExp", `${target.label}.gainExp`, function (original, args) {
        if (bridge.suppressRates > 0 || bridge.options.expRate === 1 || !isInBattleRewardContext()) {
          return original.apply(this, args);
        }
        const next = Array.prototype.slice.call(args);
        const originalAmount = Number(next[0] || 0);
        next[0] = scaledPositiveAmount(next[0], bridge.options.expRate);
        bumpRateStat("actorGainExp", { base: originalAmount, value: next[0], rate: bridge.options.expRate });
        return original.apply(this, next);
      })) {
        count += 1;
        hooked.push(`${target.label}.gainExp`);
      }
    });

    resolvePrototypeTargets("Game_Party", ["Game_Party", "GameParty"]).forEach((target) => {
      if (patchMethod(target.object, "gainGold", `${target.label}.gainGold`, function (original, args) {
        if (bridge.suppressRates > 0 || bridge.options.goldRate === 1 || !isInBattleRewardContext()) {
          return original.apply(this, args);
        }
        const next = Array.prototype.slice.call(args);
        const originalAmount = Number(next[0] || 0);
        next[0] = scaledPositiveAmount(next[0], bridge.options.goldRate);
        bumpRateStat("partyGainGold", { base: originalAmount, value: next[0], rate: bridge.options.goldRate });
        return original.apply(this, next);
      })) {
        count += 1;
        hooked.push(`${target.label}.gainGold`);
      }
    });

    resolvePrototypeTargets("Game_Action", ["Game_Action", "GameAction"]).forEach((target) => {
      if (patchMethod(target.object, "apply", `${target.label}.apply`, function (original, args) {
        const subject = typeof this.subject === "function" ? this.subject() : null;
        return withNoCostPreserved(subject, `${target.label}.apply`, () => original.apply(this, args));
      })) {
        count += 1;
        hooked.push(`${target.label}.apply`);
      }
    });

    resolvePrototypeTargets("Game_Battler", ["Game_Battler", "GameBattler"]).forEach((target) => {
      if (patchMethod(target.object, "useItem", `${target.label}.useItem`, function (original, args) {
        return withNoCostPreserved(this, `${target.label}.useItem`, () => original.apply(this, args));
      })) {
        count += 1;
        hooked.push(`${target.label}.useItem`);
      }
      if (patchMethod(target.object, "setMp", `${target.label}.setMp`, function (original, args) {
        if (shouldBlockResourceDecrease(this, args[0], "mp")) {
          bumpBattleStat("noSkillCostBlockMp", { source: target.label, value: args[0] });
          return original.call(this, this.mp == null ? this._mp : this.mp);
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.setMp`);
      }
      if (patchMethod(target.object, "setTp", `${target.label}.setTp`, function (original, args) {
        if (shouldBlockResourceDecrease(this, args[0], "tp")) {
          bumpBattleStat("noSkillCostBlockTp", { source: target.label, value: args[0] });
          return original.call(this, this.tp == null ? this._tp : this.tp);
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.setTp`);
      }
    });

    resolvePrototypeTargets("Game_BattlerBase", ["Game_BattlerBase", "GameBattlerBase"]).forEach((target) => {
      if (patchMethod(target.object, "canPaySkillCost", `${target.label}.canPaySkillCost`, function (original, args) {
        if (bridge.options.noSkillCost && isActorBattler(this)) {
          bumpBattleStat("noSkillCostCanPay", { source: target.label });
          return true;
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.canPaySkillCost`);
      }
      if (patchMethod(target.object, "paySkillCost", `${target.label}.paySkillCost`, function (original, args) {
        if (bridge.options.noSkillCost && isActorBattler(this)) {
          bumpBattleStat("noSkillCostPay", { source: target.label });
          return;
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.paySkillCost`);
      }
      if (patchMethod(target.object, "skillMpCost", `${target.label}.skillMpCost`, function (original, args) {
        if (bridge.options.noSkillCost && isActorBattler(this)) {
          bumpBattleStat("noSkillCostMp", { source: target.label });
          return 0;
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.skillMpCost`);
      }
      if (patchMethod(target.object, "skillTpCost", `${target.label}.skillTpCost`, function (original, args) {
        if (bridge.options.noSkillCost && isActorBattler(this)) {
          bumpBattleStat("noSkillCostTp", { source: target.label });
          return 0;
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.skillTpCost`);
      }
      if (patchMethod(target.object, "setMp", `${target.label}.setMp`, function (original, args) {
        if (shouldBlockResourceDecrease(this, args[0], "mp")) {
          bumpBattleStat("noSkillCostBaseBlockMp", { source: target.label, value: args[0] });
          return original.call(this, this.mp == null ? this._mp : this.mp);
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.setMp`);
      }
      if (patchMethod(target.object, "setTp", `${target.label}.setTp`, function (original, args) {
        if (shouldBlockResourceDecrease(this, args[0], "tp")) {
          bumpBattleStat("noSkillCostBaseBlockTp", { source: target.label, value: args[0] });
          return original.call(this, this.tp == null ? this._tp : this.tp);
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.setTp`);
      }
    });

    resolvePrototypeTargets("Game_Actor", ["Game_Actor", "GameActor"]).forEach((target) => {
      if (patchMethod(target.object, "skillMpCost", `${target.label}.skillMpCost`, function (original, args) {
        if (bridge.options.noSkillCost && isActorBattler(this)) {
          bumpBattleStat("noSkillCostActorMp", { source: target.label });
          return 0;
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.skillMpCost`);
      }
      if (patchMethod(target.object, "skillTpCost", `${target.label}.skillTpCost`, function (original, args) {
        if (bridge.options.noSkillCost && isActorBattler(this)) {
          bumpBattleStat("noSkillCostActorTp", { source: target.label });
          return 0;
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.skillTpCost`);
      }
      if (patchMethod(target.object, "paySkillCost", `${target.label}.paySkillCost`, function (original, args) {
        if (bridge.options.noSkillCost && isActorBattler(this)) {
          bumpBattleStat("noSkillCostActorPay", { source: target.label });
          return;
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.paySkillCost`);
      }
      if (patchMethod(target.object, "setMp", `${target.label}.setMp`, function (original, args) {
        if (shouldBlockResourceDecrease(this, args[0], "mp")) {
          bumpBattleStat("noSkillCostActorBlockMp", { source: target.label, value: args[0] });
          return original.call(this, this.mp == null ? this._mp : this.mp);
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.setMp`);
      }
      if (patchMethod(target.object, "setTp", `${target.label}.setTp`, function (original, args) {
        if (shouldBlockResourceDecrease(this, args[0], "tp")) {
          bumpBattleStat("noSkillCostActorBlockTp", { source: target.label, value: args[0] });
          return original.call(this, this.tp == null ? this._tp : this.tp);
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.setTp`);
      }
    });

    bridge.hooksPatched = count > 0;
    bridge.hookTargets = hooked;
    return { patched: bridge.hooksPatched, count };
  }

  function collectState() {
    const party = resolveParty();
    const variables = resolveVariables();
    const switches = resolveSwitches();
    const dataManager = resolveDataManager();
    patchTrainerHooks();
    preserveNoCostResources("state");
    const mapInfo = currentMapInfo();
    return {
      ts: Date.now(),
      href: location.href,
      title: document.title,
      bridgeVersion: bridge.version,
      hasNode: true,
      cwd: process.cwd(),
      saveDir,
      saveDirExists: fs.existsSync(saveDir),
      saveFiles: (() => {
        try {
          return fs.existsSync(saveDir) ? fs.readdirSync(saveDir).filter(name => /\.rpgsave$/i.test(name)).sort() : [];
        } catch (_) {
          return [];
        }
      })(),
      storagePatched: !!(
        window.StorageManager && window.StorageManager.__codexSavePathPatched ||
        window.TK && window.TK.$ && window.TK.$.StorageMrg && window.TK.$.StorageMrg.__codexSavePathPatched
      ),
      hasTK: !!window.TK,
      hasParty: !!party,
      gold: safeGold(party),
      hasVariables: !!variables,
      hasSwitches: !!switches,
      hasDataManager: !!dataManager,
      currentMap: mapInfo,
      partyMembers: getPartyMembers(party).map(actorInfo).filter(Boolean),
      trainerOptions: { ...bridge.options },
      rateStats: { ...bridge.rateStats },
      battleStats: { ...bridge.battleStats },
      hookTargets: bridge.hookTargets.slice(),
      hooksPatched: bridge.hooksPatched,
      lastError: bridge.lastError
    };
  }

  function writeState() {
    ensureDir();
    fs.writeFileSync(statePath, JSON.stringify(collectState(), null, 2), "utf8");
  }

  function looseNumber(value) {
    if (typeof value === "number") return value;
    const text = String(value == null ? "" : value).trim();
    if (text === "") return NaN;
    const direct = Number(text);
    if (Number.isFinite(direct)) return direct;
    const match = text.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : NaN;
  }

  function requireNumber(value, name) {
    const number = looseNumber(value);
    if (!Number.isFinite(number)) throw new Error(`${name} must be a number, got ${JSON.stringify(value)}`);
    return number;
  }

  function uniqueNumericIds(values) {
    const seen = Object.create(null);
    const result = [];
    values.forEach((value) => {
      const id = Math.floor(looseNumber(value));
      if (!Number.isFinite(id) || id <= 0 || seen[id]) return;
      seen[id] = true;
      result.push(id);
    });
    return result;
  }

  function commandIds(command) {
    if (!command) return [];
    if (Array.isArray(command)) {
      return uniqueNumericIds(command.flatMap((value) => String(value).split(/[,\s]+/)));
    }
    if (typeof command !== "object") {
      return uniqueNumericIds(String(command).split(/[,\s]+/));
    }
    if (Array.isArray(command.ids)) {
      return uniqueNumericIds(command.ids.flatMap((value) => String(value).split(/[,\s]+/)));
    }
    if (command.ids != null && command.ids !== "") {
      return uniqueNumericIds(String(command.ids).split(/[,\s]+/));
    }
    if (command.id != null && command.id !== "") return uniqueNumericIds([command.id]);
    return [];
  }

  function requireConfigManager() {
    const config = resolveConfigManager();
    if (!config) throw new Error("ConfigManager is unavailable");
    return config;
  }

  function saveConfig() {
    const config = requireConfigManager();
    if (typeof config.save === "function") {
      config.save();
      return true;
    }
    return false;
  }

  function enemyIdsFromData() {
    const enemies = resolveData("enemy") || [];
    if (!Array.isArray(enemies)) return [];
    return uniqueNumericIds(enemies
      .map((enemy, index) => enemy && (enemy.id != null ? enemy.id : index))
      .filter(Boolean));
  }

  function unlockEnemyBook(ids) {
    const config = requireConfigManager();
    const targetIds = ids.length ? ids : enemyIdsFromData();
    if (!targetIds.length) throw new Error("enemy ids are unavailable");
    if (!Array.isArray(config.enemyBook)) config.enemyBook = [];
    targetIds.forEach((id) => {
      config.enemyBook[id] = 1;
    });

    const system = resolveSystem();
    if (system) {
      system._revealedEnemyWeaknesses = system._revealedEnemyWeaknesses || {};
      targetIds.forEach((id) => {
        system._revealedEnemyWeaknesses[id] = true;
      });
    }
    const saved = saveConfig();
    refreshMapAndWindows();
    return { count: targetIds.length, saved };
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function commandQueueId(command, line) {
    if (!command || typeof command !== "object") return "";
    if (command.__codexQueueId) return String(command.__codexQueueId);
    if (command.commandId || command._commandId || command.cid) {
      return String(command.commandId || command._commandId || command.cid);
    }
    if (typeof command.id === "string" && /^\d+-[a-f0-9]+$/i.test(command.id)) return command.id;
    return `legacy-${hashString(line || JSON.stringify(command))}`;
  }

  function execute(command) {
    if (!command || typeof command !== "object") throw new Error("invalid command");
    const type = String(command.type || "");
    if (type === "ping") {
      return collectState();
    }
    if (type === "trainer.options.get") {
      return { options: { ...bridge.options }, hooks: patchTrainerHooks() };
    }
    if (type === "trainer.hooks.info") {
      return {
        options: { ...bridge.options },
        hooks: patchTrainerHooks(),
        hookTargets: bridge.hookTargets.slice(),
        rateStats: { ...bridge.rateStats },
        battleStats: { ...bridge.battleStats }
      };
    }
    if (type === "trainer.options.set") {
      return { options: setTrainerOptions(command.options || command) };
    }
    if (type === "map.current") {
      return currentMapInfo();
    }
    if (type === "map.transfer") {
      const player = resolvePlayer();
      if (!player) throw new Error("game player is unavailable");
      const mapId = Math.floor(requireNumber(command.mapId, "mapId"));
      const x = Math.floor(requireNumber(command.x, "x"));
      const y = Math.floor(requireNumber(command.y, "y"));
      const direction = command.direction === undefined || command.direction === ""
        ? 2
        : Math.floor(requireNumber(command.direction, "direction"));
      const fade = command.fade === undefined || command.fade === ""
        ? 0
        : Math.floor(requireNumber(command.fade, "fade"));
      if (typeof player.reserveTransfer === "function") {
        player.reserveTransfer(mapId, x, y, direction, fade);
      } else if (typeof player.locate === "function") {
        player.locate(x, y);
      } else {
        throw new Error("player transfer is unavailable");
      }
      refreshMapAndWindows();
      return { mapId, x, y, direction, fade };
    }
    if (type === "commonEvent.run") {
      const temp = resolveTemp();
      if (!temp || typeof temp.reserveCommonEvent !== "function") throw new Error("reserveCommonEvent is unavailable");
      const id = Math.floor(requireNumber(command.id, "id"));
      temp.reserveCommonEvent(id);
      const map = resolveMap();
      if (map && typeof map.requestRefresh === "function") map.requestRefresh();
      const events = resolveCommonEvents();
      const eventData = events && events[id];
      return { id, name: eventData && eventData.name || "" };
    }
    if (type === "gold.add") {
      const party = resolveParty();
      if (!party) throw new Error("game party is unavailable");
      const amount = requireNumber(command.amount, "amount");
      if (typeof party.gainGold === "function") withRatesSuppressed(() => party.gainGold(amount));
      else party._gold = Math.max(0, Number(party._gold || 0) + amount);
      return { gold: safeGold(party) };
    }
    if (type === "gold.set") {
      const party = resolveParty();
      if (!party) throw new Error("game party is unavailable");
      const value = Math.max(0, Math.floor(requireNumber(command.value, "value")));
      const current = safeGold(party) || 0;
      if (typeof party.gainGold === "function") withRatesSuppressed(() => party.gainGold(value - current));
      else party._gold = value;
      return { gold: safeGold(party) };
    }
    if (type === "variable.set") {
      const variables = resolveVariables();
      if (!variables || typeof variables.setValue !== "function") throw new Error("game variables are unavailable");
      variables.setValue(Math.floor(requireNumber(command.id, "id")), command.value);
      return { id: command.id, value: command.value };
    }
    if (type === "switch.set") {
      const switches = resolveSwitches();
      if (!switches || typeof switches.setValue !== "function") throw new Error("game switches are unavailable");
      switches.setValue(Math.floor(requireNumber(command.id, "id")), !!command.value);
      return { id: command.id, value: !!command.value };
    }
    if (type === "item.add") {
      const party = resolveParty();
      if (!party || typeof party.gainItem !== "function") throw new Error("party gainItem is unavailable");
      const kind = String(command.kind || "item");
      const data = resolveData(kind);
      if (!data) throw new Error(`${kind} data is unavailable`);
      const item = data[Math.floor(requireNumber(command.id, "id"))];
      if (!item) throw new Error(`${kind} ${command.id} not found`);
      party.gainItem(item, Math.floor(requireNumber(command.amount, "amount")));
      return { kind, id: command.id, amount: command.amount };
    }
    if (type === "party.recover") {
      const party = resolveParty();
      const members = getPartyMembers(party);
      members.forEach(actor => {
        if (actor && typeof actor.recoverAll === "function") actor.recoverAll();
        else {
          if (actor && typeof actor.setHp === "function" && actor.mhp != null) actor.setHp(actor.mhp);
          if (actor && typeof actor.setMp === "function" && actor.mmp != null) actor.setMp(actor.mmp);
          if (actor && typeof actor.setTp === "function") actor.setTp(100);
        }
        refreshActor(actor);
      });
      refreshMapAndWindows();
      return { count: members.length };
    }
    if (type === "actor.add" || type === "actor.unlock") {
      const party = resolveParty();
      if (!party || typeof party.addActor !== "function") throw new Error("party addActor is unavailable");
      const id = Math.floor(requireNumber(command.id, "id"));
      party.addActor(id);
      refreshMapAndWindows();
      return { unlocked: true, actor: actorInfo(resolveActor(id)) };
    }
    if (type === "actor.remove") {
      const party = resolveParty();
      if (!party || typeof party.removeActor !== "function") throw new Error("party removeActor is unavailable");
      const id = Math.floor(requireNumber(command.id, "id"));
      party.removeActor(id);
      refreshMapAndWindows();
      return { id };
    }
    if (type === "actor.recover") {
      const actor = requireActor(command.id);
      if (typeof actor.recoverAll === "function") actor.recoverAll();
      refreshActor(actor);
      refreshMapAndWindows();
      return { actor: actorInfo(actor) };
    }
    if (type === "actor.level.set") {
      const actor = requireActor(command.id);
      const level = Math.max(1, Math.floor(requireNumber(command.level, "level")));
      if (typeof actor.changeLevel === "function") actor.changeLevel(level, false);
      else actor._level = level;
      refreshActor(actor);
      refreshMapAndWindows();
      return { actor: actorInfo(actor) };
    }
    if (type === "actor.exp.add") {
      const actor = requireActor(command.id);
      const amount = Math.floor(requireNumber(command.amount, "amount"));
      if (typeof actor.gainExp === "function") withRatesSuppressed(() => actor.gainExp(amount));
      else if (typeof actor.changeExp === "function" && typeof actor.currentExp === "function") actor.changeExp(actor.currentExp() + amount, false);
      else {
        actor._exp = actor._exp || {};
        const classId = actor._classId || 0;
        actor._exp[classId] = Number(actor._exp[classId] || 0) + amount;
      }
      refreshActor(actor);
      refreshMapAndWindows();
      return { actor: actorInfo(actor), amount };
    }
    if (type === "actor.vitals.set") {
      const actor = requireActor(command.id);
      if (command.hp !== undefined && command.hp !== "") {
        const hp = Math.floor(requireNumber(command.hp, "hp"));
        if (typeof actor.setHp === "function") actor.setHp(hp);
        else actor._hp = hp;
      }
      if (command.mp !== undefined && command.mp !== "") {
        const mp = Math.floor(requireNumber(command.mp, "mp"));
        if (typeof actor.setMp === "function") withNoCostSuppressed(() => actor.setMp(mp));
        else actor._mp = mp;
        resetNoCostBaselines();
      }
      if (command.tp !== undefined && command.tp !== "") {
        const tp = Math.floor(requireNumber(command.tp, "tp"));
        if (typeof actor.setTp === "function") withNoCostSuppressed(() => actor.setTp(tp));
        else actor._tp = tp;
        resetNoCostBaselines();
      }
      refreshActor(actor);
      refreshMapAndWindows();
      return { actor: actorInfo(actor) };
    }
    if (type === "actor.param.add") {
      const actor = requireActor(command.id);
      const paramId = Math.floor(requireNumber(command.paramId, "paramId"));
      const value = Math.floor(requireNumber(command.value, "value"));
      if (typeof actor.addParam === "function") actor.addParam(paramId, value);
      else {
        actor._paramPlus = actor._paramPlus || [0, 0, 0, 0, 0, 0, 0, 0];
        actor._paramPlus[paramId] = Number(actor._paramPlus[paramId] || 0) + value;
      }
      refreshActor(actor);
      refreshMapAndWindows();
      return { actor: actorInfo(actor), paramId, value };
    }
    if (type === "actor.name.set") {
      const actor = requireActor(command.id);
      const name = String(command.name || "");
      if (typeof actor.setName === "function") actor.setName(name);
      else actor._name = name;
      refreshActor(actor);
      refreshMapAndWindows();
      return { actor: actorInfo(actor) };
    }
    if (type === "actor.skill.learn") {
      const actor = requireActor(command.id);
      const skillId = Math.floor(requireNumber(command.skillId, "skillId"));
      if (typeof actor.learnSkill !== "function") throw new Error("actor learnSkill is unavailable");
      actor.learnSkill(skillId);
      refreshActor(actor);
      refreshMapAndWindows();
      return { actor: actorInfo(actor), skillId };
    }
    if (type === "actor.skill.forget") {
      const actor = requireActor(command.id);
      const skillId = Math.floor(requireNumber(command.skillId, "skillId"));
      if (typeof actor.forgetSkill !== "function") throw new Error("actor forgetSkill is unavailable");
      actor.forgetSkill(skillId);
      refreshActor(actor);
      refreshMapAndWindows();
      return { actor: actorInfo(actor), skillId };
    }
    if (type === "progress.enemyBook.unlock") {
      return unlockEnemyBook(commandIds(command));
    }
    if (type === "save") {
      const dataManager = resolveDataManager();
      if (!dataManager || typeof dataManager.saveGame !== "function") throw new Error("saveGame is unavailable");
      const savefileId = Math.floor(requireNumber(command.id || 1, "id"));
      const result = dataManager.saveGame(savefileId);
      return { id: savefileId, result: String(result) };
    }
    if (type === "title.refresh") {
      return { refreshed: refreshTitleContinueCommand() };
    }
    throw new Error(`unknown command type: ${type}`);
  }

  function pollCommands() {
    try {
      ensureDir();
      if (!fs.existsSync(commandPath)) return;
      const lines = fs.readFileSync(commandPath, "utf8").split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        let command;
        try {
          command = JSON.parse(line);
        } catch (error) {
          log("bad command json", { line, error: String(error && error.stack || error) });
          continue;
        }
        const id = commandQueueId(command, line);
        command.__codexQueueId = id;
        if (!id || bridge.processed[id]) continue;
        if (Number(command.ts || 0) < bridge.startedAtMs) {
          bridge.processed[id] = true;
          continue;
        }
        bridge.processed[id] = true;
        try {
          const payload = execute(command);
          event(command, true, payload);
          writeState();
        } catch (error) {
          bridge.lastError = String(error && error.stack || error);
          event(command, false, { error: bridge.lastError });
          writeState();
        }
      }
    } catch (error) {
      bridge.lastError = String(error && error.stack || error);
      log("poll failed", { error: bridge.lastError });
    }
  }

  ensureDir();
  log("bridge injected", { href: location.href, cwd: process.cwd() });
  patchSavePaths();
  writeState();
  const patchTimer = setInterval(function () {
    if (patchSavePaths()) {
      refreshTitleContinueCommand();
      clearInterval(patchTimer);
    }
  }, 100);
  setInterval(function () {
    preserveNoCostResources("guard");
  }, 100);
  setInterval(function () {
    applySkillProgressRate("guard");
  }, 250);
  setInterval(writeState, 1000);
  setInterval(pollCommands, 250);
})();
