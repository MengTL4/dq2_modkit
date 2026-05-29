declare const nw: any;

(function () {
  const fs = require("fs");
  const path = require("path");
  const childProcess = require("child_process");

  const projectRoot = path.resolve(process.cwd(), "..", "..");
  const rootDir = resolveGameRoot(projectRoot);
  const trainerRuntimeDir = path.join(projectRoot, "runtime", "trainer");
  const trainerGameExe = path.join(trainerRuntimeDir, "Game.exe");
  const bridgeDir = path.join(projectRoot, "runtime", "bridge-state");
  const commandPath = path.join(bridgeDir, "commands.jsonl");
  const eventPath = path.join(bridgeDir, "events.jsonl");
  const statePath = path.join(bridgeDir, "state.json");
  const saveDir = path.join(rootDir, "www", "save");
  const dataDir = path.join(projectRoot, "output", "extract", "data");
  const iconDir = path.join(process.cwd(), "icons");
  const iconSetPath = path.join(rootDir, "www", "img", "system", "IconSet.png");
  const EXPECTED_BRIDGE_VERSION = "0.2.9";

  const $ = (id: string): any => document.getElementById(id);
  const dom = {
    statusPill: $("statusPill"),
    launchBtn: $("launchBtn"),
    refreshBtn: $("refreshBtn"),
    bridgeState: $("bridgeState"),
    partyState: $("partyState"),
    goldState: $("goldState"),
    goldMetric: $("goldMetric"),
    saveState: $("saveState"),
    mapState: $("mapState"),
    saveFiles: $("saveFiles"),
    partyMembers: $("partyMembers"),
    variableList: $("variableList"),
    variableListCount: $("variableListCount"),
    switchList: $("switchList"),
    switchListCount: $("switchListCount"),
    itemList: $("itemList"),
    itemListCount: $("itemListCount"),
    skillList: $("skillList"),
    skillListCount: $("skillListCount"),
    actorList: $("actorList"),
    actorListCount: $("actorListCount"),
    mapList: $("mapList"),
    mapListCount: $("mapListCount"),
    commonEventList: $("commonEventList"),
    commonEventListCount: $("commonEventListCount"),
    eventList: $("eventList"),
    battleState: $("battleState"),
    toast: $("toast")
  };

  let lastEventSize = 0;
  let switchValue = true;
  let gameProcess: any = null;
  let iconSetImage: any = null;
  let latestState: any = null;
  let recordedPosition: any = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const iconCache = new Map<number, string>();
  const catalogViews = new Map<string, any>();
  const CATALOG_ROW_HEIGHT = 88;
  const CATALOG_OVERSCAN = 8;
  const itemKindLabels: Record<string, string> = {
    item: "物品",
    weapon: "武器",
    armor: "防具"
  };
  let selectedItemKind = "item";
  const systemData = readJson(path.join(dataDir, "System.json")) || {};
  const catalogs: Record<string, any[]> = {
    variable: loadNamedArrayCatalog(systemData.variables || []),
    switch: loadNamedArrayCatalog(systemData.switches || []),
    item: loadCatalog("Items.json"),
    weapon: loadCatalog("Weapons.json"),
    armor: loadCatalog("Armors.json"),
    actor: loadCatalog("Actors.json"),
    skill: loadCatalog("Skills.json"),
    map: loadMapCatalog(),
    commonEvent: loadCommonEventCatalog()
  };
  catalogs.all = buildAllItemCatalog();

  process.env.DQ2_MODKIT_ROOT = projectRoot;
  process.env.DQ2_GAME_ROOT = rootDir;

  function resolveGameRoot(projectRoot) {
    const candidates = [];
    if (process.env.DQ2_GAME_ROOT) candidates.push(process.env.DQ2_GAME_ROOT);
    try {
      const configPath = path.join(projectRoot, "config.local.json");
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        if (config && config.gameRoot) candidates.push(String(config.gameRoot));
      }
    } catch (error) {
      throw new Error("Invalid config.local.json: " + (error && error.message || error));
    }
    candidates.push(path.resolve(projectRoot, ".."));

    for (const candidate of candidates) {
      const fullPath = path.resolve(projectRoot, expandEnv(candidate));
      if (fs.existsSync(path.join(fullPath, "www", "index.html"))) {
        return fs.realpathSync(fullPath);
      }
    }
    throw new Error("Game root not found. Set DQ2_GAME_ROOT or create config.local.json.");
  }

  function expandEnv(value) {
    return String(value).replace(/%([^%]+)%|\$\{([^}]+)\}/g, (match, winName, posixName) => {
      const name = winName || posixName;
      return process.env[name] || match;
    });
  }

  function ensureBridgeDir() {
    fs.mkdirSync(bridgeDir, { recursive: true });
  }

  function readJson(file) {
    try {
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  function loadCatalog(fileName) {
    try {
      const file = path.join(dataDir, fileName);
      if (!fs.existsSync(file)) return [];
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!Array.isArray(data)) return [];
      return data
        .filter((entry) => entry && Number.isFinite(Number(entry.id)) && entry.name)
        .map((entry) => {
          const description = cleanText(entry.description || "");
          const noteText = cleanNote(entry.note || "");
          return {
            id: Number(entry.id),
            name: String(entry.name),
            iconIndex: Number.isFinite(Number(entry.iconIndex)) ? Number(entry.iconIndex) : 0,
            description,
            noteText,
            searchText: `${entry.id} ${entry.name || ""} ${description} ${noteText}`.toLowerCase(),
            faceName: entry.faceName ? String(entry.faceName) : "",
            characterName: entry.characterName ? String(entry.characterName) : ""
          };
        });
    } catch {
      return [];
    }
  }

  function makeSearchText(parts) {
    return parts
      .filter((part) => part != null && part !== "")
      .map((part) => String(part))
      .join(" ")
      .toLowerCase();
  }

  function buildAllItemCatalog() {
    return ["item", "weapon", "armor"].flatMap((kind) => {
      const kindLabel = itemKindLabels[kind] || kind;
      return (catalogs[kind] || []).map((entry) => ({
        ...entry,
        kind,
        kindLabel,
        uid: `${kind}:${entry.id}`,
        value: `${kind}:${entry.id}`,
        label: `${kindLabel} / ${entry.name}`,
        searchText: makeSearchText([
          entry.searchText,
          entry.id,
          entry.name,
          entry.description,
          entry.noteText,
          kind,
          kindLabel
        ])
      }));
    });
  }

  function loadNamedArrayCatalog(names) {
    return names
      .map((name, index) => {
        const text = cleanText(name || "");
        return text ? {
          id: index,
          name: text,
          description: "",
          noteText: "",
          searchText: makeSearchText([index, text, name])
        } : null;
      })
      .filter(Boolean);
  }

  function loadMapCatalog() {
    const data = readJson(path.join(dataDir, "MapInfos.json")) || [];
    if (!Array.isArray(data)) return [];
    return data
      .filter((entry) => entry && Number.isFinite(Number(entry.id)) && entry.name)
      .map((entry) => {
        const parent = entry.parentId == null ? "" : `父级 ${entry.parentId}`;
        const order = entry.order == null ? "" : `序 ${entry.order}`;
        return {
          id: Number(entry.id),
          name: cleanText(entry.name),
          description: [parent, order].filter(Boolean).join(" / "),
          noteText: "",
          parentId: entry.parentId,
          order: entry.order,
          searchText: makeSearchText([entry.id, entry.name, parent, order])
        };
      });
  }

  function loadCommonEventCatalog() {
    const data = readJson(path.join(dataDir, "CommonEvents.json")) || [];
    if (!Array.isArray(data)) return [];
    return data
      .filter((entry) => entry && Number.isFinite(Number(entry.id)) && entry.name)
      .map((entry) => {
        const trigger = entry.trigger === 1 ? "自动" : entry.trigger === 2 ? "并行" : "调用";
        const sw = entry.switchId ? `开关 ${entry.switchId}` : "";
        return {
          id: Number(entry.id),
          name: cleanText(entry.name),
          description: [trigger, sw].filter(Boolean).join(" / "),
          noteText: "",
          trigger: entry.trigger,
          switchId: entry.switchId,
          searchText: makeSearchText([entry.id, entry.name, trigger, sw])
        };
      });
  }

  function cleanText(value) {
    return String(value == null ? "" : value)
      .replace(/\\[A-Z]+\[[^\]]*\]/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanNote(value) {
    return cleanText(value)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function catalogName(kind, id) {
    const list = catalogs[kind] || [];
    const item = list.find((entry) => {
      if (kind === "all") return entry.uid === String(id) || entry.id === Number(id);
      return entry.id === Number(id);
    });
    return item ? item.name : "";
  }

  function populateDatalist(id, entries) {
    const list = $(id);
    if (!list) return;
    list.innerHTML = entries
      .map((entry) => {
        const value = entry.value != null ? entry.value : entry.uid != null ? entry.uid : entry.id;
        const label = entry.label || entry.name;
        return `<option value="${escapeHtml(value)}" label="${escapeHtml(label)}"></option>`;
      })
      .join("");
  }

  function setupIconSet() {
    try {
      const bytes = decryptProtectedImage(fs.readFileSync(iconSetPath));
      const image = new Image();
      image.onload = () => {
        iconSetImage = image;
        renderCatalogs();
      };
      image.onerror = () => showToast("图标集图片解码失败");
      image.src = `data:image/png;base64,${bytes.toString("base64")}`;
    } catch (error) {
      showToast(`图标集加载失败：${error.message}`);
    }
  }

  function decryptProtectedImage(input) {
    const data = Buffer.from(input);
    if (data.length <= 100) return data;
    const head = data.subarray(0, 100);
    const body = unshuffleBytes(data.subarray(100));
    for (let i = 0; i < body.length; i += 1) {
      body[i] ^= (i % 256) ^ 90;
    }
    return Buffer.concat([head, body]);
  }

  function unshuffleBytes(input) {
    const bytes = Array.from(input);
    const swaps = [];
    let remaining = bytes.length;
    const random = (max) => {
      const value = 10000 * Math.sin(12345 + remaining);
      return Math.floor((value - Math.floor(value)) * max);
    };
    while (remaining !== 0) {
      swaps.push(random(remaining));
      remaining -= 1;
    }
    const positions = Array.from({ length: bytes.length }, (_, index) => index);
    for (let i = 0; i < swaps.length; i += 1) {
      const from = swaps[i];
      const to = positions.length - 1 - i;
      if (from < to) {
        const old = positions[from];
        positions[from] = positions[to];
        positions[to] = old;
      }
    }
    const output = new Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) output[positions[i]] = bytes[i];
    return Buffer.from(output);
  }

  function iconDataUrl(iconIndex) {
    const index = Math.max(0, Math.floor(Number(iconIndex) || 0));
    if (iconCache.has(index)) return iconCache.get(index);
    if (!iconSetImage) return "";
    const x = (index % 16) * 32;
    const y = Math.floor(index / 16) * 32;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.drawImage(iconSetImage, x, y, 32, 32, 0, 0, 32, 32);
    const dataUrl = canvas.toDataURL("image/png");
    iconCache.set(index, dataUrl);
    return dataUrl;
  }

  function iconHtml(iconIndex) {
    const index = Math.max(0, Math.floor(Number(iconIndex) || 0));
    const fileName = `icon_${index}.png`;
    if (fs.existsSync(path.join(iconDir, fileName))) {
      return `<img class="rpg-icon" src="icons/${fileName}" alt="">`;
    }
    const dataUrl = iconDataUrl(iconIndex);
    if (!dataUrl) return '<span class="rpg-icon icon-pending"></span>';
    return `<img class="rpg-icon" src="${dataUrl}" alt="">`;
  }

  function actorAvatarHtml(actor) {
    return `<span class="actor-avatar">${escapeHtml(actor.id)}</span>`;
  }

  function badgeHtml(label, tone = "") {
    return `<span class="catalog-badge ${tone}">${escapeHtml(label)}</span>`;
  }

  function filterEntries(entries, query) {
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => {
      return entry.searchText
        ? entry.searchText.includes(needle)
        : String(entry.id).includes(needle) || entry.name.toLowerCase().includes(needle);
    });
  }

  function selectedNumber(id) {
    return Number(numberValue(id, NaN));
  }

  function parseItemSelection() {
    const raw = String($("itemId").value || "").trim();
    const match = raw.match(/^(item|weapon|armor)\s*:\s*(\d+)$/i);
    if (match) {
      return { kind: match[1].toLowerCase(), id: Number(match[2]), raw: `${match[1].toLowerCase()}:${match[2]}` };
    }
    const chooserKind = $("itemKind").value;
    const kind = chooserKind === "all" ? selectedItemKind : chooserKind;
    return { kind, id: numberValue("itemId", NaN), raw };
  }

  function itemSelectionKey(selection) {
    return `${selection.kind}:${selection.id}`;
  }

  function debounce(fn, delay = 120) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function catalogRowHtml(entry, options, selectedId, top) {
    const rowKey = options.key ? options.key(entry) : entry.id;
    const rowKind = options.rowKind ? options.rowKind(entry) : options.kind || "";
    const active = String(rowKey) === String(selectedId) ? " active" : "";
    const leading = options.leading(entry);
    const actions = options.actions(entry);
    const extra = options.extra ? options.extra(entry) : "";
    const description = options.description ? options.description(entry) : "";
    return `<div class="catalog-row${active}" style="top:${top}px" data-kind="${escapeHtml(rowKind)}" data-id="${entry.id}">
      ${leading}
      <div class="catalog-main">
        <span class="catalog-name">${escapeHtml(entry.name)}</span>
        <span class="catalog-meta">ID ${entry.id}${extra ? " / " + escapeHtml(extra) : ""}</span>
        ${description ? `<span class="catalog-desc">${escapeHtml(description)}</span>` : ""}
      </div>
      <div class="catalog-actions">${actions}</div>
    </div>`;
  }

  function renderVirtualCatalog(target) {
    const view = catalogViews.get(target.id);
    if (!view) return;
    const entries = view.entries;
    const options = view.options;
    if (!entries.length) {
      target.innerHTML = '<div class="catalog-empty">没有匹配项</div>';
      return;
    }
    const rowHeight = view.rowHeight;
    const viewportHeight = target.clientHeight || 620;
    const scrollTop = target.scrollTop || 0;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - CATALOG_OVERSCAN);
    const end = Math.min(entries.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + CATALOG_OVERSCAN);
    const selectedId = options.selectedId;
    const rows = [];
    for (let index = start; index < end; index += 1) {
      rows.push(catalogRowHtml(entries[index], options, selectedId, index * rowHeight));
    }
    target.innerHTML = `<div class="catalog-spacer" style="height:${entries.length * rowHeight}px">${rows.join("")}</div>`;
  }

  function renderCatalogList(target, entries, options) {
    const previous = catalogViews.get(target.id);
    const queryKey = `${options.kind || ""}:${options.query || ""}`;
    catalogViews.set(target.id, {
      entries,
      options,
      rowHeight: CATALOG_ROW_HEIGHT,
      queryKey
    });
    if (!previous || previous.queryKey !== queryKey) target.scrollTop = 0;
    renderVirtualCatalog(target);
    if (options.countTarget) {
      options.countTarget.textContent = entries.length ? `共 ${entries.length} 条，全量可搜索/滚动` : "0 条";
    }
  }

  function renderItemList() {
    const kind = $("itemKind").value;
    const entries = filterEntries(catalogs[kind] || [], $("itemSearch").value);
    const selection = parseItemSelection();
    renderCatalogList(dom.itemList, entries, {
      kind,
      query: $("itemSearch").value,
      selectedId: kind === "all" ? itemSelectionKey(selection) : selection.id,
      key: (entry) => entry.uid || entry.id,
      rowKind: (entry) => entry.kind || kind,
      leading: (entry) => iconHtml(entry.iconIndex),
      extra: (entry) => entry.kindLabel || "",
      actions: (entry) => `<button data-catalog-action="item-add" data-kind="${entry.kind || kind}" data-id="${entry.id}">添加</button>`,
      description: (entry) => entry.description || entry.noteText,
      countTarget: dom.itemListCount
    });
  }

  function renderSkillList() {
    const entries = filterEntries(catalogs.skill || [], $("skillSearch").value);
    renderCatalogList(dom.skillList, entries, {
      kind: "skill",
      query: $("skillSearch").value,
      selectedId: selectedNumber("skillId"),
      leading: (entry) => iconHtml(entry.iconIndex),
      actions: (entry) => `<button data-catalog-action="skill-learn" data-id="${entry.id}">学会</button><button data-catalog-action="skill-forget" data-id="${entry.id}">遗忘</button>`,
      description: (entry) => entry.description || entry.noteText,
      countTarget: dom.skillListCount
    });
  }

  function renderActorList() {
    const entries = filterEntries(catalogs.actor || [], $("actorSearch").value);
    renderCatalogList(dom.actorList, entries, {
      kind: "actor",
      query: $("actorSearch").value,
      selectedId: selectedNumber("actorId"),
      leading: actorAvatarHtml,
      extra: (entry) => entry.faceName || entry.characterName || "",
      actions: (entry) => `<button data-catalog-action="actor-unlock" data-id="${entry.id}">解锁</button><button data-catalog-action="actor-select" data-id="${entry.id}">编辑</button>`,
      countTarget: dom.actorListCount
    });
  }

  function renderVariableList() {
    const entries = filterEntries(catalogs.variable || [], $("variableSearch").value);
    renderCatalogList(dom.variableList, entries, {
      kind: "variable",
      query: $("variableSearch").value,
      selectedId: selectedNumber("variableId"),
      leading: (entry) => badgeHtml(entry.id, "var"),
      actions: (entry) => `<button data-catalog-action="variable-select" data-id="${entry.id}">填入</button><button data-catalog-action="variable-set" data-id="${entry.id}">写入</button>`,
      countTarget: dom.variableListCount
    });
  }

  function renderSwitchList() {
    const entries = filterEntries(catalogs.switch || [], $("switchSearch").value);
    renderCatalogList(dom.switchList, entries, {
      kind: "switch",
      query: $("switchSearch").value,
      selectedId: selectedNumber("switchId"),
      leading: (entry) => badgeHtml(entry.id, "switch"),
      actions: (entry) => `<button data-catalog-action="switch-on" data-id="${entry.id}">ON</button><button data-catalog-action="switch-off" data-id="${entry.id}">OFF</button>`,
      countTarget: dom.switchListCount
    });
  }

  function renderMapList() {
    const entries = filterEntries(catalogs.map || [], $("mapSearch").value);
    renderCatalogList(dom.mapList, entries, {
      kind: "map",
      query: $("mapSearch").value,
      selectedId: selectedNumber("mapId"),
      leading: (entry) => badgeHtml(entry.id, "map"),
      actions: (entry) => `<button data-catalog-action="map-transfer" data-id="${entry.id}">传送</button>`,
      description: (entry) => entry.description,
      countTarget: dom.mapListCount
    });
  }

  function renderCommonEventList() {
    const entries = filterEntries(catalogs.commonEvent || [], $("commonEventSearch").value);
    renderCatalogList(dom.commonEventList, entries, {
      kind: "commonEvent",
      query: $("commonEventSearch").value,
      selectedId: selectedNumber("commonEventId"),
      leading: (entry) => badgeHtml(entry.id, "event"),
      actions: (entry) => `<button data-catalog-action="common-event-run" data-id="${entry.id}">运行</button>`,
      description: (entry) => entry.description,
      countTarget: dom.commonEventListCount
    });
  }

  function renderCatalogs() {
    renderVariableList();
    renderSwitchList();
    renderItemList();
    renderSkillList();
    renderActorList();
    renderMapList();
    renderCommonEventList();
  }

  function readEvents() {
    try {
      if (!fs.existsSync(eventPath)) return [];
      const text = fs.readFileSync(eventPath, "utf8").trim();
      if (!text) return [];
      return text.split(/\r?\n/).map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove("show"), 2600);
  }

  function setStatus(kind, text) {
    dom.statusPill.className = `status status-${kind}`;
    dom.statusPill.textContent = text;
  }

  function formatNumber(value) {
    if (value == null || value === "") return "-";
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return new Intl.NumberFormat("zh-CN").format(number);
  }

  function parseValue(text) {
    const value = String(text).trim();
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null") return null;
    if (value !== "" && Number.isFinite(Number(value))) return Number(value);
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function numberValue(id, fallback = 0) {
    const value = looseNumber($(id).value);
    return Number.isFinite(value) ? value : fallback;
  }

  function optionalNumber(id) {
    const text = String($(id).value).trim();
    if (text === "") return undefined;
    const value = looseNumber(text);
    return Number.isFinite(value) ? value : undefined;
  }

  function looseNumber(value) {
    const text = String(value == null ? "" : value).trim();
    if (text === "") return NaN;
    const direct = Number(text);
    if (Number.isFinite(direct)) return direct;
    const match = text.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : NaN;
  }

  function activeActorId() {
    return numberValue("actorId", 0);
  }

  function skillActorId() {
    return numberValue("skillActorId", activeActorId());
  }

  function updateLookupHints() {
    const itemSelection = parseItemSelection();
    const itemName = catalogName(itemSelection.kind, itemSelection.id);
    const itemKindLabel = itemKindLabels[itemSelection.kind] || itemSelection.kind;
    $("itemHint").textContent = itemName ? `${itemKindLabel} ${itemSelection.id} / ${itemName}` : "";

    const actorId = numberValue("actorId", NaN);
    const actorName = catalogName("actor", actorId);
    $("actorHint").textContent = actorName ? `${actorId} / ${actorName}` : "";

    const skillActorName = catalogName("actor", numberValue("skillActorId", NaN));
    const skillName = catalogName("skill", numberValue("skillId", NaN));
    $("skillHint").textContent = [skillActorName, skillName].filter(Boolean).join(" / ");

    const variableName = catalogName("variable", numberValue("variableId", NaN));
    $("variableHint").textContent = variableName ? `${$("variableId").value} / ${variableName}` : "";

    const switchName = catalogName("switch", numberValue("switchId", NaN));
    $("switchHint").textContent = switchName ? `${$("switchId").value} / ${switchName}` : "";

    const mapName = catalogName("map", numberValue("mapId", NaN));
    $("mapHint").textContent = mapName ? `${$("mapId").value} / ${mapName}` : "";

    const commonEventName = catalogName("commonEvent", numberValue("commonEventId", NaN));
    $("commonEventHint").textContent = commonEventName ? `${$("commonEventId").value} / ${commonEventName}` : "";
  }

  function setupCatalogs() {
    populateDatalist("allOptions", catalogs.all);
    populateDatalist("itemOptions", catalogs.item);
    populateDatalist("weaponOptions", catalogs.weapon);
    populateDatalist("armorOptions", catalogs.armor);
    populateDatalist("actorOptions", catalogs.actor);
    populateDatalist("skillOptions", catalogs.skill);
    populateDatalist("variableOptions", catalogs.variable);
    populateDatalist("switchOptions", catalogs.switch);
    populateDatalist("mapOptions", catalogs.map);
    populateDatalist("commonEventOptions", catalogs.commonEvent);
    $("itemKind").addEventListener("change", () => {
      const kind = $("itemKind").value;
      $("itemId").setAttribute("list", `${kind}Options`);
      if (kind === "all") {
        const selection = parseItemSelection();
        if (Number.isFinite(selection.id)) $("itemId").value = itemSelectionKey(selection);
      } else if (/^(item|weapon|armor)\s*:/i.test($("itemId").value)) {
        $("itemId").value = String(parseItemSelection().id || "");
      }
      updateLookupHints();
      renderItemList();
    });
    $("itemSearch").addEventListener("input", debounce(renderItemList));
    $("skillSearch").addEventListener("input", debounce(renderSkillList));
    $("actorSearch").addEventListener("input", debounce(renderActorList));
    $("variableSearch").addEventListener("input", debounce(renderVariableList));
    $("switchSearch").addEventListener("input", debounce(renderSwitchList));
    $("mapSearch").addEventListener("input", debounce(renderMapList));
    $("commonEventSearch").addEventListener("input", debounce(renderCommonEventList));
    $("itemId").addEventListener("input", () => {
      updateLookupHints();
      renderItemList();
    });
    $("actorId").addEventListener("input", () => {
      updateLookupHints();
      renderActorList();
    });
    $("skillId").addEventListener("input", () => {
      updateLookupHints();
      renderSkillList();
    });
    ["skillActorId"].forEach((id) => {
      $(id).addEventListener("input", updateLookupHints);
    });
    ["variableId", "switchId", "mapId", "commonEventId"].forEach((id) => {
      $(id).addEventListener("input", () => {
        updateLookupHints();
        if (id === "variableId") renderVariableList();
        else if (id === "switchId") renderSwitchList();
        else if (id === "mapId") renderMapList();
        else if (id === "commonEventId") renderCommonEventList();
      });
    });
    updateLookupHints();
    renderCatalogs();
  }

  function bindVirtualScroll(target) {
    target.addEventListener("scroll", () => {
      if (target.__catalogScrollFrame) return;
      target.__catalogScrollFrame = requestAnimationFrame(() => {
        target.__catalogScrollFrame = 0;
        renderVirtualCatalog(target);
      });
    });
  }

  function sendCommand(command) {
    ensureBridgeDir();
    const payload = {
      ...command,
      commandId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ts: Date.now()
    };
    fs.appendFileSync(commandPath, JSON.stringify(payload) + "\n", "utf8");
    showToast(`已发送：${payload.type}`);
    return payload;
  }

  function launchGame() {
    if (!fs.existsSync(trainerGameExe)) {
      showToast("找不到启动器运行时");
      return;
    }
    try {
      gameProcess = childProcess.spawn(trainerGameExe, {
        cwd: trainerRuntimeDir,
        env: {
          ...process.env,
          DQ2_MODKIT_ROOT: projectRoot,
          DQ2_GAME_ROOT: rootDir
        },
        detached: true,
        stdio: "ignore"
      });
      gameProcess.unref();
      showToast(`游戏已启动 PID ${gameProcess.pid}`);
    } catch (error) {
      showToast(`启动失败：${error.message}`);
    }
  }

  function openFolder(folder) {
    try {
      fs.mkdirSync(folder, { recursive: true });
      nw.Shell.openItem(folder);
    } catch (error) {
      showToast(error.message);
    }
  }

  function copyDirectory(source, target) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const src = path.join(source, entry.name);
      const dst = path.join(target, entry.name);
      if (entry.isDirectory()) copyDirectory(src, dst);
      else fs.copyFileSync(src, dst);
    }
  }

  function backupSaves() {
    if (!fs.existsSync(saveDir)) {
      showToast("没有找到存档目录");
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(projectRoot, "output", "backup", "save", stamp);
    copyDirectory(saveDir, target);
    showToast("存档已备份");
    openFolder(target);
  }

  function clearEvents() {
    ensureBridgeDir();
    fs.writeFileSync(eventPath, "", "utf8");
    lastEventSize = 0;
    renderEvents([]);
    showToast("事件已清空");
  }

  function sendOptions(options) {
    sendCommand({ type: "trainer.options.set", options });
  }

  function selectItem(kind, id, keepChooser = false) {
    selectedItemKind = kind;
    if (!keepChooser) $("itemKind").value = kind;
    const chooserKind = $("itemKind").value;
    $("itemId").setAttribute("list", `${chooserKind}Options`);
    $("itemId").value = chooserKind === "all" ? `${kind}:${id}` : String(id);
    updateLookupHints();
    renderItemList();
  }

  function selectActor(id) {
    $("actorId").value = String(id);
    $("skillActorId").value = String(id);
    updateLookupHints();
    renderActorList();
  }

  function selectSkill(id) {
    $("skillId").value = String(id);
    updateLookupHints();
    renderSkillList();
  }

  function selectVariable(id) {
    $("variableId").value = String(id);
    updateLookupHints();
    renderVariableList();
  }

  function selectSwitch(id, value = switchValue) {
    $("switchId").value = String(id);
    if (value !== undefined) {
      switchValue = !!value;
      $("switchOnBtn").classList.toggle("active", switchValue);
      $("switchOffBtn").classList.toggle("active", !switchValue);
    }
    updateLookupHints();
    renderSwitchList();
  }

  function selectMap(id) {
    $("mapId").value = String(id);
    updateLookupHints();
    renderMapList();
  }

  function selectCommonEvent(id) {
    $("commonEventId").value = String(id);
    updateLookupHints();
    renderCommonEventList();
  }

  function addItem(kind, id) {
    selectItem(kind, id, $("itemKind").value === "all");
    sendCommand({
      type: "item.add",
      kind,
      id: Number(id),
      amount: numberValue("itemAmount", 1)
    });
  }

  function unlockActor(id) {
    selectActor(id);
    sendCommand({ type: "actor.unlock", id: Number(id) });
  }

  function learnSkill(id) {
    selectSkill(id);
    sendCommand({ type: "actor.skill.learn", id: skillActorId(), skillId: Number(id) });
  }

  function forgetSkill(id) {
    selectSkill(id);
    sendCommand({ type: "actor.skill.forget", id: skillActorId(), skillId: Number(id) });
  }

  function setVariable(id) {
    selectVariable(id);
    sendCommand({ type: "variable.set", id: Number(id), value: parseValue($("variableValue").value) });
  }

  function setSwitch(id, value) {
    selectSwitch(id, value);
    sendCommand({ type: "switch.set", id: Number(id), value: !!value });
  }

  function transferMap(id) {
    selectMap(id);
    sendCommand({
      type: "map.transfer",
      mapId: Number(id),
      x: numberValue("mapX", 10),
      y: numberValue("mapY", 10),
      direction: numberValue("mapDirection", 2),
      fade: numberValue("mapFade", 0)
    });
  }

  function runCommonEvent(id) {
    selectCommonEvent(id);
    sendCommand({ type: "commonEvent.run", id: Number(id) });
  }

  function handleCatalogClick(event) {
    const actionButton = event.target.closest("[data-catalog-action]");
    const row = event.target.closest(".catalog-row");
    if (!row) return;
    const id = Number(row.dataset.id);
    const kind = row.dataset.kind;

    if (!actionButton) {
      if (kind === "item" || kind === "weapon" || kind === "armor") selectItem(kind, id, $("itemKind").value === "all");
      else if (kind === "skill") selectSkill(id);
      else if (kind === "actor") selectActor(id);
      else if (kind === "variable") selectVariable(id);
      else if (kind === "switch") selectSwitch(id);
      else if (kind === "map") selectMap(id);
      else if (kind === "commonEvent") selectCommonEvent(id);
      return;
    }

    const action = actionButton.dataset.catalogAction;
    if (action === "item-add") addItem(kind, id);
    else if (action === "skill-learn") learnSkill(id);
    else if (action === "skill-forget") forgetSkill(id);
    else if (action === "actor-unlock") unlockActor(id);
    else if (action === "actor-select") selectActor(id);
    else if (action === "variable-select") selectVariable(id);
    else if (action === "variable-set") setVariable(id);
    else if (action === "switch-on") setSwitch(id, true);
    else if (action === "switch-off") setSwitch(id, false);
    else if (action === "map-transfer") transferMap(id);
    else if (action === "common-event-run") runCommonEvent(id);
  }

  function renderState(state) {
    latestState = state;
    if (!state) {
      setStatus("idle", "未连接");
      dom.bridgeState.textContent = "等待 bridge";
      dom.partyState.textContent = "-";
      dom.goldState.textContent = "-";
      dom.goldMetric.textContent = "0";
      dom.saveState.textContent = "-";
      dom.mapState.textContent = "-";
      dom.saveFiles.innerHTML = "";
      dom.partyMembers.innerHTML = "";
      dom.battleState.textContent = "";
      return;
    }

    const age = Date.now() - Number(state.ts || 0);
    const fresh = age >= 0 && age < 5000;
    const version = state.bridgeVersion || "?";
    const versionOk = version === EXPECTED_BRIDGE_VERSION;
    if (!fresh) setStatus("idle", "离线");
    else if (!versionOk) setStatus("error", "需重启");
    else if (state.lastError) setStatus("error", "有错误");
    else if (state.hasParty) setStatus("online", "已连接");
    else setStatus("idle", "加载中");

    dom.bridgeState.textContent = fresh
      ? `${state.storagePatched ? "已接入" : "已注入"} v${version}${versionOk ? "" : ` -> v${EXPECTED_BRIDGE_VERSION}`}`
      : "上次状态";
    dom.partyState.textContent = state.hasParty ? "可用" : "未就绪";
    dom.goldState.textContent = formatNumber(state.gold);
    dom.goldMetric.textContent = formatNumber(state.gold || 0);
    dom.saveState.textContent = state.saveDirExists ? "已识别" : "缺失";
    const currentMap = state.currentMap || {};
    dom.mapState.textContent = currentMap.mapId
      ? `${currentMap.mapId} (${currentMap.x ?? "-"}, ${currentMap.y ?? "-"})`
      : "-";

    const files = Array.isArray(state.saveFiles) ? state.saveFiles : [];
    dom.saveFiles.innerHTML = files.length
      ? files.map((name) => `<li>${escapeHtml(name)}</li>`).join("")
      : "<li>未检测到</li>";

    const members = Array.isArray(state.partyMembers) ? state.partyMembers : [];
    dom.partyMembers.innerHTML = members.length
      ? members.map((actor) => {
        const vitals = `Lv.${actor.level || "-"} HP ${actor.hp ?? "-"}/${actor.mhp ?? "-"} MP ${actor.mp ?? "-"}/${actor.mmp ?? "-"}`;
        return `<li><strong>${escapeHtml(actor.id)} / ${escapeHtml(actor.name || "")}</strong><span>${escapeHtml(vitals)}</span></li>`;
      }).join("")
      : "<li>未检测到</li>";

    const options = fresh ? (state.trainerOptions || {}) : {};
    if (fresh) updateOptionInputs(options);
    updateBattleButtons(options, fresh && state.hooksPatched, fresh ? state.rateStats : null, fresh ? state.battleStats : null);
  }

  function updateOptionInputs(options) {
    [["expRate", options.expRate], ["goldRate", options.goldRate], ["dropRate", options.dropRate], ["skillRate", options.skillRate]].forEach(([id, value]) => {
      const input = $(id);
      if (document.activeElement !== input && value != null) input.value = value;
    });
  }

  function updateBattleButtons(options, hooksPatched, rateStats, battleStats) {
    $("noCostBtn").classList.toggle("active", !!options.noSkillCost);
    const noCost = options.noSkillCost ? "无耗ON" : "无耗OFF";
    const last = rateStats && rateStats.last
      ? `倍率命中 ${rateStats.last.name}`
      : "倍率未命中";
    const battle = battleStats && battleStats.last
      ? `战斗命中 ${battleStats.last.name}`
      : "战斗未命中";
    dom.battleState.textContent = `${noCost} / hooks ${hooksPatched ? "OK" : "--"} / ${last} / ${battle}`;
  }

  function renderEvents(events) {
    const latest = events.slice(-40).reverse();
    if (latest.length === 0) {
      dom.eventList.innerHTML = '<div class="event"><div class="event-time">--:--</div><div class="event-body">暂无事件</div></div>';
      return;
    }
    dom.eventList.innerHTML = latest.map((event) => {
      const time = new Date(event.ts || Date.now()).toLocaleTimeString("zh-CN", { hour12: false });
      const ok = event.ok !== false;
      const payload = event.payload ? JSON.stringify(event.payload) : "";
      return `<div class="event ${ok ? "" : "fail"}"><div class="event-time">${escapeHtml(time)}</div><div class="event-body">${escapeHtml(event.type || "event")} ${ok ? "OK" : "FAIL"} ${escapeHtml(payload)}</div></div>`;
    }).join("");
  }

  function refresh() {
    const state = readJson(statePath);
    renderState(state);

    try {
      const size = fs.existsSync(eventPath) ? fs.statSync(eventPath).size : 0;
      if (size !== lastEventSize) {
        lastEventSize = size;
        renderEvents(readEvents());
      }
    } catch {
      renderEvents([]);
    }
  }

  function activateTab(tab) {
    document.querySelectorAll<HTMLElement>("[data-tool-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.toolTab === tab);
    });
    document.querySelectorAll<HTMLElement>("[data-tool-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.toolPanel !== tab;
    });
    requestAnimationFrame(renderCatalogs);
  }

  function recordCurrentPosition() {
    const map = latestState && latestState.currentMap;
    if (!map || !map.mapId) {
      showToast("还没有读取到当前位置");
      return;
    }
    recordedPosition = {
      mapId: Number(map.mapId),
      x: Number(map.x || 0),
      y: Number(map.y || 0),
      direction: Number(map.direction || 2),
      fade: 0
    };
    $("recordedPosition").textContent = `${recordedPosition.mapId} (${recordedPosition.x}, ${recordedPosition.y})`;
    showToast("已记录当前位置");
  }

  function returnRecordedPosition() {
    if (!recordedPosition) {
      showToast("还没有记录位置");
      return;
    }
    $("mapId").value = String(recordedPosition.mapId);
    $("mapX").value = String(recordedPosition.x);
    $("mapY").value = String(recordedPosition.y);
    $("mapDirection").value = String(recordedPosition.direction);
    $("mapFade").value = String(recordedPosition.fade);
    updateLookupHints();
    transferMap(recordedPosition.mapId);
  }

  function bind() {
    document.querySelectorAll<HTMLElement>("[data-tool-tab]").forEach((button) => {
      button.addEventListener("click", () => activateTab(button.dataset.toolTab));
    });
    dom.launchBtn.addEventListener("click", launchGame);
    dom.refreshBtn.addEventListener("click", refresh);
    dom.itemList.addEventListener("click", handleCatalogClick);
    dom.skillList.addEventListener("click", handleCatalogClick);
    dom.actorList.addEventListener("click", handleCatalogClick);
    dom.variableList.addEventListener("click", handleCatalogClick);
    dom.switchList.addEventListener("click", handleCatalogClick);
    dom.mapList.addEventListener("click", handleCatalogClick);
    dom.commonEventList.addEventListener("click", handleCatalogClick);
    bindVirtualScroll(dom.itemList);
    bindVirtualScroll(dom.skillList);
    bindVirtualScroll(dom.actorList);
    bindVirtualScroll(dom.variableList);
    bindVirtualScroll(dom.switchList);
    bindVirtualScroll(dom.mapList);
    bindVirtualScroll(dom.commonEventList);

    $("goldSetBtn").addEventListener("click", () => sendCommand({ type: "gold.set", value: Number($("goldValue").value || 0) }));
    $("goldAddBtn").addEventListener("click", () => sendCommand({ type: "gold.add", amount: Number($("goldValue").value || 0) }));
    document.querySelectorAll<HTMLElement>("[data-gold-add]").forEach((button) => {
      button.addEventListener("click", () => sendCommand({ type: "gold.add", amount: Number(button.dataset.goldAdd) }));
    });
    document.querySelectorAll<HTMLElement>("[data-gold-set]").forEach((button) => {
      button.addEventListener("click", () => sendCommand({ type: "gold.set", value: Number(button.dataset.goldSet) }));
    });

    $("variableSetBtn").addEventListener("click", () => setVariable(numberValue("variableId", 0)));

    $("switchOnBtn").addEventListener("click", () => {
      switchValue = true;
      $("switchOnBtn").classList.add("active");
      $("switchOffBtn").classList.remove("active");
    });
    $("switchOffBtn").addEventListener("click", () => {
      switchValue = false;
      $("switchOffBtn").classList.add("active");
      $("switchOnBtn").classList.remove("active");
    });
    $("switchSetBtn").addEventListener("click", () => setSwitch(numberValue("switchId", 0), switchValue));

    $("itemAddBtn").addEventListener("click", () => {
      const selection = parseItemSelection();
      sendCommand({
        type: "item.add",
        kind: selection.kind,
        id: selection.id,
        amount: numberValue("itemAmount", 1)
      });
    });

    $("actorUnlockBtn").addEventListener("click", () => unlockActor(activeActorId()));
    $("actorAddBtn").addEventListener("click", () => sendCommand({ type: "actor.unlock", id: activeActorId() }));
    $("actorRemoveBtn").addEventListener("click", () => sendCommand({ type: "actor.remove", id: activeActorId() }));
    $("actorRecoverBtn").addEventListener("click", () => sendCommand({ type: "actor.recover", id: activeActorId() }));
    $("actorLevelBtn").addEventListener("click", () => sendCommand({
      type: "actor.level.set",
      id: activeActorId(),
      level: numberValue("actorLevel", 1)
    }));
    $("actorExpBtn").addEventListener("click", () => sendCommand({
      type: "actor.exp.add",
      id: activeActorId(),
      amount: numberValue("actorExp", 0)
    }));
    $("actorVitalsBtn").addEventListener("click", () => sendCommand({
      type: "actor.vitals.set",
      id: activeActorId(),
      hp: optionalNumber("actorHp"),
      mp: optionalNumber("actorMp"),
      tp: optionalNumber("actorTp")
    }));
    $("actorParamBtn").addEventListener("click", () => sendCommand({
      type: "actor.param.add",
      id: activeActorId(),
      paramId: numberValue("paramId", 0),
      value: numberValue("paramValue", 0)
    }));

    $("skillLearnBtn").addEventListener("click", () => sendCommand({
      type: "actor.skill.learn",
      id: skillActorId(),
      skillId: numberValue("skillId", 0)
    }));
    $("skillForgetBtn").addEventListener("click", () => sendCommand({
      type: "actor.skill.forget",
      id: skillActorId(),
      skillId: numberValue("skillId", 0)
    }));
    $("unlockEnemyBookBtn").addEventListener("click", () => sendCommand({ type: "progress.enemyBook.unlock" }));
    $("ratesApplyBtn").addEventListener("click", () => sendOptions({
      expRate: numberValue("expRate", 1),
      goldRate: numberValue("goldRate", 1),
      dropRate: numberValue("dropRate", 1),
      skillRate: numberValue("skillRate", 1)
    }));
    document.querySelectorAll<HTMLElement>("[data-rate]").forEach((button) => {
      button.addEventListener("click", () => {
        const rate = Number(button.dataset.rate || 1);
        $("expRate").value = rate;
        $("goldRate").value = rate;
        $("dropRate").value = rate;
        $("skillRate").value = rate;
        sendOptions({ expRate: rate, goldRate: rate, dropRate: rate, skillRate: rate });
      });
    });

    $("noCostBtn").addEventListener("click", () => sendOptions({ noSkillCost: !$("noCostBtn").classList.contains("active") }));
    $("partyRecoverBtn").addEventListener("click", () => sendCommand({ type: "party.recover" }));
    $("mapTransferBtn").addEventListener("click", () => transferMap(numberValue("mapId", 0)));
    $("recordPositionBtn").addEventListener("click", recordCurrentPosition);
    $("returnPositionBtn").addEventListener("click", returnRecordedPosition);
    $("commonEventRunBtn").addEventListener("click", () => runCommonEvent(numberValue("commonEventId", 0)));

    $("saveGameBtn").addEventListener("click", () => sendCommand({ type: "save", id: Number($("saveSlot").value || 1) }));
    $("titleRefreshBtn").addEventListener("click", () => sendCommand({ type: "title.refresh" }));

    $("customSendBtn").addEventListener("click", () => {
      try {
        const command = JSON.parse($("customCommand").value);
        sendCommand(command);
      } catch (error) {
        showToast(`JSON 错误：${error.message}`);
      }
    });

    $("openBridgeBtn").addEventListener("click", () => openFolder(bridgeDir));
    $("openSaveBtn").addEventListener("click", () => openFolder(saveDir));
    $("backupSaveBtn").addEventListener("click", backupSaves);
    $("clearEventsBtn").addEventListener("click", clearEvents);
  }

  setupIconSet();
  setupCatalogs();
  bind();
  activateTab("core");
  refresh();
  setInterval(refresh, 700);
})();
