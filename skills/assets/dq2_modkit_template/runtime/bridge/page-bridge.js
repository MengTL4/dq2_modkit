(function () {
  if (window.__codexLocalTrainerBridge) return;

  const bridge = {
    version: "0.2.24",
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    processed: Object.create(null),
    originals: Object.create(null),
    options: {
      expRate: 1,
      goldRate: 1,
      dropRate: 1,
      skillRate: 1,
      noSkillCost: false,
      oneHitKill: false,
      invincible: false
    },
    fishingOptions: {
      autoSuccess: false,
      powerRate: 1,
      powerBonus: 0
    },
    rateDepth: 0,
    suppressRates: 0,
    noCostDepth: 0,
    suppressNoCost: 0,
    suppressInvincible: 0,
    suppressFishingStats: 0,
    noCostBaselines: Object.create(null),
    skillProgressBaselines: Object.create(null),
    rateStats: Object.create(null),
    battleStats: Object.create(null),
    fishingStats: Object.create(null),
    offlineHuntStats: Object.create(null),
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
  const dataDir = path.join(projectRoot, "output", "extract", "data");
  const commandPath = path.join(bridgeDir, "commands.jsonl");
  const eventPath = path.join(bridgeDir, "events.jsonl");
  const statePath = path.join(bridgeDir, "state.json");
  const logPath = path.join(bridgeDir, "bridge.log");
  const dataCache = Object.create(null);

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

  function readDataJson(fileName) {
    try {
      if (dataCache[fileName]) return dataCache[fileName];
      const file = path.join(dataDir, fileName);
      if (!fs.existsSync(file)) return null;
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      dataCache[fileName] = value;
      return value;
    } catch (error) {
      bridge.lastError = String(error && error.stack || error);
      return null;
    }
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

  function runtimePrototypeTarget(label, object) {
    try {
      const prototype = object && Object.getPrototypeOf(object);
      return prototype ? { label, object: prototype } : null;
    } catch (_) {
      return null;
    }
  }

  function runtimePrototypeChainTargets(label, object, maxDepth) {
    const targets = [];
    try {
      let prototype = object && Object.getPrototypeOf(object);
      let depth = 1;
      while (prototype && prototype !== Object.prototype && depth <= maxDepth) {
        targets.push({ label: `${label}.prototype${depth}`, object: prototype });
        prototype = Object.getPrototypeOf(prototype);
        depth += 1;
      }
    } catch (_) {}
    return targets;
  }

  function partyMemberPrototypeTargets(label) {
    const party = resolveParty();
    const members = getPartyMembers(party);
    return members.flatMap((actor, index) => {
      const actorId = actorIdOf(actor) || index + 1;
      return runtimePrototypeChainTargets(`${label}.actor${actorId}`, actor, 5);
    });
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
      enemy: "dataEnemies",
      troop: "dataTroops",
      mapInfo: "dataMapInfos"
    };
    const globals = {
      item: "$dataItems",
      weapon: "$dataWeapons",
      armor: "$dataArmors",
      skill: "$dataSkills",
      actor: "$dataActors",
      enemy: "$dataEnemies",
      troop: "$dataTroops",
      mapInfo: "$dataMapInfos"
    };
    return callAlias(names[kind]) || window[globals[kind]] || null;
  }

  function dataTable(kind) {
    const runtime = resolveData(kind);
    if (Array.isArray(runtime)) return runtime;
    const files = {
      item: "Items.json",
      weapon: "Weapons.json",
      armor: "Armors.json",
      skill: "Skills.json",
      actor: "Actors.json",
      enemy: "Enemies.json",
      troop: "Troops.json",
      mapInfo: "MapInfos.json"
    };
    const file = files[kind];
    const data = file ? readDataJson(file) : null;
    return Array.isArray(data) ? data : [];
  }

  function mapDataFileName(mapId) {
    const id = Math.max(1, Math.floor(Number(mapId) || 0));
    return `Map${String(id).padStart(3, "0")}.json`;
  }

  function localMapData(mapId) {
    return readDataJson(mapDataFileName(mapId));
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

  function bumpFishingStat(name, payload) {
    if (bridge.suppressFishingStats > 0) return;
    bridge.fishingStats[name] = Number(bridge.fishingStats[name] || 0) + 1;
    if (payload) {
      bridge.fishingStats.last = {
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

  function withInvincibleSuppressed(fn) {
    bridge.suppressInvincible += 1;
    try {
      return fn();
    } finally {
      bridge.suppressInvincible = Math.max(0, bridge.suppressInvincible - 1);
    }
  }

  function setBattlerHp(battler, value) {
    if (!battler) return;
    withInvincibleSuppressed(() => {
      if (typeof battler.setHp === "function") battler.setHp(value);
      else battler._hp = value;
    });
  }

  function shouldBlockHpDecrease(battler, value) {
    if (!bridge.options.invincible || bridge.suppressInvincible > 0) return false;
    if (!isActorBattler(battler) || !isInBattle()) return false;
    const next = Number(value);
    if (!Number.isFinite(next)) return false;
    return next < battlerHp(battler);
  }

  function restoreInvincibleHp(battler, snapshot, source) {
    if (!bridge.options.invincible || !isActorBattler(battler) || !Number.isFinite(snapshot)) return false;
    const current = battlerHp(battler);
    if (current >= snapshot) return false;
    setBattlerHp(battler, snapshot);
    refreshActor(battler);
    bumpBattleStat("invincibleRestore", { source, from: current, to: snapshot });
    return true;
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
    resetNoCostBaselines();
    return { active: !!bridge.options.noSkillCost, restored: 0, reason };
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
    return fn();
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
    return false;
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

  function battleManagerObject() {
    const managers = resolveBattleManagers();
    return managers.map(target => target.object).find(Boolean) || null;
  }

  function isInBattle() {
    try {
      const party = resolveParty();
      if (party && typeof party.inBattle === "function" && party.inBattle()) return true;
    } catch (_) {}
    try {
      const manager = battleManagerObject();
      if (manager && manager._phase && manager._phase !== "init") return true;
    } catch (_) {}
    return false;
  }

  function troopEnemies(aliveOnly) {
    const troop = resolveTroop();
    if (!troop) return [];
    try {
      if (aliveOnly && typeof troop.aliveMembers === "function") return troop.aliveMembers().filter(isEnemyBattler);
      if (typeof troop.members === "function") return troop.members().filter(isEnemyBattler);
    } catch (_) {}
    if (Array.isArray(troop._enemies)) return troop._enemies.filter(enemy => isEnemyBattler(enemy) && (!aliveOnly || battlerHp(enemy) > 0));
    return [];
  }

  function defeatEnemy(enemy, source) {
    if (!enemy || !isEnemyBattler(enemy) || battlerHp(enemy) <= 0) return false;
    try {
      if (typeof enemy.setHp === "function") enemy.setHp(0);
      else enemy._hp = 0;
      if (typeof enemy.die === "function") enemy.die();
      if (typeof enemy.performCollapse === "function") enemy.performCollapse();
      if (enemy.result && typeof enemy.result === "function") {
        const result = enemy.result();
        if (result) result.hpDamage = Math.max(Number(result.hpDamage || 0), 999999);
      }
      if (typeof enemy.refresh === "function") enemy.refresh();
      bumpBattleStat("oneHitKill", { source, enemyId: typeof enemy.enemyId === "function" ? enemy.enemyId() : enemy._enemyId });
      return true;
    } catch (error) {
      bridge.lastError = String(error && error.stack || error);
      return false;
    }
  }

  function killBattleEnemies(command) {
    const enemies = troopEnemies(true);
    let count = 0;
    enemies.forEach(enemy => {
      if (defeatEnemy(enemy, "command")) count += 1;
    });
    const finish = command && Object.prototype.hasOwnProperty.call(command, "finish") ? toBool(command.finish) : true;
    if (count > 0 && finish) {
      try {
        const manager = battleManagerObject();
        if (manager && typeof manager.processVictory === "function") manager.processVictory();
      } catch (_) {}
    }
    refreshMapAndWindows();
    bumpBattleStat("killEnemies", { count, finish });
    return { count, finish, inBattle: isInBattle() };
  }

  function escapeBattle() {
    const manager = battleManagerObject();
    if (!manager || !isInBattle()) return { attempted: false, escaped: false, reason: "not in battle" };
    let escaped = false;
    try {
      if (typeof manager.processEscape === "function") {
        const previousRatio = manager._escapeRatio;
        manager._escapeRatio = 1;
        const result = manager.processEscape();
        escaped = result !== false;
        if (previousRatio != null) manager._escapeRatio = previousRatio;
      }
      if (!escaped && typeof manager.processAbort === "function") {
        manager.processAbort();
        escaped = true;
      }
      if (!escaped && typeof manager.endBattle === "function") {
        manager.endBattle(1);
        escaped = true;
      }
      bumpBattleStat("escape", { escaped });
      refreshMapAndWindows();
      return { attempted: true, escaped };
    } catch (error) {
      bridge.lastError = String(error && error.stack || error);
      throw error;
    }
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

  function equipmentKind(item) {
    if (!item || typeof item !== "object") return "";
    if (item.wtypeId != null) return "weapon";
    if (item.atypeId != null) return "armor";
    const id = Number(item.id || 0);
    for (const kind of ["weapon", "armor"]) {
      const table = resolveData(kind);
      if (Array.isArray(table) && table[id] === item) return kind;
    }
    return "";
  }

  function equipmentTable(kind) {
    const table = resolveData(kind);
    return Array.isArray(table) ? table : [];
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
    if (Object.prototype.hasOwnProperty.call(options, "oneHitKill")) bridge.options.oneHitKill = toBool(options.oneHitKill);
    if (Object.prototype.hasOwnProperty.call(options, "invincible")) bridge.options.invincible = toBool(options.invincible);
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

  function setFishingOptions(options) {
    if (!options || typeof options !== "object") return { ...bridge.fishingOptions };
    if (Object.prototype.hasOwnProperty.call(options, "autoSuccess")) bridge.fishingOptions.autoSuccess = toBool(options.autoSuccess);
    if (Object.prototype.hasOwnProperty.call(options, "powerRate")) bridge.fishingOptions.powerRate = clampNumber(options.powerRate, 0, 999, bridge.fishingOptions.powerRate);
    if (Object.prototype.hasOwnProperty.call(options, "powerBonus")) bridge.fishingOptions.powerBonus = clampNumber(options.powerBonus, -999999, 999999, bridge.fishingOptions.powerBonus);
    patchTrainerHooks();
    return { ...bridge.fishingOptions };
  }

  function patchFishingGauge(gauge, source) {
    if (!gauge || typeof gauge !== "object" || gauge.__codexFishingGaugePatched) return gauge;
    const originalSuccess = typeof gauge.isSuccess === "function" ? gauge.isSuccess : null;
    const originalFailed = typeof gauge.isFailed === "function" ? gauge.isFailed : null;
    const originalCancelled = typeof gauge.isCancelled === "function" ? gauge.isCancelled : null;
    if (originalSuccess) {
      gauge.isSuccess = function () {
        if (bridge.fishingOptions.autoSuccess) {
          bumpFishingStat("autoSuccess", { source });
          return true;
        }
        return originalSuccess.apply(this, arguments);
      };
    }
    if (originalFailed) {
      gauge.isFailed = function () {
        if (bridge.fishingOptions.autoSuccess) return false;
        return originalFailed.apply(this, arguments);
      };
    }
    if (originalCancelled) {
      gauge.isCancelled = function () {
        if (bridge.fishingOptions.autoSuccess) return false;
        return originalCancelled.apply(this, arguments);
      };
    }
    try {
      Object.defineProperty(gauge, "__codexFishingGaugePatched", { value: true, configurable: true });
    } catch (_) {
      gauge.__codexFishingGaugePatched = true;
    }
    return gauge;
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
    resolvePrototypeTargets("Game_System", ["Game_System", "GameSystem"]).forEach((target) => {
      if (patchMethod(target.object, "gauge", `${target.label}.gauge`, function (original, args) {
        const gauge = original.apply(this, args);
        return String(args[0] || "") === "fishing" ? patchFishingGauge(gauge, target.label) : gauge;
      })) {
        count += 1;
        hooked.push(`${target.label}.gauge`);
      }
    });

    uniqueTargets(resolvePrototypeTargets("Game_Party", ["Game_Party", "GameParty"]).concat([
      runtimePrototypeTarget("TK.$.gameParty().prototype", resolveParty())
    ])).forEach((target) => {
      if (patchMethod(target.object, "fishPower", `${target.label}.fishPower`, function (original, args) {
        const base = Number(original.apply(this, args) || 0);
        const rate = Number(bridge.fishingOptions.powerRate || 1);
        const bonus = Number(bridge.fishingOptions.powerBonus || 0);
        if ((!Number.isFinite(base)) || (rate === 1 && bonus === 0)) return base;
        const value = Math.max(0, Math.floor(base * rate + bonus));
        bumpFishingStat("fishPower", { base, value, rate, bonus });
        return value;
      })) {
        count += 1;
        hooked.push(`${target.label}.fishPower`);
      }
    });

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

    uniqueTargets(resolvePrototypeTargets("Game_Actor", ["Game_Actor", "GameActor"]).concat(
      partyMemberPrototypeTargets("runtime.party")
    )).forEach((target) => {
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
        const targetBattler = args && args[0];
        const hpSnapshot = bridge.options.invincible && isActorBattler(targetBattler) ? battlerHp(targetBattler) : null;
        const result = withNoCostPreserved(subject, `${target.label}.apply`, () => original.apply(this, args));
        if (hpSnapshot != null) restoreInvincibleHp(targetBattler, hpSnapshot, `${target.label}.apply`);
        if (bridge.options.oneHitKill && isActorBattler(subject) && isEnemyBattler(targetBattler)) {
          defeatEnemy(targetBattler, `${target.label}.apply`);
        }
        return result;
      })) {
        count += 1;
        hooked.push(`${target.label}.apply`);
      }
      if (patchMethod(target.object, "executeHpDamage", `${target.label}.executeHpDamage`, function (original, args) {
        const targetBattler = args && args[0];
        const value = Number(args && args[1] || 0);
        if (bridge.options.invincible && isActorBattler(targetBattler) && value > 0) {
          const next = Array.prototype.slice.call(args);
          next[1] = 0;
          bumpBattleStat("invincibleDamage", { source: target.label, value });
          return original.apply(this, next);
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.executeHpDamage`);
      }
    });

    uniqueTargets(resolvePrototypeTargets("Game_Battler", ["Game_Battler", "GameBattler"]).concat(
      partyMemberPrototypeTargets("runtime.party")
    )).forEach((target) => {
      if (patchMethod(target.object, "setHp", `${target.label}.setHp`, function (original, args) {
        if (shouldBlockHpDecrease(this, args[0])) {
          const current = battlerHp(this);
          bumpBattleStat("invincibleBlockHp", { source: target.label, value: args[0], current });
          return original.call(this, current);
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.setHp`);
      }
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

    uniqueTargets(resolvePrototypeTargets("Game_BattlerBase", ["Game_BattlerBase", "GameBattlerBase"]).concat(
      partyMemberPrototypeTargets("runtime.party")
    )).forEach((target) => {
      if (patchMethod(target.object, "setHp", `${target.label}.setHp`, function (original, args) {
        if (shouldBlockHpDecrease(this, args[0])) {
          const current = battlerHp(this);
          bumpBattleStat("invincibleBaseBlockHp", { source: target.label, value: args[0], current });
          return original.call(this, current);
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.setHp`);
      }
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

    uniqueTargets(resolvePrototypeTargets("Game_Actor", ["Game_Actor", "GameActor"]).concat(
      partyMemberPrototypeTargets("runtime.party")
    )).forEach((target) => {
      if (patchMethod(target.object, "setHp", `${target.label}.setHp`, function (original, args) {
        if (shouldBlockHpDecrease(this, args[0])) {
          const current = battlerHp(this);
          bumpBattleStat("invincibleActorBlockHp", { source: target.label, value: args[0], current });
          return original.call(this, current);
        }
        return original.apply(this, args);
      })) {
        count += 1;
        hooked.push(`${target.label}.setHp`);
      }
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
    bridge.hookTargets = Array.from(new Set(hooked));
    return { patched: bridge.hooksPatched, count };
  }

  function variableValue(id) {
    try {
      const variables = resolveVariables();
      return variables && typeof variables.value === "function" ? variables.value(id) : null;
    } catch (_) {
      return null;
    }
  }

  function switchValue(id) {
    try {
      const switches = resolveSwitches();
      return switches && typeof switches.value === "function" ? switches.value(id) : null;
    } catch (_) {
      return null;
    }
  }

  function setVariableValue(id, value) {
    const variables = resolveVariables();
    if (!variables || typeof variables.setValue !== "function") throw new Error("game variables are unavailable");
    variables.setValue(id, value);
    return value;
  }

  function setSwitchValue(id, value) {
    const switches = resolveSwitches();
    if (!switches || typeof switches.setValue !== "function") throw new Error("game switches are unavailable");
    switches.setValue(id, !!value);
    return !!value;
  }

  function fishingSummary() {
    const party = resolveParty();
    const fields = {};
    const calls = {};
    if (party) {
      ["_fishPower", "_fishUse", "_onlyFish"].forEach((key) => {
        const value = party[key];
        fields[key] = Array.isArray(value) ? value.slice(0, 20) : value;
      });
      ["fishPower", "fishPowerActor", "fishPowerItem"].forEach((key) => {
        try {
          bridge.suppressFishingStats += 1;
          calls[key] = typeof party[key] === "function" ? party[key].call(party) : null;
        } catch (error) {
          calls[key] = { error: String(error && error.message || error) };
        } finally {
          bridge.suppressFishingStats = Math.max(0, bridge.suppressFishingStats - 1);
        }
      });
    }
    return {
      partyAvailable: !!party,
      fields,
      calls,
      variables: {
        medals: variableValue(12),
        skill: variableValue(40),
        village: variableValue(41),
        count: variableValue(42)
      },
      switches: {
        wantsFishing: switchValue(55),
        rod: switchValue(122),
        fisherman: switchValue(364),
        fisher: switchValue(365),
        master: switchValue(395),
        rod2: switchValue(569)
      }
    };
  }

  function compactRuntimeValue(value, depth) {
    if (value === null || value === undefined) return value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
    if (typeof value === "function") return runtimePreview(value, 180);
    if (depth <= 0) return runtimePreview(value, 180);
    if (Array.isArray(value)) {
      return {
        type: "array",
        length: value.length,
        items: value.slice(0, 20).map(item => compactRuntimeValue(item, depth - 1))
      };
    }
    if (typeof value === "object") {
      const output = {};
      safeOwnPropertyNames(value).slice(0, 24).forEach((key) => {
        try {
          output[key] = compactRuntimeValue(value[key], depth - 1);
        } catch (error) {
          output[key] = { error: String(error && error.message || error) };
        }
      });
      return output;
    }
    return runtimePreview(value, 180);
  }

  function hangupSummary() {
    const party = resolveParty();
    const fieldNames = [
      "_hangUpData",
      "_hangUpSiwitch",
      "_hangUpSwitch",
      "_hangUpCount",
      "_hangUpSaveSec",
      "_hangUpAdPendingStop",
      "_hangUpAdRemainFrames",
      "_XdRsData_hangUp_ActSkill",
      "_XdRsData_hangUp_ActSkills",
      "_XdRsData_hangUp_RecoveryHMP",
      "_XdRsData_hangUp_SellWeapon"
    ];
    const methodNames = [
      "startHangUp",
      "stopHangUp",
      "isHangUp",
      "hangUpSwitch",
      "hangUpData",
      "setHangUpData",
      "refrishHangUp",
      "hangUpTime",
      "hangUpTimeText"
    ];
    const fields = {};
    const calls = {};
    const methods = [];
    if (!party) {
      return { partyAvailable: false, available: false, active: false, fields, calls, methods };
    }
    fieldNames.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(party, key)) {
        fields[key] = compactRuntimeValue(party[key], 2);
      }
    });
    methodNames.forEach((key) => {
      if (typeof party[key] === "function") methods.push(key);
    });
    ["isHangUp", "hangUpSwitch", "hangUpData", "hangUpTime", "hangUpTimeText"].forEach((key) => {
      if (typeof party[key] !== "function") return;
      try {
        calls[key] = compactRuntimeValue(party[key].call(party), 2);
      } catch (error) {
        calls[key] = { error: String(error && error.message || error) };
      }
    });
    const active = typeof calls.isHangUp === "boolean"
      ? calls.isHangUp
      : !!(fields._hangUpSiwitch || fields._hangUpSwitch);
    return {
      partyAvailable: true,
      available: methods.some(name => ["startHangUp", "stopHangUp", "refrishHangUp"].includes(name)),
      active,
      fields,
      calls,
      methods: methods.sort()
    };
  }

  function callHangupMethod(methodName, statName) {
    const party = resolveParty();
    if (!party || typeof party[methodName] !== "function") throw new Error(`${methodName} is unavailable`);
    const result = party[methodName].call(party);
    refreshMapAndWindows();
    bumpBattleStat(statName, {});
    return {
      result: compactRuntimeValue(result, 2),
      hangup: hangupSummary()
    };
  }

  function offlineHuntSummary() {
    return {
      dataDir,
      dataAvailable: fs.existsSync(dataDir),
      preview: bridge.offlineHuntStats.preview || null,
      last: bridge.offlineHuntStats.last || null,
      totals: { ...bridge.offlineHuntStats }
    };
  }

  function normalizeDropKind(kind) {
    const value = String(kind || "").toLowerCase();
    if (value === "1" || value === "item") return "item";
    if (value === "2" || value === "weapon") return "weapon";
    if (value === "3" || value === "armor" || value === "armour") return "armor";
    return "";
  }

  function dropKindIndex(kind) {
    if (kind === "item") return 1;
    if (kind === "weapon") return 2;
    if (kind === "armor") return 3;
    return 0;
  }

  function dropTable(kind) {
    if (kind === "item") return dataTable("item");
    if (kind === "weapon") return dataTable("weapon");
    if (kind === "armor") return dataTable("armor");
    return [];
  }

  function itemKindOfObject(item) {
    if (!item) return "";
    const id = Number(item.id);
    for (const kind of ["item", "weapon", "armor"]) {
      const table = dataTable(kind);
      if (table && table[id] === item) return kind;
    }
    for (const kind of ["item", "weapon", "armor"]) {
      const table = dataTable(kind);
      if (table && table[id] && table[id].name === item.name) return kind;
    }
    return "item";
  }

  function itemSummary(item) {
    if (!item) return null;
    const kind = itemKindOfObject(item);
    const quality = itemQuality(item, kind);
    return {
      kind,
      id: Number(item.id || 0),
      name: String(item.name || ""),
      iconIndex: Number(item.iconIndex || 0),
      quality,
      qualityLabel: qualityLabel(quality)
    };
  }

  function itemKey(summary) {
    return `${summary.kind}:${summary.id}:${summary.name}`;
  }

  function addDropGroup(groups, item, count) {
    const summary = itemSummary(item);
    if (!summary || !summary.id) return;
    const key = itemKey(summary);
    if (!groups[key]) groups[key] = { ...summary, count: 0 };
    groups[key].count += count || 1;
  }

  function itemQuality(item, kind) {
    if (!item || typeof item !== "object") return null;
    const values = [
      item.quality,
      item.meta && item.meta.quality,
      item.meta && item.meta.Quality
    ];
    for (const value of values) {
      const number = looseNumber(value);
      if (Number.isFinite(number)) return Math.floor(number);
    }
    const match = String(item.note || "").match(/<\s*quality\s*:\s*([+-]?\d+(?:\.\d+)?)\s*>/i);
    if (match) return Math.floor(Number(match[1]));
    const tableKind = kind || itemKindOfObject(item);
    if (tableKind === "weapon" || tableKind === "armor") {
      const table = dropTable(tableKind);
      const baseId = Math.floor(looseNumber(item.baseItemId || item.baseId || item.id));
      const base = baseId > 0 && table && table[baseId];
      if (base && base !== item) return itemQuality(base, tableKind);
    }
    return null;
  }

  function qualityLabel(quality) {
    const labels = {
      0: "灰",
      1: "白",
      2: "绿",
      3: "蓝",
      4: "紫",
      5: "橙",
      6: "红",
      7: "金"
    };
    return Object.prototype.hasOwnProperty.call(labels, quality) ? labels[quality] : "";
  }

  function normalizeQualitySet(value) {
    const rows = Array.isArray(value)
      ? value
      : value && typeof value === "object"
        ? Object.keys(value).filter(key => toBool(value[key]))
        : String(value == null ? "" : value).split(/[,\s|]+/);
    const set = new Set();
    rows.forEach((row) => {
      const number = Math.floor(looseNumber(row));
      if (Number.isFinite(number)) set.add(number);
    });
    return set;
  }

  function offlineLootConfig(command) {
    return {
      autoSellQualities: normalizeQualitySet(command.autoSellQualities),
      blockDropQualities: normalizeQualitySet(command.blockDropQualities)
    };
  }

  function offlineSellPrice(item) {
    const price = Math.max(0, Number(item && item.price || 0));
    return Math.floor(price / 2);
  }

  function classifyOfflineDrop(item, config) {
    const summary = itemSummary(item);
    if (!summary || (summary.kind !== "weapon" && summary.kind !== "armor")) {
      return { action: "keep", summary, price: 0 };
    }
    const quality = summary.quality;
    if (Number.isFinite(Number(quality)) && config.blockDropQualities.has(quality)) {
      return { action: "block", summary, price: 0 };
    }
    if (Number.isFinite(Number(quality)) && config.autoSellQualities.has(quality)) {
      return { action: "sell", summary, price: offlineSellPrice(item) };
    }
    return { action: "keep", summary, price: 0 };
  }

  function noteEnemyDrops(enemy, rate) {
    const note = String(enemy && enemy.note || "");
    const match = note.match(/<\s*Enemy Drops\s*>([\s\S]*?)<\s*\/\s*Enemy Drops\s*>/i);
    if (!match) return [];
    const drops = [];
    match[1].split(/\r?\n/).forEach((line) => {
      const parsed = line.trim().match(/^(item|weapon|armor)\s+(\d+)\s*:\s*([\d.]+)\s*%/i);
      if (!parsed) return;
      const kind = normalizeDropKind(parsed[1]);
      const id = Math.floor(Number(parsed[2]));
      const percent = Number(parsed[3]);
      const table = dropTable(kind);
      const item = table && table[id];
      if (!item || !Number.isFinite(percent)) return;
      const chance = Math.max(0, Math.min(1, (percent / 100) * Math.max(0, Number(rate || 1))));
      drops.push({ kind, id, chance, item });
    });
    return drops;
  }

  function possibleEnemyDrops(enemy) {
    const drops = [];
    const seen = new Set();
    const pushDrop = (drop) => {
      const key = `${drop.kind}:${drop.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      drops.push(drop);
    };
    noteEnemyDrops(enemy, 1).forEach((drop) => {
      pushDrop({
        kind: drop.kind,
        id: drop.id,
        name: drop.item && drop.item.name || "",
        chance: drop.chance,
        quality: itemQuality(drop.item, drop.kind),
        qualityLabel: qualityLabel(itemQuality(drop.item, drop.kind))
      });
    });
    (enemy && enemy.dropItems || []).forEach((drop) => {
      if (!drop || !drop.kind || !drop.dataId) return;
      const kind = normalizeDropKind(drop.kind);
      const item = kind ? dropTable(kind)[drop.dataId] : null;
      if (!item) return;
      pushDrop({
        kind,
        id: Number(drop.dataId),
        name: item.name || "",
        chance: 1 / Math.max(1, Number(drop.denominator || 1)),
        quality: itemQuality(item, kind),
        qualityLabel: qualityLabel(itemQuality(item, kind))
      });
    });
    return drops;
  }

  function markOfflineEnemyDefeated(enemy) {
    if (!enemy) return false;
    try {
      if (typeof enemy.isHidden === "function" && enemy.isHidden()) return false;
    } catch (_) {}
    try {
      if (typeof enemy.setHp === "function") enemy.setHp(0);
      else enemy._hp = 0;
      if (typeof enemy.die === "function") enemy.die();
      if (typeof enemy.refresh === "function") enemy.refresh();
      return true;
    } catch (_) {
      return false;
    }
  }

  function createOfflineTroop(troopId) {
    const sourceTroop = resolveTroop();
    const Constructor = sourceTroop && sourceTroop.constructor || window.Game_Troop;
    if (typeof Constructor !== "function") return null;
    try {
      const troop = new Constructor();
      if (typeof troop.setup !== "function") return null;
      troop.setup(troopId);
      const members = typeof troop.members === "function" ? troop.members() : troop._enemies || [];
      members.forEach(markOfflineEnemyDefeated);
      return troop;
    } catch (error) {
      bridge.lastError = String(error && error.stack || error);
      return null;
    }
  }

  function troopDataPreview(troopId) {
    const troops = dataTable("troop");
    const enemies = dataTable("enemy");
    const troop = troops && troops[troopId];
    if (!troop) return null;
    let exp = 0;
    let gold = 0;
    const enemyRows = [];
    const possibleDrops = [];
    const possibleDropKeys = new Set();
    (troop.members || []).forEach((member) => {
      if (!member || member.hidden) return;
      const enemy = enemies && enemies[member.enemyId];
      if (!enemy) return;
      exp += Number(enemy.exp || 0);
      gold += Number(enemy.gold || 0);
      enemyRows.push({ id: Number(member.enemyId), name: enemy.name || "", exp: Number(enemy.exp || 0), gold: Number(enemy.gold || 0) });
      possibleEnemyDrops(enemy).forEach((drop) => {
        const key = `${drop.kind}:${drop.id}`;
        if (possibleDropKeys.has(key)) return;
        possibleDropKeys.add(key);
        possibleDrops.push({ ...drop, enemyId: Number(member.enemyId), enemyName: enemy.name || "" });
      });
    });
    return {
      id: troopId,
      name: troop.name || "",
      exp,
      gold,
      enemies: enemyRows,
      possibleDrops: possibleDrops.slice(0, 80)
    };
  }

  function runtimeTroopReward(troopId) {
    const troop = createOfflineTroop(troopId);
    if (!troop) return null;
    try {
      const members = typeof troop.members === "function" ? troop.members() : troop._enemies || [];
      const enemyIds = members
        .filter(enemy => {
          try {
            return !(typeof enemy.isHidden === "function" && enemy.isHidden());
          } catch (_) {
            return true;
          }
        })
        .map(enemy => {
          try {
            return typeof enemy.enemyId === "function" ? enemy.enemyId() : enemy._enemyId;
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean);
      const exp = typeof troop.expTotal === "function" ? Number(troop.expTotal() || 0) : 0;
      const gold = typeof troop.goldTotal === "function" ? Number(troop.goldTotal() || 0) : 0;
      const items = typeof troop.makeDropItems === "function" ? troop.makeDropItems().filter(Boolean) : [];
      return { exp, gold, items, enemyIds, source: "runtime" };
    } catch (error) {
      bridge.lastError = String(error && error.stack || error);
      return null;
    }
  }

  function dataTroopReward(troopId) {
    const preview = troopDataPreview(troopId);
    if (!preview) return null;
    const enemies = dataTable("enemy");
    const items = [];
    preview.enemies.forEach((enemyRow) => {
      const enemy = enemies && enemies[enemyRow.id];
      const noteDropKeys = new Set();
      noteEnemyDrops(enemy, bridge.options.dropRate).forEach((drop) => {
        noteDropKeys.add(`${drop.kind}:${drop.id}`);
        if (Math.random() < drop.chance) items.push(drop.item);
      });
      (enemy && enemy.dropItems || []).forEach((drop) => {
        if (!drop || !drop.kind || !drop.dataId) return;
        const kind = normalizeDropKind(drop.kind);
        if (!kind || noteDropKeys.has(`${kind}:${drop.dataId}`)) return;
        const item = dropTable(kind)[drop.dataId];
        const chance = Math.min(1, Math.max(0, Number(bridge.options.dropRate || 1)) / Math.max(1, Number(drop.denominator || 1)));
        if (item && Math.random() < chance) items.push(item);
      });
    });
    return { exp: preview.exp, gold: preview.gold, items, enemyIds: preview.enemies.map(enemy => enemy.id), source: "data" };
  }

  function offlineTroopReward(troopId) {
    const runtimeReward = runtimeTroopReward(troopId);
    const dataReward = dataTroopReward(troopId);
    if (runtimeReward) {
      const runtimeEnemyIds = Array.isArray(runtimeReward.enemyIds) ? runtimeReward.enemyIds : [];
      const dataEnemyIds = dataReward && Array.isArray(dataReward.enemyIds) ? dataReward.enemyIds : [];
      return {
        exp: runtimeReward.exp,
        gold: runtimeReward.gold,
        // The game's custom drop plugin is tied to real battle context. Temporary
        // Game_Troop drops can go stale after the first offline run, so simulate
        // drops from data while keeping runtime exp/gold totals.
        items: dataReward ? dataReward.items : runtimeReward.items,
        enemyIds: uniqueNumericIds(runtimeEnemyIds.concat(dataEnemyIds)),
        source: dataReward ? "runtime+dataDrops" : "runtime"
      };
    }
    return dataReward;
  }

  function offlineEncounterList(mapId, regionId) {
    const data = localMapData(mapId);
    if (!data || !Array.isArray(data.encounterList)) return [];
    let list = data.encounterList
      .filter(encounter => encounter && Number(encounter.troopId) > 0)
      .map(encounter => ({
        troopId: Math.floor(Number(encounter.troopId)),
        weight: Math.max(0, Number(encounter.weight || 0)),
        regionSet: Array.isArray(encounter.regionSet) ? encounter.regionSet.map(Number).filter(Number.isFinite) : []
      }));
    const region = Math.floor(Number(regionId || 0));
    if (region > 0) {
      const filtered = list.filter(encounter => !encounter.regionSet.length || encounter.regionSet.includes(region));
      if (filtered.length) list = filtered;
    }
    return list;
  }

  function chooseWeightedEncounter(encounters) {
    if (!encounters.length) return null;
    const total = encounters.reduce((sum, encounter) => sum + Math.max(0, Number(encounter.weight || 0)), 0);
    if (total <= 0) return encounters[Math.floor(Math.random() * encounters.length)];
    let roll = Math.random() * total;
    for (const encounter of encounters) {
      roll -= Math.max(0, Number(encounter.weight || 0));
      if (roll <= 0) return encounter;
    }
    return encounters[encounters.length - 1];
  }

  function offlineHuntMapPreview(command) {
    const mapId = Math.floor(requireNumber(command.mapId, "mapId"));
    const regionId = command.regionId == null || command.regionId === "" ? 0 : Math.floor(requireNumber(command.regionId, "regionId"));
    const map = localMapData(mapId);
    if (!map) throw new Error(`map ${mapId} data is unavailable`);
    const mapInfos = dataTable("mapInfo");
    const info = mapInfos && mapInfos[mapId] || {};
    const encounters = offlineEncounterList(mapId, regionId);
    const troops = encounters.map((encounter) => ({
      ...encounter,
      preview: troopDataPreview(encounter.troopId)
    })).filter(row => row.preview);
    const totalWeight = encounters.reduce((sum, encounter) => sum + Math.max(0, Number(encounter.weight || 0)), 0);
    const weighted = troops.reduce((sum, row) => {
      const weight = totalWeight > 0 ? row.weight : 1;
      return {
        exp: sum.exp + row.preview.exp * weight,
        gold: sum.gold + row.preview.gold * weight,
        weight: sum.weight + weight
      };
    }, { exp: 0, gold: 0, weight: 0 });
    const rateExp = Number(bridge.options.expRate || 1);
    const rateGold = Number(bridge.options.goldRate || 1);
    return {
      mapId,
      name: map.displayName || info.name || `Map${mapId}`,
      encounterStep: map.encounterStep || 0,
      encounterCount: encounters.length,
      regionId,
      average: weighted.weight > 0 ? {
        exp: Math.floor((weighted.exp / weighted.weight) * rateExp),
        gold: Math.floor((weighted.gold / weighted.weight) * rateGold)
      } : { exp: 0, gold: 0 },
      troops: troops.slice(0, 80)
    };
  }

  function offlineHuntTroopPreview(command) {
    const troopId = Math.floor(requireNumber(command.troopId, "troopId"));
    const preview = troopDataPreview(troopId);
    if (!preview) throw new Error(`troop ${troopId} data is unavailable`);
    const rateExp = Number(bridge.options.expRate || 1);
    const rateGold = Number(bridge.options.goldRate || 1);
    return {
      mode: "troop",
      mapId: command.mapId == null || command.mapId === "" ? 0 : Math.floor(Number(command.mapId) || 0),
      troopId,
      name: preview.name || `Troop${troopId}`,
      encounterStep: 0,
      encounterCount: 1,
      regionId: 0,
      average: {
        exp: Math.floor(preview.exp * rateExp),
        gold: Math.floor(preview.gold * rateGold)
      },
      troops: [{ troopId, weight: 1, regionSet: [], preview }]
    };
  }

  function offlineHuntPreview(command) {
    if (command && command.troopId != null && command.troopId !== "") return offlineHuntTroopPreview(command);
    return offlineHuntMapPreview(command);
  }

  function revealEnemyBookIds(enemyIds) {
    const ids = uniqueNumericIds(enemyIds);
    if (!ids.length) return { count: 0, saved: false };
    const config = requireConfigManager();
    if (!Array.isArray(config.enemyBook)) config.enemyBook = [];
    ids.forEach((id) => {
      config.enemyBook[id] = 1;
    });
    const system = resolveSystem();
    if (system) {
      system._revealedEnemyWeaknesses = system._revealedEnemyWeaknesses || {};
      ids.forEach((id) => {
        system._revealedEnemyWeaknesses[id] = true;
      });
    }
    return { count: ids.length, saved: saveConfig() };
  }

  function saveGameToSlot(savefileId) {
    const dataManager = resolveDataManager();
    if (!dataManager || typeof dataManager.saveGame !== "function") throw new Error("saveGame is unavailable");
    const id = Math.floor(requireNumber(savefileId || 1, "id"));
    const result = dataManager.saveGame(id);
    return { id, result: String(result) };
  }

  function recoverPartyMembers() {
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

  function runOfflineHunt(command) {
    const party = resolveParty();
    if (!party) throw new Error("game party is unavailable");
    const fixedTroopId = command.troopId == null || command.troopId === "" ? 0 : Math.floor(requireNumber(command.troopId, "troopId"));
    const mapId = fixedTroopId > 0 && (command.mapId == null || command.mapId === "")
      ? 0
      : Math.floor(requireNumber(command.mapId, "mapId"));
    const times = Math.max(1, Math.min(5000, Math.floor(requireNumber(command.times || 1, "times"))));
    const regionId = command.regionId == null || command.regionId === "" ? 0 : Math.floor(requireNumber(command.regionId, "regionId"));
    const encounters = fixedTroopId > 0
      ? [{ troopId: fixedTroopId, weight: 1, regionSet: [] }]
      : offlineEncounterList(mapId, regionId);
    if (!encounters.length) throw new Error(`map ${mapId} has no encounter list`);

    const expRate = Number(bridge.options.expRate || 1);
    const goldRate = Number(bridge.options.goldRate || 1);
    const troopGroups = Object.create(null);
    const enemyGroups = Object.create(null);
    const dropGroups = Object.create(null);
    const autoSellGroups = Object.create(null);
    const blockedDropGroups = Object.create(null);
    const enemyIds = [];
    const lootConfig = offlineLootConfig(command);
    let baseExp = 0;
    let baseGold = 0;
    let autoSellGold = 0;
    let autoSellCount = 0;
    let blockedDropCount = 0;
    let runtimeCount = 0;
    let dataCount = 0;

    for (let index = 0; index < times; index += 1) {
      const encounter = chooseWeightedEncounter(encounters);
      const troopId = encounter && encounter.troopId;
      const reward = offlineTroopReward(troopId);
      const preview = troopDataPreview(troopId);
      if (!reward) continue;
      if (String(reward.source || "").startsWith("runtime")) runtimeCount += 1;
      else dataCount += 1;
      baseExp += Number(reward.exp || 0);
      baseGold += Number(reward.gold || 0);
      const troopKey = String(troopId);
      if (!troopGroups[troopKey]) troopGroups[troopKey] = { id: troopId, name: preview && preview.name || "", count: 0 };
      troopGroups[troopKey].count += 1;
      (preview && preview.enemies || []).forEach((enemy) => {
        if (!enemyGroups[enemy.id]) enemyGroups[enemy.id] = { id: enemy.id, name: enemy.name || "", count: 0 };
        enemyGroups[enemy.id].count += 1;
      });
      (reward.enemyIds || []).forEach(id => enemyIds.push(id));
      (reward.items || []).forEach((item) => {
        const decision = classifyOfflineDrop(item, lootConfig);
        if (decision.action === "block") {
          blockedDropCount += 1;
          addDropGroup(blockedDropGroups, item, 1);
        } else if (decision.action === "sell") {
          autoSellCount += 1;
          autoSellGold += decision.price;
          addDropGroup(autoSellGroups, item, 1);
        } else {
          addDropGroup(dropGroups, item, 1);
        }
      });
    }

    const exp = scaledPositiveAmount(baseExp, expRate);
    const battleGold = scaledPositiveAmount(baseGold, goldRate);
    const gold = battleGold + autoSellGold;
    const members = getPartyMembers(party);
    withRatesSuppressed(() => {
      members.forEach((actor) => {
        if (actor && typeof actor.gainExp === "function") actor.gainExp(exp);
      });
      if (typeof party.gainGold === "function") party.gainGold(gold);
      else party._gold = Math.max(0, Number(party._gold || 0) + gold);
      Object.values(dropGroups).forEach((drop) => {
        const item = dropTable(drop.kind)[drop.id];
        if (item && typeof party.gainItem === "function") party.gainItem(item, drop.count);
      });
    });

    let enemyBook = null;
    if (toBool(command.enemyBook)) {
      try {
        enemyBook = revealEnemyBookIds(enemyIds);
      } catch (error) {
        enemyBook = { error: String(error && error.message || error) };
      }
    }
    let recovered = null;
    if (toBool(command.recover)) recovered = recoverPartyMembers();
    let saved = null;
    if (toBool(command.save)) saved = saveGameToSlot(command.saveSlot || 1);

    const result = {
      mode: fixedTroopId > 0 ? "troop" : "map",
      mapId,
      times,
      regionId,
      fixedTroopId,
      baseExp,
      baseGold,
      battleGold,
      autoSellGold,
      exp,
      gold,
      expRate,
      goldRate,
      dropRate: Number(bridge.options.dropRate || 1),
      runtimeCount,
      dataCount,
      troopSummary: Object.values(troopGroups).sort((a, b) => b.count - a.count),
      enemySummary: Object.values(enemyGroups).sort((a, b) => b.count - a.count).slice(0, 120),
      dropSummary: Object.values(dropGroups).sort((a, b) => b.count - a.count).slice(0, 120),
      autoSell: {
        count: autoSellCount,
        gold: autoSellGold,
        summary: Object.values(autoSellGroups).sort((a, b) => b.count - a.count).slice(0, 80)
      },
      blockedDrops: {
        count: blockedDropCount,
        summary: Object.values(blockedDropGroups).sort((a, b) => b.count - a.count).slice(0, 80)
      },
      lootOptions: {
        autoSellQualities: Array.from(lootConfig.autoSellQualities),
        blockDropQualities: Array.from(lootConfig.blockDropQualities)
      },
      dropKindCounts: Object.values(dropGroups).reduce((counts, drop) => {
        const kind = drop && drop.kind || "item";
        counts[kind] = Number(counts[kind] || 0) + 1;
        return counts;
      }, {}),
      enemyBook,
      recovered,
      saved,
      goldNow: safeGold(party)
    };
    bridge.offlineHuntStats.runs = Number(bridge.offlineHuntStats.runs || 0) + 1;
    bridge.offlineHuntStats.last = { ts: Date.now(), ...result };
    bumpBattleStat("offlineHunt", { mapId, times, exp, gold, drops: result.dropSummary.length });
    refreshMapAndWindows();
    return result;
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
      fishingOptions: { ...bridge.fishingOptions },
      fishingStats: { ...bridge.fishingStats },
      fishing: fishingSummary(),
      hangup: hangupSummary(),
      offlineHunt: offlineHuntSummary(),
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

  function runtimeType(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  }

  function runtimePreview(value, maxLength) {
    const limit = maxLength || 180;
    try {
      if (typeof value === "function") {
        return String(value).replace(/\s+/g, " ").slice(0, limit);
      }
      if (typeof value === "string") return value.slice(0, limit);
      if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
      if (Array.isArray(value)) return `[array length=${value.length}]`;
      const ctor = value && value.constructor && value.constructor.name;
      return `[object ${ctor || "Object"}]`;
    } catch (error) {
      return `[preview failed: ${String(error && error.message || error)}]`;
    }
  }

  function safeOwnPropertyNames(object) {
    try {
      if (!object || (typeof object !== "object" && typeof object !== "function")) return [];
      return Object.getOwnPropertyNames(object);
    } catch (_) {
      return [];
    }
  }

  function applyRuntimePathSuffix(value, suffix) {
    const normalized = String(suffix || "")
      .replace(/\[(\d+)\]/g, ".$1")
      .replace(/^\./, "");
    if (!normalized) return value;
    const parts = normalized.split(".").filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      if (value == null) return undefined;
      value = value[parts[index]];
    }
    return value;
  }

  function readRuntimePath(pathText) {
    const raw = String(pathText || "window").trim();
    if (!raw || raw === "window") return { path: "window", value: window };
    const aliasPath = raw.match(/^alias:([A-Za-z_$][\w$]*)(.*)$/);
    if (aliasPath) {
      return { path: raw, value: applyRuntimePathSuffix(callAlias(aliasPath[1]), aliasPath[2]) };
    }
    const aliasCall = raw.match(/^(?:window\.)?TK\.\$\.([A-Za-z_$][\w$]*)\(\)(.*)$/);
    if (aliasCall) return { path: raw, value: applyRuntimePathSuffix(callAlias(aliasCall[1]), aliasCall[2]) };
    const parts = raw.split(".").filter(Boolean);
    let value = window;
    let start = 0;
    if (parts[0] === "window") start = 1;
    for (let index = start; index < parts.length; index += 1) {
      if (value == null) return { path: raw, value: undefined };
      value = value[parts[index]];
    }
    return { path: raw, value };
  }

  function runtimeInspect(command) {
    const maxKeys = Math.max(1, Math.min(1000, Math.floor(Number(command.maxKeys || 240))));
    const maxPreview = Math.max(40, Math.min(1000, Math.floor(Number(command.maxPreview || 220))));
    const { path: pathText, value } = readRuntimePath(command.path || "window");
    const rows = [];
    const pushKey = (owner, key, source) => {
      if (rows.length >= maxKeys) return;
      let item;
      try {
        item = owner[key];
      } catch (error) {
        rows.push({ key, source, error: String(error && error.message || error) });
        return;
      }
      rows.push({
        key,
        source,
        type: runtimeType(item),
        arity: typeof item === "function" ? item.length : undefined,
        preview: runtimePreview(item, maxPreview)
      });
    };

    safeOwnPropertyNames(value).sort().forEach(key => pushKey(value, key, "own"));
    if (command.prototype !== false && value && (typeof value === "object" || typeof value === "function")) {
      let proto = Object.getPrototypeOf(value);
      let depth = 0;
      while (proto && proto !== Object.prototype && rows.length < maxKeys && depth < 3) {
        safeOwnPropertyNames(proto).sort().forEach(key => {
          if (key !== "constructor") pushKey(proto, key, `proto${depth + 1}`);
        });
        proto = Object.getPrototypeOf(proto);
        depth += 1;
      }
    }

    return {
      path: pathText,
      type: runtimeType(value),
      preview: runtimePreview(value, maxPreview),
      keyCount: rows.length,
      keys: rows
    };
  }

  function runtimeSearch(command) {
    const defaultKeywords = ["fish", "fishing", "rod", "bait", "gauge"];
    const keywords = (Array.isArray(command.keywords) && command.keywords.length ? command.keywords : defaultKeywords)
      .map(value => String(value || "").toLowerCase())
      .filter(Boolean);
    const maxResults = Math.max(1, Math.min(1000, Math.floor(Number(command.maxResults || 300))));
    const maxPreview = Math.max(40, Math.min(1000, Math.floor(Number(command.maxPreview || 220))));
    const maxDepth = Math.max(0, Math.min(5, Math.floor(Number(command.maxDepth || 2))));
    const roots = [
      ["window", window],
      ["window.TK", window.TK],
      ["window.TK.$", window.TK && window.TK.$],
      ["TK.$.gameSystem()", callAlias("gameSystem")],
      ["TK.$.gameParty()", callAlias("gameParty")],
      ["TK.$.gameVariables()", callAlias("gameVariables")],
      ["TK.$.gameSwitches()", callAlias("gameSwitches")],
      ["TK.$.gameMap()", callAlias("gameMap")],
      ["TK.$.gamePlayer()", callAlias("gamePlayer")],
      ["TK.$.gameTemp()", callAlias("gameTemp")],
      ["TK.$.dataSystem()", callAlias("dataSystem")],
      ["TK.$.dataItems()", callAlias("dataItems")],
      ["TK.$.dataSkills()", callAlias("dataSkills")],
      ["TK.$.dataCommonEvents()", callAlias("dataCommonEvents")],
      ["window.$gameSystem", window.$gameSystem],
      ["window.$gameParty", window.$gameParty],
      ["window.$gameVariables", window.$gameVariables],
      ["window.$gameSwitches", window.$gameSwitches],
      ["window.$gameMap", window.$gameMap],
      ["window.$gamePlayer", window.$gamePlayer],
      ["window.$gameTemp", window.$gameTemp],
      ["window.SceneManager", window.SceneManager],
      ["window.DataManager", window.DataManager],
      ["window.Game_Interpreter.prototype", window.Game_Interpreter && window.Game_Interpreter.prototype],
      ["window.Game_System.prototype", window.Game_System && window.Game_System.prototype],
      ["window.Game_Party.prototype", window.Game_Party && window.Game_Party.prototype],
      ["window.Game_Actor.prototype", window.Game_Actor && window.Game_Actor.prototype],
      ["window.Game_Battler.prototype", window.Game_Battler && window.Game_Battler.prototype],
      ["window.Game_Action.prototype", window.Game_Action && window.Game_Action.prototype],
      ["window.Window_Base.prototype", window.Window_Base && window.Window_Base.prototype]
    ].filter(item => item[1]);
    const visited = [];
    const results = [];

    const matches = (text) => {
      const haystack = String(text == null ? "" : text).toLowerCase();
      return keywords.some(keyword => haystack.includes(keyword));
    };
    const shouldDescend = (pathText, key, value, depth) => {
      if (depth >= maxDepth) return false;
      if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
      if (visited.includes(value)) return false;
      if (/^(document|localStorage|sessionStorage|indexedDB|chrome|nw|process|require|module|exports|global|console|performance)$/i.test(String(key))) return false;
      if (matches(pathText) || matches(key)) return true;
      return depth === 0 && /^(window\.TK|window\.TK\.\$|window\.\$game|window\.Game_|window\.SceneManager|window\.DataManager)/.test(pathText);
    };

    const addResult = (pathText, key, value, source) => {
      if (results.length >= maxResults) return;
      let preview = runtimePreview(value, maxPreview);
      if (!matches(pathText) && !matches(key) && !matches(preview)) return;
      results.push({
        path: pathText,
        key,
        source,
        type: runtimeType(value),
        arity: typeof value === "function" ? value.length : undefined,
        preview
      });
    };

    const visit = (pathText, object, depth) => {
      if (!object || (typeof object !== "object" && typeof object !== "function")) return;
      if (visited.includes(object) || results.length >= maxResults) return;
      visited.push(object);
      for (const key of safeOwnPropertyNames(object).sort()) {
        if (results.length >= maxResults) break;
        let value;
        try {
          value = object[key];
        } catch (_) {
          continue;
        }
        const childPath = `${pathText}.${key}`;
        addResult(childPath, key, value, "own");
        if (shouldDescend(childPath, key, value, depth)) visit(childPath, value, depth + 1);
      }

      const proto = Object.getPrototypeOf(object);
      if (proto && proto !== Object.prototype && depth < maxDepth && !visited.includes(proto)) {
        for (const key of safeOwnPropertyNames(proto).sort()) {
          if (results.length >= maxResults) break;
          if (key === "constructor") continue;
          let value;
          try {
            value = proto[key];
          } catch (_) {
            continue;
          }
          addResult(`${pathText}::${key}`, key, value, "prototype");
        }
      }
    };

    roots.forEach(([pathText, object]) => visit(pathText, object, 0));
    return {
      keywords,
      rootCount: roots.length,
      visitedCount: visited.length,
      resultCount: results.length,
      truncated: results.length >= maxResults,
      results
    };
  }

  function fishingItemRole(item) {
    const name = String(item && item.name || "");
    const description = String(item && item.description || "");
    const note = String(item && item.note || "");
    const text = `${name}\n${description}\n${note}`;
    if (/<\s*钓竿\s*:/i.test(note) || /鱼竿/.test(description)) return "rod";
    if (/<\s*鱼饵\s*:/i.test(note) || /鱼饵/.test(description)) return "bait";
    if (!/(鱼|蟹|鱿)/.test(name)) return "";
    if (/鱼竿|鱼饵|食谱|设计图|资格证|奖章|卷轴|定位仪/.test(name + description)) return "";
    if (/食材|珍宝鱼|材料/.test(description)) return "fish";
    return "";
  }

  function addFishingItems(command) {
    const party = resolveParty();
    if (!party || typeof party.gainItem !== "function") throw new Error("party gainItem is unavailable");
    const items = resolveData("item");
    if (!items) throw new Error("item data is unavailable");
    const amount = Math.max(1, Math.floor(requireNumber(command.amount || 1, "amount")));
    const roles = new Set();
    if (Array.isArray(command.roles)) command.roles.forEach(role => roles.add(String(role)));
    if (command.rods || command.rod) roles.add("rod");
    if (command.baits || command.bait) roles.add("bait");
    if (command.fish) roles.add("fish");
    if (roles.size === 0 || command.all) {
      roles.add("rod");
      roles.add("bait");
    }
    const added = [];
    for (let id = 1; id < items.length; id += 1) {
      const item = items[id];
      if (!item) continue;
      const role = fishingItemRole(item);
      if (!role || !roles.has(role)) continue;
      party.gainItem(item, amount);
      added.push({ id, name: item.name || "", role, amount });
    }
    refreshMapAndWindows();
    bumpFishingStat("itemsAdd", { count: added.length, roles: Array.from(roles), amount });
    return { count: added.length, added };
  }

  function setFishingPower(value) {
    const party = resolveParty();
    if (!party) throw new Error("game party is unavailable");
    const next = Math.max(0, Math.floor(requireNumber(value, "value")));
    party._fishPower = next;
    try {
      setVariableValue(40, next);
    } catch (_) {}
    bumpFishingStat("powerSet", { value: next });
    return fishingSummary();
  }

  function addFishingPower(amount) {
    const party = resolveParty();
    if (!party) throw new Error("game party is unavailable");
    const delta = Math.floor(requireNumber(amount, "amount"));
    let next;
    if (typeof party.addFishPower === "function") {
      party.addFishPower(delta);
      next = Math.max(0, Number(party._fishPower || 0));
      party._fishPower = next;
    } else {
      next = Math.max(0, Number(party._fishPower || 0) + delta);
      party._fishPower = next;
    }
    try {
      setVariableValue(40, next);
    } catch (_) {}
    bumpFishingStat("powerAdd", { amount: delta, value: next });
    return fishingSummary();
  }

  function adjustFishingVariable(id, value, mode) {
    const current = Number(variableValue(id) || 0);
    const next = mode === "add"
      ? current + Math.floor(requireNumber(value, "amount"))
      : Math.floor(requireNumber(value, "value"));
    setVariableValue(id, next);
    refreshMapAndWindows();
    bumpFishingStat(mode === "add" ? "variableAdd" : "variableSet", { id, value: next });
    return fishingSummary();
  }

  function unlockFishingQualifications() {
    [364, 365, 395].forEach(id => setSwitchValue(id, true));
    const party = resolveParty();
    const items = resolveData("item");
    const added = [];
    if (party && typeof party.gainItem === "function" && items) {
      [104, 705, 704].forEach((id) => {
        const item = items[id];
        if (item) {
          party.gainItem(item, 1);
          added.push({ id, name: item.name || "" });
        }
      });
    }
    refreshMapAndWindows();
    bumpFishingStat("qualificationsUnlock", { added: added.length });
    return { switches: [364, 365, 395], added, fishing: fishingSummary() };
  }

  function catchFish(command) {
    const party = resolveParty();
    if (!party || typeof party.getFish !== "function") throw new Error("party getFish is unavailable");
    const pointId = Math.max(1, Math.floor(requireNumber(command.pointId || command.id, "pointId")));
    const times = Math.max(1, Math.min(100, Math.floor(Number(command.times || command.amount || 1))));
    const results = [];
    for (let index = 0; index < times; index += 1) {
      results.push(party.getFish(pointId));
    }
    refreshMapAndWindows();
    bumpFishingStat("catch", { pointId, times });
    return { pointId, times, results: results.map(value => runtimePreview(value, 120)), fishing: fishingSummary() };
  }

  function fishingInfo(command) {
    const limit = Math.max(1, Math.min(500, Math.floor(Number(command.limit || 160))));
    const matchFishing = (value) => /钓|渔|鱼|fish|fishing|rod|bait|海王|奖章/i.test(String(value == null ? "" : value));
    const party = resolveParty();
    const variables = resolveVariables();
    const switches = resolveSwitches();
    const systemData = callAlias("dataSystem") || window.$dataSystem || {};
    const fields = {};
    const calls = {};
    const methods = [];

    if (party) {
      ["_fishPower", "_fishUse", "_onlyFish"].forEach((key) => {
        const value = party[key];
        fields[key] = Array.isArray(value) ? value.slice(0, 80) : value;
      });
      let proto = party;
      let depth = 0;
      while (proto && depth < 4) {
        safeOwnPropertyNames(proto).forEach((key) => {
          if (matchFishing(key) && typeof proto[key] === "function" && !methods.includes(key)) methods.push(key);
        });
        proto = Object.getPrototypeOf(proto);
        depth += 1;
      }
      ["fishPower", "fishPowerActor", "fishPowerItem"].forEach((key) => {
        try {
          bridge.suppressFishingStats += 1;
          calls[key] = typeof party[key] === "function" ? party[key].call(party) : null;
        } catch (error) {
          calls[key] = { error: String(error && error.message || error) };
        } finally {
          bridge.suppressFishingStats = Math.max(0, bridge.suppressFishingStats - 1);
        }
      });
    }

    const namedRows = (names, store) => {
      const rows = [];
      (names || []).forEach((name, id) => {
        if (!id || !matchFishing(name)) return;
        let value = null;
        try {
          value = store && typeof store.value === "function" ? store.value(id) : null;
        } catch (_) {}
        rows.push({ id, name, value });
      });
      return rows;
    };

    const dataRows = (kind) => {
      const data = resolveData(kind) || [];
      const rows = [];
      for (let id = 1; id < data.length && rows.length < limit; id += 1) {
        const item = data[id];
        if (!item) continue;
        const text = [item.name, item.description, item.note].filter(Boolean).join("\n");
        if (!matchFishing(text)) continue;
        let amount = null;
        try {
          amount = party && typeof party.numItems === "function" ? party.numItems(item) : null;
        } catch (_) {}
        rows.push({
          id,
          name: item.name || "",
          description: String(item.description || "").replace(/\s+/g, " ").slice(0, 120),
          amount
        });
      }
      return rows;
    };

    return {
      options: { ...bridge.fishingOptions },
      stats: { ...bridge.fishingStats },
      summary: fishingSummary(),
      party: {
        available: !!party,
        fields,
        calls,
        methods: methods.sort()
      },
      variables: namedRows(systemData.variables, variables),
      switches: namedRows(systemData.switches, switches),
      items: dataRows("item"),
      weapons: dataRows("weapon"),
      armors: dataRows("armor"),
      skills: dataRows("skill")
    };
  }

  function execute(command) {
    if (!command || typeof command !== "object") throw new Error("invalid command");
    const type = String(command.type || "");
    if (type === "ping") {
      return collectState();
    }
    if (type === "runtime.inspect") {
      return runtimeInspect(command);
    }
    if (type === "runtime.search") {
      return runtimeSearch(command);
    }
    if (type === "fishing.info") {
      return fishingInfo(command);
    }
    if (type === "fishing.options.get") {
      return { options: { ...bridge.fishingOptions }, stats: { ...bridge.fishingStats }, fishing: fishingSummary() };
    }
    if (type === "fishing.options.set") {
      return { options: setFishingOptions(command.options || command), fishing: fishingSummary() };
    }
    if (type === "fishing.power.set") {
      return setFishingPower(command.value);
    }
    if (type === "fishing.power.add") {
      return addFishingPower(command.amount);
    }
    if (type === "fishing.medals.set") {
      return adjustFishingVariable(12, command.value, "set");
    }
    if (type === "fishing.medals.add") {
      return adjustFishingVariable(12, command.amount, "add");
    }
    if (type === "fishing.count.set") {
      return adjustFishingVariable(42, command.value, "set");
    }
    if (type === "fishing.count.add") {
      return adjustFishingVariable(42, command.amount, "add");
    }
    if (type === "fishing.items.add") {
      return addFishingItems(command);
    }
    if (type === "fishing.qualifications.unlock") {
      return unlockFishingQualifications();
    }
    if (type === "fishing.catch") {
      return catchFish(command);
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
    if (type === "battle.killEnemies") {
      return killBattleEnemies(command);
    }
    if (type === "battle.escape") {
      return escapeBattle();
    }
    if (type === "hangup.info") {
      return hangupSummary();
    }
    if (type === "hangup.start") {
      return callHangupMethod("startHangUp", "hangupStart");
    }
    if (type === "hangup.stop") {
      return callHangupMethod("stopHangUp", "hangupStop");
    }
    if (type === "hangup.refresh") {
      return callHangupMethod("refrishHangUp", "hangupRefresh");
    }
    if (type === "offlineHunt.info") {
      let preview = null;
      if (command.mapId != null && command.mapId !== "") {
        preview = offlineHuntPreview(command);
        bridge.offlineHuntStats.preview = { ts: Date.now(), ...preview };
      } else if (command.troopId != null && command.troopId !== "") {
        preview = offlineHuntPreview(command);
        bridge.offlineHuntStats.preview = { ts: Date.now(), ...preview };
      }
      return {
        stats: offlineHuntSummary(),
        preview
      };
    }
    if (type === "offlineHunt.preview") {
      const preview = offlineHuntPreview(command);
      bridge.offlineHuntStats.preview = { ts: Date.now(), ...preview };
      return preview;
    }
    if (type === "offlineHunt.run") {
      return runOfflineHunt(command);
    }
    if (type === "party.recover") {
      return recoverPartyMembers();
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
      return saveGameToSlot(command.id || 1);
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
