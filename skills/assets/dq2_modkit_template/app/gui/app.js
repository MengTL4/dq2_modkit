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
    const guiCachePath = path.join(dataDir, "_gui-cache.json");
    const iconDir = path.join(process.cwd(), "icons");
    const iconSetPath = path.join(rootDir, "www", "img", "system", "IconSet.png");
    const EXPECTED_BRIDGE_VERSION = "0.2.29";
    const GUI_CACHE_VERSION = 1;
    const $ = (id) => document.getElementById(id);
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
        offlineHuntMapList: $("offlineHuntMapList"),
        offlineHuntMapListCount: $("offlineHuntMapListCount"),
        offlineHuntTroopList: $("offlineHuntTroopList"),
        offlineHuntTroopListCount: $("offlineHuntTroopListCount"),
        offlineHuntMetric: $("offlineHuntMetric"),
        offlineHuntState: $("offlineHuntState"),
        offlineHuntResult: $("offlineHuntResult"),
        commonEventList: $("commonEventList"),
        commonEventListCount: $("commonEventListCount"),
        eventList: $("eventList"),
        fishingPowerMetric: $("fishingPowerMetric"),
        fishingState: $("fishingState"),
        fishingVariables: $("fishingVariables"),
        battleState: $("battleState"),
        toolSectionNav: $("toolSectionNav"),
        toast: $("toast")
    };
    let lastEventSize = 0;
    let switchValue = true;
    let gameProcess = null;
    let iconSetImage = null;
    let iconRenderVersion = 0;
    let latestState = null;
    let recordedPosition = null;
    let toastTimer;
    let activeToolTab = "core";
    let offlineHuntMode = "map";
    const activeToolSections = {
        core: "gold",
        catalog: "item",
        fishing: "power",
        offline: "map",
        world: "map",
        misc: "variable",
        debug: "command"
    };
    const iconCache = new Map();
    const catalogViews = new Map();
    const CATALOG_ROW_HEIGHT = 88;
    const CATALOG_PAGE_SIZE = 20;
    const DATALIST_LIMIT = 80;
    const catalogPages = new Map();
    const datalistSources = new Map();
    const CATALOG_LIST_IDS = [
        "itemList",
        "skillList",
        "actorList",
        "variableList",
        "switchList",
        "mapList",
        "offlineHuntMapList",
        "offlineHuntTroopList",
        "commonEventList"
    ];
    const itemKindLabels = {
        item: "物品",
        weapon: "武器",
        armor: "防具"
    };
    let selectedItemKind = "item";
    const systemData = readJson(path.join(dataDir, "System.json")) || {};
    const guiCache = loadGuiCache();
    const catalogs = {
        variable: loadNamedArrayCatalog(systemData.variables || []),
        switch: loadNamedArrayCatalog(systemData.switches || []),
        item: loadCatalog("Items.json"),
        weapon: loadCatalog("Weapons.json"),
        armor: loadCatalog("Armors.json"),
        actor: loadCatalog("Actors.json"),
        skill: loadCatalog("Skills.json"),
        map: loadMapCatalog(),
        huntMap: loadHuntMapCatalog(),
        troop: loadTroopCatalog(),
        commonEvent: loadCommonEventCatalog()
    };
    catalogs.all = buildAllItemCatalog();
    process.env.DQ2_MODKIT_ROOT = projectRoot;
    process.env.DQ2_GAME_ROOT = rootDir;
    function resolveGameRoot(projectRoot) {
        const candidates = [];
        try {
            const configPath = path.join(projectRoot, "config.local.json");
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
                if (config && config.gameRoot)
                    candidates.push({ value: String(config.gameRoot), base: projectRoot });
            }
        }
        catch (error) {
            throw new Error("Invalid config.local.json: " + (error && error.message || error));
        }
        candidates.push({ value: path.resolve(projectRoot, ".."), base: projectRoot });
        if (process.env.DQ2_GAME_ROOT)
            candidates.push({ value: process.env.DQ2_GAME_ROOT, base: projectRoot });
        for (const candidate of candidates) {
            const expanded = expandEnv(candidate.value);
            const fullPath = path.isAbsolute(expanded)
                ? path.resolve(expanded)
                : path.resolve(candidate.base, expanded);
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
            if (!fs.existsSync(file))
                return null;
            return JSON.parse(fs.readFileSync(file, "utf8"));
        }
        catch {
            return null;
        }
    }
    function loadGuiCache() {
        const cache = readJson(guiCachePath);
        if (!cache || cache.version !== GUI_CACHE_VERSION)
            return null;
        return cache;
    }
    function loadCatalog(fileName) {
        try {
            const file = path.join(dataDir, fileName);
            if (!fs.existsSync(file))
                return [];
            const data = JSON.parse(fs.readFileSync(file, "utf8"));
            if (!Array.isArray(data))
                return [];
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
        }
        catch {
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
                    `${kind}:${entry.id}`,
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
        if (!Array.isArray(data))
            return [];
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
    function dropKindFromIndex(kind) {
        if (kind === 1 || kind === "1" || String(kind).toLowerCase() === "item")
            return "item";
        if (kind === 2 || kind === "2" || String(kind).toLowerCase() === "weapon")
            return "weapon";
        if (kind === 3 || kind === "3" || String(kind).toLowerCase() === "armor")
            return "armor";
        return "";
    }
    function localDropTables() {
        return {
            item: readJson(path.join(dataDir, "Items.json")) || [],
            weapon: readJson(path.join(dataDir, "Weapons.json")) || [],
            armor: readJson(path.join(dataDir, "Armors.json")) || []
        };
    }
    function localDropNamesOfEnemy(enemy, tables = localDropTables()) {
        const names = [];
        const seen = new Set();
        const add = (kind, id) => {
            const normalized = dropKindFromIndex(kind);
            const table = tables[normalized];
            const entry = table && table[Number(id)];
            if (!normalized || !entry || !entry.name)
                return;
            const key = `${normalized}:${id}`;
            if (seen.has(key))
                return;
            seen.add(key);
            names.push(`${itemKindLabels[normalized] || normalized}:${cleanText(entry.name)}`);
        };
        const note = String(enemy && enemy.note || "");
        const match = note.match(/<\s*Enemy Drops\s*>([\s\S]*?)<\s*\/\s*Enemy Drops\s*>/i);
        if (match) {
            match[1].split(/\r?\n/).forEach((line) => {
                const parsed = line.trim().match(/^(item|weapon|armor)\s+(\d+)\s*:/i);
                if (parsed)
                    add(parsed[1], parsed[2]);
            });
        }
        (enemy && enemy.dropItems || []).forEach((drop) => {
            if (drop && drop.kind && drop.dataId)
                add(drop.kind, drop.dataId);
        });
        return names;
    }
    function localTroopDetails(troop, enemies, tables = localDropTables()) {
        const visibleMembers = (troop && troop.members || []).filter((member) => member && !member.hidden && Number(member.enemyId) > 0);
        const enemyRows = visibleMembers.map((member) => enemies[Number(member.enemyId)]).filter(Boolean);
        const enemyCounts = {};
        let exp = 0;
        let gold = 0;
        const maps = new Set();
        const dropNames = new Set();
        enemyRows.forEach((enemy) => {
            const enemyId = Number(enemy.id || 0);
            const enemyName = cleanText(enemy.name || "");
            const key = `${enemyId}:${enemyName}`;
            if (!enemyCounts[key])
                enemyCounts[key] = { id: enemyId, name: enemyName, count: 0 };
            enemyCounts[key].count += 1;
            exp += Number(enemy.exp || 0);
            gold += Number(enemy.gold || 0);
            const mapMatch = String(enemy.note || "").match(/<\s*enemyMap\s*:\s*([^>]+)>/i);
            if (mapMatch && cleanText(mapMatch[1]))
                maps.add(cleanText(mapMatch[1]));
            localDropNamesOfEnemy(enemy, tables).forEach((name) => dropNames.add(name));
        });
        const enemyList = Array.from(Object.values(enemyCounts));
        const enemyText = enemyList.map((enemy) => `${enemy.name}${enemy.count > 1 ? `x${enemy.count}` : ""}`).join("、");
        return {
            enemyList,
            enemyText,
            enemyNames: enemyList.map((enemy) => enemy.name),
            exp,
            gold,
            maps: Array.from(maps),
            dropNames: Array.from(dropNames)
        };
    }
    function loadHuntMapCatalog() {
        if (guiCache && Array.isArray(guiCache.huntMap))
            return guiCache.huntMap;
        const mapInfos = readJson(path.join(dataDir, "MapInfos.json")) || [];
        const troops = readJson(path.join(dataDir, "Troops.json")) || [];
        const enemies = readJson(path.join(dataDir, "Enemies.json")) || [];
        const tables = localDropTables();
        if (!fs.existsSync(dataDir))
            return [];
        try {
            const ids = new Set();
            if (Array.isArray(mapInfos)) {
                mapInfos.forEach((entry) => {
                    if (entry && Number(entry.id) > 0 && entry.name)
                        ids.add(Number(entry.id));
                });
            }
            fs.readdirSync(dataDir).forEach((name) => {
                const match = name.match(/^Map(\d{3})\.json$/i);
                if (match)
                    ids.add(Number(match[1]));
            });
            return Array.from(ids)
                .sort((a, b) => a - b)
                .map((id) => {
                const map = readJson(path.join(dataDir, `Map${String(id).padStart(3, "0")}.json`));
                const info = mapInfos[id] || {};
                if (!map && !info.name)
                    return null;
                const encounters = map && Array.isArray(map.encounterList)
                    ? map.encounterList.filter((entry) => entry && Number(entry.troopId) > 0)
                        .map((entry) => ({
                        troopId: Number(entry.troopId),
                        weight: Number(entry.weight || 0),
                        regionSet: Array.isArray(entry.regionSet) ? entry.regionSet.map(Number).filter(Number.isFinite) : []
                    }))
                    : [];
                const hasEncounters = encounters.length > 0;
                const nameText = cleanText(map && map.displayName || info.name || `Map${id}`);
                const troopIds = Array.from(new Set(encounters.map((entry) => Number(entry.troopId)))).sort((a, b) => a - b);
                const troopNames = troopIds
                    .map((troopId) => troops[troopId] && cleanText(troops[troopId].name || ""))
                    .filter(Boolean);
                const troopDetails = troopIds.map((troopId) => localTroopDetails(troops[troopId], enemies, tables));
                const enemyNames = Array.from(new Set(troopDetails.flatMap((detail) => detail.enemyNames).filter(Boolean)));
                const dropNames = Array.from(new Set(troopDetails.flatMap((detail) => detail.dropNames).filter(Boolean)));
                const regions = Array.from(new Set(encounters.flatMap((entry) => entry.regionSet.map(Number)))).sort((a, b) => a - b);
                const description = [
                    hasEncounters ? `${encounters.length} 组遇敌` : "无随机遇敌",
                    hasEncounters ? `步数 ${Number(map && map.encounterStep || 0) || "-"}` : "可改用敌群挂机",
                    enemyNames.length ? `怪物 ${enemyNames.length} 种` : troopNames.slice(0, 4).join("、"),
                    dropNames.length ? `掉落 ${dropNames.length} 种` : "",
                    regions.length ? `区域 ${regions.slice(0, 8).join(",")}` : ""
                ].filter(Boolean).join(" / ");
                return {
                    id,
                    name: nameText,
                    description,
                    noteText: "",
                    encounterCount: encounters.length,
                    encounterStep: Number(map && map.encounterStep || 0),
                    hasEncounters,
                    troopIds,
                    value: id,
                    label: `${id} / ${nameText}`,
                    searchText: makeSearchText([
                        id,
                        nameText,
                        info.name,
                        troopIds.join(" "),
                        troopNames.join(" "),
                        enemyNames.join(" "),
                        dropNames.join(" "),
                        regions.join(" "),
                        "挂机",
                        "遇敌",
                        "脱机",
                        hasEncounters ? "可挂机" : "无遇敌 无随机遇敌"
                    ])
                };
            })
                .filter(Boolean)
                .sort((a, b) => Number(!a.hasEncounters) - Number(!b.hasEncounters) || a.id - b.id);
        }
        catch {
            return [];
        }
    }
    function loadTroopCatalog() {
        if (guiCache && Array.isArray(guiCache.troop))
            return guiCache.troop;
        const troops = readJson(path.join(dataDir, "Troops.json")) || [];
        const enemies = readJson(path.join(dataDir, "Enemies.json")) || [];
        const tables = localDropTables();
        if (!Array.isArray(troops))
            return [];
        return troops
            .filter((entry) => entry && Number.isFinite(Number(entry.id)) && (entry.name || Array.isArray(entry.members)))
            .map((entry) => {
            const id = Number(entry.id);
            const details = localTroopDetails(entry, enemies, tables);
            const name = cleanText(entry.name || details.enemyNames.join(", ") || `敌群 ${id}`);
            const tags = Array.from(name.matchAll(/【([^】]+)】/g)).map((match) => match[1]);
            const description = [
                tags.length ? tags.join(" / ") : "",
                details.enemyText,
                `EXP ${details.exp}`,
                `金币 ${details.gold}`,
                details.dropNames.length ? `掉落 ${details.dropNames.length} 种` : "无掉落表"
            ].filter(Boolean).join(" / ");
            return {
                id,
                name,
                description,
                noteText: "",
                enemyText: details.enemyText,
                tags,
                exp: details.exp,
                gold: details.gold,
                maps: details.maps,
                dropNames: details.dropNames,
                value: id,
                label: `${id} / ${name}`,
                searchText: makeSearchText([
                    id,
                    name,
                    details.enemyText,
                    tags.join(" "),
                    details.maps.join(" "),
                    details.dropNames.join(" "),
                    "敌群",
                    "精英",
                    "首领",
                    "领主",
                    "头目",
                    "稀有",
                    "罕见"
                ])
            };
        })
            .filter((entry) => entry.name)
            .sort((a, b) => a.id - b.id);
    }
    function loadCommonEventCatalog() {
        const data = readJson(path.join(dataDir, "CommonEvents.json")) || [];
        if (!Array.isArray(data))
            return [];
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
            if (kind === "all")
                return entry.uid === String(id) || entry.id === Number(id);
            return entry.id === Number(id);
        });
        return item ? item.name : "";
    }
    function catalogEntry(kind, id) {
        const list = catalogs[kind] || [];
        return list.find((entry) => {
            if (kind === "all")
                return entry.uid === String(id) || entry.id === Number(id);
            return entry.id === Number(id);
        }) || null;
    }
    function populateDatalist(id, entries) {
        const list = $(id);
        if (!list)
            return;
        datalistSources.set(id, entries || []);
        list.innerHTML = filterDatalistEntries(entries || [], "", DATALIST_LIMIT)
            .map((entry) => {
            const value = entry.value != null ? entry.value : entry.uid != null ? entry.uid : entry.id;
            const label = entry.label || entry.name;
            return `<option value="${escapeHtml(value)}" label="${escapeHtml(label)}"></option>`;
        })
            .join("");
    }
    function refreshPickerDatalist(input) {
        const listId = input.getAttribute("list");
        if (!listId)
            return;
        const entries = datalistSources.get(listId);
        if (!entries)
            return;
        const list = $(listId);
        if (!list)
            return;
        list.innerHTML = filterDatalistEntries(entries, input.value, DATALIST_LIMIT)
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
                iconRenderVersion += 1;
                renderCatalogs();
            };
            image.onerror = () => showToast("图标集图片解码失败");
            image.src = `data:image/png;base64,${bytes.toString("base64")}`;
        }
        catch (error) {
            showToast(`图标集加载失败：${error.message}`);
        }
    }
    function decryptProtectedImage(input) {
        const data = Buffer.from(input);
        if (data.length <= 100)
            return data;
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
        for (let i = 0; i < bytes.length; i += 1)
            output[positions[i]] = bytes[i];
        return Buffer.from(output);
    }
    function iconDataUrl(iconIndex) {
        const index = Math.max(0, Math.floor(Number(iconIndex) || 0));
        if (iconCache.has(index))
            return iconCache.get(index);
        if (!iconSetImage)
            return "";
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
        if (!dataUrl)
            return '<span class="rpg-icon icon-pending"></span>';
        return `<img class="rpg-icon" src="${dataUrl}" alt="">`;
    }
    function actorAvatarHtml(actor) {
        return `<span class="actor-avatar">${escapeHtml(actor.id)}</span>`;
    }
    function badgeHtml(label, tone = "") {
        return `<span class="catalog-badge ${tone}">${escapeHtml(label)}</span>`;
    }
    function entryMatchesSearch(entry, needle) {
        if (!needle)
            return true;
        if (entry.searchText && entry.searchText.includes(needle))
            return true;
        return [
            entry.id,
            entry.uid,
            entry.value,
            entry.label,
            entry.name,
            entry.description,
            entry.noteText
        ].some((part) => String(part == null ? "" : part).toLowerCase().includes(needle));
    }
    function filterDatalistEntries(entries, query, limit) {
        const needle = String(query || "").trim().toLowerCase();
        if (!needle)
            return entries.slice(0, limit);
        const result = [];
        for (const entry of entries) {
            if (!entryMatchesSearch(entry, needle))
                continue;
            result.push(entry);
            if (result.length >= limit)
                break;
        }
        return result;
    }
    function filterEntries(entries, query) {
        const needle = String(query || "").trim().toLowerCase();
        if (!needle) {
            return {
                entries: entries.slice(),
                total: entries.length,
                hasMore: false,
                exact: true
            };
        }
        const result = [];
        for (const entry of entries) {
            if (!entryMatchesSearch(entry, needle))
                continue;
            result.push(entry);
        }
        return {
            entries: result,
            total: result.length,
            hasMore: false,
            exact: true
        };
    }
    function catalogEntryKey(entry, options) {
        return options.key ? options.key(entry) : entry.id;
    }
    function catalogPageFor(targetId, queryKey) {
        const current = catalogPages.get(targetId);
        if (current && current.queryKey === queryKey)
            return current;
        const next = { queryKey, page: 1, pageSize: CATALOG_PAGE_SIZE };
        catalogPages.set(targetId, next);
        return next;
    }
    function clampCatalogPage(state, total) {
        const pageCount = Math.max(1, Math.ceil(Math.max(0, Number(total || 0)) / state.pageSize));
        state.page = Math.min(Math.max(1, Math.floor(Number(state.page || 1))), pageCount);
        return pageCount;
    }
    function catalogPageStart(state) {
        return (Math.max(1, Number(state.page || 1)) - 1) * state.pageSize;
    }
    function catalogCountText(result, page, pageCount) {
        if (!result.total)
            return "0 条";
        return `共 ${result.total} 条 / ${page}/${pageCount} 页`;
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
        let timer;
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
        if (!view)
            return;
        if (!elementIsVisible(target))
            return;
        if (target.classList.contains("catalog-list-collapsed"))
            return;
        const entries = view.entries;
        const options = view.options;
        if (!entries.length) {
            target.innerHTML = '<div class="catalog-empty">没有匹配项</div>';
            view.renderKey = "empty";
            return;
        }
        const rowHeight = view.rowHeight;
        const selectedId = options.selectedId;
        const renderKey = `static:${selectedId}:${view.page}:${entries.length}:${target.clientWidth}:${iconRenderVersion}`;
        if (view.renderKey === renderKey)
            return;
        view.renderKey = renderKey;
        const rows = entries.map((entry, index) => catalogRowHtml(entry, options, selectedId, index * rowHeight));
        target.innerHTML = `<div class="catalog-spacer" style="height:${entries.length * rowHeight}px">${rows.join("")}</div>`;
    }
    function renderCatalogList(target, entries, options) {
        const previous = catalogViews.get(target.id);
        const queryKey = `${options.kind || ""}:${options.query || ""}`;
        const pageState = catalogPageFor(target.id, queryKey);
        const filtered = filterEntries(entries, options.query);
        let pageCount = clampCatalogPage(pageState, filtered.total);
        const selectedKey = options.selectedId == null ? "" : String(options.selectedId);
        const shouldLocateSelected = selectedKey && (!previous || previous.queryKey !== queryKey || previous.selectedKey !== selectedKey);
        if (shouldLocateSelected && filtered.entries.length) {
            const selectedIndex = filtered.entries.findIndex((entry) => String(catalogEntryKey(entry, options)) === selectedKey);
            if (selectedIndex >= 0) {
                pageState.page = Math.floor(selectedIndex / pageState.pageSize) + 1;
                pageCount = clampCatalogPage(pageState, filtered.total);
            }
        }
        const pageStart = catalogPageStart(pageState);
        const visibleEntries = filtered.entries.slice(pageStart, pageStart + pageState.pageSize);
        catalogViews.set(target.id, {
            entries: visibleEntries,
            sourceEntries: entries,
            filteredEntries: filtered.entries,
            options,
            rowHeight: CATALOG_ROW_HEIGHT,
            queryKey,
            page: pageState.page,
            pageSize: pageState.pageSize,
            pageCount,
            filtered,
            selectedKey
        });
        if (!previous || previous.queryKey !== queryKey)
            target.scrollTop = 0;
        if (options.countTarget) {
            options.countTarget.textContent = catalogCountText(filtered, pageState.page, pageCount);
        }
        updateCatalogLimitTools(target);
        if (!elementIsVisible(target))
            return;
        renderVirtualCatalog(target);
    }
    function renderItemList() {
        const kind = $("itemKind").value;
        const entries = catalogs[kind] || [];
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
        const entries = catalogs.skill || [];
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
        const entries = catalogs.actor || [];
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
        const entries = catalogs.variable || [];
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
        const entries = catalogs.switch || [];
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
        const entries = catalogs.map || [];
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
    function renderOfflineHuntMapList() {
        const entries = catalogs.huntMap || [];
        renderCatalogList(dom.offlineHuntMapList, entries, {
            kind: "huntMap",
            query: $("offlineHuntMapSearch").value,
            selectedId: selectedNumber("offlineHuntMapId"),
            leading: (entry) => badgeHtml(entry.id, "map"),
            extra: (entry) => entry.hasEncounters ? "" : "无遇敌",
            actions: (entry) => entry.hasEncounters
                ? `<button data-catalog-action="offline-hunt-select" data-id="${entry.id}">选择</button>`
                : `<button disabled title="没有随机遇敌配置">无遇敌</button>`,
            description: (entry) => entry.description,
            countTarget: dom.offlineHuntMapListCount
        });
    }
    function renderOfflineHuntTroopList() {
        const entries = catalogs.troop || [];
        renderCatalogList(dom.offlineHuntTroopList, entries, {
            kind: "huntTroop",
            query: $("offlineHuntTroopSearch").value,
            selectedId: selectedNumber("offlineHuntTroopId"),
            leading: (entry) => badgeHtml(entry.id, "troop"),
            actions: (entry) => `<button data-catalog-action="offline-troop-select" data-id="${entry.id}">选择</button><button data-catalog-action="offline-troop-run" data-id="${entry.id}">执行</button>`,
            extra: (entry) => entry.tags && entry.tags.length ? entry.tags.join("/") : "",
            description: (entry) => entry.description,
            countTarget: dom.offlineHuntTroopListCount
        });
    }
    function renderCommonEventList() {
        const entries = catalogs.commonEvent || [];
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
    const catalogRenderers = {
        itemList: renderItemList,
        skillList: renderSkillList,
        actorList: renderActorList,
        variableList: renderVariableList,
        switchList: renderSwitchList,
        mapList: renderMapList,
        offlineHuntMapList: renderOfflineHuntMapList,
        offlineHuntTroopList: renderOfflineHuntTroopList,
        commonEventList: renderCommonEventList
    };
    function elementIsVisible(element) {
        return !!(element && element.offsetParent !== null && !element.closest("[hidden]"));
    }
    function renderActiveCatalogs() {
        CATALOG_LIST_IDS.forEach((id) => {
            const element = $(id);
            if (elementIsVisible(element) && catalogRenderers[id])
                catalogRenderers[id]();
        });
    }
    function renderCatalogs() {
        renderActiveCatalogs();
    }
    function readEvents() {
        try {
            if (!fs.existsSync(eventPath))
                return [];
            const text = fs.readFileSync(eventPath, "utf8").trim();
            if (!text)
                return [];
            return text.split(/\r?\n/).map((line) => {
                try {
                    return JSON.parse(line);
                }
                catch {
                    return null;
                }
            }).filter(Boolean);
        }
        catch {
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
        if (value == null || value === "")
            return "-";
        const number = Number(value);
        if (!Number.isFinite(number))
            return String(value);
        return new Intl.NumberFormat("zh-CN").format(number);
    }
    function parseValue(text) {
        const value = String(text).trim();
        if (value === "true")
            return true;
        if (value === "false")
            return false;
        if (value === "null")
            return null;
        if (value !== "" && Number.isFinite(Number(value)))
            return Number(value);
        try {
            return JSON.parse(value);
        }
        catch {
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
        if (text === "")
            return undefined;
        const value = looseNumber(text);
        return Number.isFinite(value) ? value : undefined;
    }
    function looseNumber(value) {
        const text = String(value == null ? "" : value).trim();
        if (text === "")
            return NaN;
        const direct = Number(text);
        if (Number.isFinite(direct))
            return direct;
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
        const huntMap = catalogEntry("huntMap", numberValue("offlineHuntMapId", NaN));
        $("offlineHuntMapHint").textContent = huntMap
            ? `${$("offlineHuntMapId").value} / ${huntMap.name}${huntMap.hasEncounters ? "" : " / 无随机遇敌，建议切到敌群挂机"}`
            : "";
        const huntTroopName = catalogName("troop", numberValue("offlineHuntTroopId", NaN));
        $("offlineHuntTroopHint").textContent = huntTroopName ? `固定敌群 ${$("offlineHuntTroopId").value} / ${huntTroopName}` : "";
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
        populateDatalist("offlineHuntMapOptions", catalogs.huntMap);
        populateDatalist("offlineHuntTroopOptions", catalogs.troop);
        populateDatalist("commonEventOptions", catalogs.commonEvent);
        $("itemKind").addEventListener("change", () => {
            const kind = $("itemKind").value;
            $("itemId").setAttribute("list", `${kind}Options`);
            if (kind === "all") {
                const selection = parseItemSelection();
                if (Number.isFinite(selection.id))
                    $("itemId").value = itemSelectionKey(selection);
            }
            else if (/^(item|weapon|armor)\s*:/i.test($("itemId").value)) {
                $("itemId").value = String(parseItemSelection().id || "");
            }
            refreshPickerDatalist($("itemId"));
            updateLookupHints();
            renderItemList();
        });
        $("itemSearch").addEventListener("input", debounce(renderItemList));
        $("skillSearch").addEventListener("input", debounce(renderSkillList));
        $("actorSearch").addEventListener("input", debounce(renderActorList));
        $("variableSearch").addEventListener("input", debounce(renderVariableList));
        $("switchSearch").addEventListener("input", debounce(renderSwitchList));
        $("mapSearch").addEventListener("input", debounce(renderMapList));
        $("offlineHuntMapSearch").addEventListener("input", debounce(renderOfflineHuntMapList));
        $("offlineHuntTroopSearch").addEventListener("input", debounce(renderOfflineHuntTroopList));
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
        ["variableId", "switchId", "mapId", "offlineHuntMapId", "offlineHuntTroopId", "commonEventId"].forEach((id) => {
            $(id).addEventListener("input", () => {
                updateLookupHints();
                if (id === "variableId")
                    renderVariableList();
                else if (id === "switchId")
                    renderSwitchList();
                else if (id === "mapId")
                    renderMapList();
                else if (id === "offlineHuntMapId")
                    renderOfflineHuntMapList();
                else if (id === "offlineHuntTroopId")
                    renderOfflineHuntTroopList();
                else if (id === "commonEventId")
                    renderCommonEventList();
            });
        });
        updateLookupHints();
        setupPickerInputs();
    }
    function setupPickerInputs() {
        document.querySelectorAll("input[list]").forEach((input) => {
            input.setAttribute("autocomplete", "off");
            input.dataset.pickerLastValue = input.value || "";
            input.addEventListener("focus", () => {
                const value = String(input.value || "");
                refreshPickerDatalist(input);
                if (!value.trim())
                    return;
                input.dataset.pickerLastValue = value;
                input.dataset.pickerCleared = "true";
                input.value = "";
                refreshPickerDatalist(input);
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dataset.pickerLastValue = value;
                input.dataset.pickerCleared = "true";
            });
            input.addEventListener("input", () => {
                refreshPickerDatalist(input);
                input.dataset.pickerCleared = "false";
                input.dataset.pickerLastValue = input.value || "";
            });
            input.addEventListener("keydown", (event) => {
                if (event.key !== "Escape" || input.dataset.pickerCleared !== "true")
                    return;
                input.value = input.dataset.pickerLastValue || input.defaultValue || "";
                input.dataset.pickerCleared = "false";
                refreshPickerDatalist(input);
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.blur();
            });
            input.addEventListener("blur", () => {
                if (input.dataset.pickerCleared === "true" && !String(input.value || "").trim()) {
                    input.value = input.dataset.pickerLastValue || input.defaultValue || "";
                    refreshPickerDatalist(input);
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                }
                input.dataset.pickerCleared = "false";
                input.dataset.pickerLastValue = input.value || "";
            });
        });
    }
    function bindVirtualScroll(target) {
        target.tabIndex = 0;
        target.addEventListener("wheel", (event) => {
            const delta = Number(event.deltaY || 0);
            if (!delta || target.scrollHeight <= target.clientHeight + 1)
                return;
            const atTop = target.scrollTop <= 0;
            const atBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 1;
            if (!((delta < 0 && atTop) || (delta > 0 && atBottom)))
                return;
            const scroller = document.body.classList.contains("page-scroll-mode")
                ? document.scrollingElement
                : document.querySelector(".tool-grid");
            if (!scroller || scroller === target)
                return;
            scroller.scrollBy({ top: delta, behavior: "auto" });
            event.preventDefault();
        }, { passive: false });
    }
    function sectionsForTab(tab) {
        const seen = new Set();
        const sections = [];
        Array.from(document.querySelectorAll(`[data-tool-panel="${tab}"]`)).forEach((panel) => {
            if (panel.dataset.toolSectionNav === "false")
                return;
            String(panel.dataset.toolSection || "").split(/\s+/).filter(Boolean).forEach((section) => {
                if (seen.has(section))
                    return;
                seen.add(section);
                sections.push({
                    section,
                    label: panel.dataset.toolLabel || panel.querySelector(".panel-title")?.textContent?.trim() || section
                });
            });
        });
        return sections;
    }
    function ensureActiveToolSection(tab) {
        const sections = sectionsForTab(tab);
        if (!sections.length)
            return "";
        if (!sections.some((item) => item.section === activeToolSections[tab])) {
            activeToolSections[tab] = sections[0].section;
        }
        return activeToolSections[tab];
    }
    function updateToolSectionNav(tab) {
        const sections = sectionsForTab(tab);
        const active = ensureActiveToolSection(tab);
        dom.toolSectionNav.hidden = sections.length <= 1;
        dom.toolSectionNav.innerHTML = sections.map((item) => `<button type="button" class="${item.section === active ? "active" : ""}" data-tool-section-jump="${escapeHtml(item.section)}">${escapeHtml(item.label)}</button>`).join("");
    }
    function panelMatchesActiveSection(panel) {
        if (panel.dataset.toolPanel !== activeToolTab)
            return false;
        const section = ensureActiveToolSection(activeToolTab);
        const panelSections = String(panel.dataset.toolSection || "").split(/\s+/).filter(Boolean);
        if (panelSections.length && !panelSections.includes(section))
            return false;
        const modePanel = panel.dataset.offlineModePanel;
        if (modePanel && modePanel !== offlineHuntMode)
            return false;
        return true;
    }
    function updateVisiblePanels() {
        ensureActiveToolSection(activeToolTab);
        document.querySelectorAll("[data-tool-panel]").forEach((panel) => {
            panel.hidden = !panelMatchesActiveSection(panel);
        });
        updateToolSectionNav(activeToolTab);
    }
    function activateToolSection(section, options = {}) {
        const sections = sectionsForTab(activeToolTab);
        if (!sections.some((item) => item.section === section))
            return;
        activeToolSections[activeToolTab] = section;
        if (activeToolTab === "offline" && section === "map" && offlineHuntMode !== "map") {
            setOfflineHuntMode("map", { keepSection: true, deferRender: true });
        }
        else if (activeToolTab === "offline" && section === "troop" && offlineHuntMode !== "troop") {
            setOfflineHuntMode("troop", { keepSection: true, deferRender: true });
        }
        else {
            updateVisiblePanels();
        }
        if (!options.keepScroll)
            scrollActiveToolAreaToTop();
        requestAnimationFrame(renderActiveCatalogs);
    }
    function activateAdjacentToolSection(direction = 1) {
        const sections = sectionsForTab(activeToolTab);
        if (!sections.length)
            return;
        const active = ensureActiveToolSection(activeToolTab);
        const index = Math.max(0, sections.findIndex((item) => item.section === active));
        const next = sections[(index + direction + sections.length) % sections.length];
        if (next)
            activateToolSection(next.section);
    }
    function updateCatalogToolLabels(target) {
        const tools = target.__catalogTools;
        if (!tools)
            return;
        const collapsed = target.classList.contains("catalog-list-collapsed");
        const expanded = target.classList.contains("catalog-list-expanded");
        const collapseButton = tools.querySelector('[data-catalog-tool="collapse"]');
        const expandButton = tools.querySelector('[data-catalog-tool="expand"]');
        if (collapseButton)
            collapseButton.textContent = collapsed ? "显示" : "收起";
        if (expandButton)
            expandButton.textContent = expanded ? "标准" : "展开";
    }
    function updateCatalogLimitTools(target) {
        const tools = target.__catalogTools;
        if (!tools)
            return;
        const view = catalogViews.get(target.id);
        const status = tools.querySelector('[data-catalog-tool="page-status"]');
        const firstButton = tools.querySelector('[data-catalog-tool="first"]');
        const prevButton = tools.querySelector('[data-catalog-tool="prev"]');
        const nextButton = tools.querySelector('[data-catalog-tool="next"]');
        const lastButton = tools.querySelector('[data-catalog-tool="last"]');
        if (!view) {
            if (status)
                status.textContent = "第 1 / 1 页";
            [firstButton, prevButton, nextButton, lastButton].forEach((button) => {
                if (button)
                    button.disabled = true;
            });
            return;
        }
        const visibleCount = view.entries ? view.entries.length : 0;
        const total = view.filtered ? Number(view.filtered.total || 0) : 0;
        const page = Number(view.page || 1);
        const pageCount = Number(view.pageCount || 1);
        if (status) {
            status.textContent = total ? `第 ${page} / ${pageCount} 页 · 本页 ${visibleCount} 条` : "无结果";
        }
        if (firstButton)
            firstButton.disabled = page <= 1 || !total;
        if (prevButton)
            prevButton.disabled = page <= 1 || !total;
        if (nextButton)
            nextButton.disabled = page >= pageCount || !total;
        if (lastButton)
            lastButton.disabled = page >= pageCount || !total;
    }
    function changeCatalogPage(target, action) {
        const view = catalogViews.get(target.id);
        if (!view)
            return;
        const state = catalogPageFor(target.id, view.queryKey);
        const pageCount = Math.max(1, Number(view.pageCount || 1));
        let nextPage = Number(state.page || 1);
        if (action === "first")
            nextPage = 1;
        else if (action === "prev")
            nextPage -= 1;
        else if (action === "next")
            nextPage += 1;
        else if (action === "last")
            nextPage = pageCount;
        nextPage = Math.min(Math.max(1, Math.floor(nextPage)), pageCount);
        if (nextPage === state.page)
            return;
        state.page = nextPage;
        target.scrollTop = 0;
        if (catalogRenderers[target.id])
            catalogRenderers[target.id]();
    }
    function revealCatalog(target) {
        if (!target.classList.contains("catalog-list-collapsed"))
            return;
        target.classList.remove("catalog-list-collapsed");
        updateCatalogToolLabels(target);
        requestAnimationFrame(() => renderVirtualCatalog(target));
    }
    function toggleCatalogCollapsed(target) {
        const collapsed = target.classList.toggle("catalog-list-collapsed");
        if (collapsed)
            target.classList.remove("catalog-list-expanded");
        updateCatalogToolLabels(target);
        if (!collapsed)
            requestAnimationFrame(() => renderVirtualCatalog(target));
    }
    function toggleCatalogExpanded(target) {
        target.classList.remove("catalog-list-collapsed");
        target.classList.toggle("catalog-list-expanded");
        updateCatalogToolLabels(target);
        requestAnimationFrame(() => renderVirtualCatalog(target));
    }
    function setupCatalogTools() {
        CATALOG_LIST_IDS.forEach((id) => {
            const target = $(id);
            if (!target || target.__catalogTools)
                return;
            const tools = document.createElement("div");
            tools.className = "catalog-tools";
            tools.innerHTML = `
        <button type="button" data-catalog-tool="collapse">收起</button>
        <button type="button" data-catalog-tool="expand">展开</button>
        <button type="button" data-catalog-tool="first">首页</button>
        <button type="button" data-catalog-tool="prev">上一页</button>
        <span class="catalog-page-status" data-catalog-tool="page-status">第 1 / 1 页</span>
        <button type="button" data-catalog-tool="next">下一页</button>
        <button type="button" data-catalog-tool="last">末页</button>
        <button type="button" data-catalog-tool="next-section">下一分类</button>
      `;
            target.parentNode.insertBefore(tools, target);
            target.__catalogTools = tools;
            tools.addEventListener("click", (event) => {
                const button = event.target.closest("[data-catalog-tool]");
                if (!button)
                    return;
                const action = button.dataset.catalogTool;
                if (action === "collapse")
                    toggleCatalogCollapsed(target);
                else if (action === "expand")
                    toggleCatalogExpanded(target);
                else if (action === "first" || action === "prev" || action === "next" || action === "last")
                    changeCatalogPage(target, action);
                else if (action === "next-section")
                    activateAdjacentToolSection(1);
            });
            updateCatalogToolLabels(target);
        });
    }
    function updateViewportMode() {
        const pageScrollMode = window.innerWidth <= 980 || window.innerHeight <= 760;
        document.body.classList.toggle("page-scroll-mode", pageScrollMode);
        return pageScrollMode;
    }
    function rerenderAfterViewportChange() {
        updateViewportMode();
        renderCatalogs();
    }
    function bindViewportResize() {
        const handleResize = debounce(() => requestAnimationFrame(rerenderAfterViewportChange), 80);
        window.addEventListener("resize", handleResize);
        const visualViewport = window.visualViewport;
        if (visualViewport)
            visualViewport.addEventListener("resize", handleResize);
        updateViewportMode();
    }
    function scrollActiveToolAreaToTop() {
        const grid = document.querySelector(".tool-grid");
        if (grid)
            grid.scrollTop = 0;
        if (!document.body.classList.contains("page-scroll-mode"))
            return;
        const workspace = document.querySelector(".workspace");
        if (workspace)
            workspace.scrollIntoView({ block: "start", behavior: "auto" });
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
        }
        catch (error) {
            showToast(`启动失败：${error.message}`);
        }
    }
    function openFolder(folder) {
        try {
            fs.mkdirSync(folder, { recursive: true });
            nw.Shell.openItem(folder);
        }
        catch (error) {
            showToast(error.message);
        }
    }
    function copyDirectory(source, target) {
        fs.mkdirSync(target, { recursive: true });
        for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
            const src = path.join(source, entry.name);
            const dst = path.join(target, entry.name);
            if (entry.isDirectory())
                copyDirectory(src, dst);
            else
                fs.copyFileSync(src, dst);
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
    function sendFishingOptions(options) {
        sendCommand({ type: "fishing.options.set", options });
    }
    function setOfflineHuntMode(mode, options = {}) {
        offlineHuntMode = mode === "troop" ? "troop" : "map";
        if (activeToolTab === "offline" && !options.keepSection)
            activeToolSections.offline = offlineHuntMode;
        if (activeToolTab === "offline" && activeToolSections.offline !== offlineHuntMode)
            activeToolSections.offline = offlineHuntMode;
        document.querySelectorAll("[data-offline-mode-panel]").forEach((panel) => {
            if (panel.dataset.toolPanel)
                return;
            panel.hidden = panel.dataset.offlineModePanel !== offlineHuntMode;
        });
        $("offlineHuntClearTroopBtn").hidden = offlineHuntMode !== "troop";
        updateLookupHints();
        updateVisiblePanels();
        if (!options.deferRender)
            requestAnimationFrame(renderActiveCatalogs);
    }
    function selectItem(kind, id, keepChooser = false) {
        selectedItemKind = kind;
        if (!keepChooser)
            $("itemKind").value = kind;
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
    function selectOfflineHuntMap(id) {
        setOfflineHuntMode("map");
        $("offlineHuntMapId").value = String(id);
        $("offlineHuntTroopId").value = "";
        updateLookupHints();
        renderOfflineHuntMapList();
        renderOfflineHuntTroopList();
    }
    function selectOfflineHuntTroop(id) {
        setOfflineHuntMode("troop");
        $("offlineHuntTroopId").value = String(id);
        updateLookupHints();
        renderOfflineHuntTroopList();
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
    function offlineHuntCommandBase(type) {
        const isTroopMode = offlineHuntMode === "troop";
        const troopId = isTroopMode ? optionalNumber("offlineHuntTroopId") : undefined;
        if (isTroopMode && !Number.isFinite(Number(troopId))) {
            showToast("先选择敌群");
            return null;
        }
        if (!isTroopMode && type === "offlineHunt.run") {
            const map = catalogEntry("huntMap", numberValue("offlineHuntMapId", 31));
            if (map && !map.hasEncounters) {
                showToast("这张地图没有随机遇敌，不能按地图挂机；请切到敌群挂机");
                return null;
            }
        }
        return {
            type,
            mode: isTroopMode ? "troop" : "map",
            mapId: isTroopMode ? undefined : numberValue("offlineHuntMapId", 31),
            times: isTroopMode ? numberValue("offlineHuntTroopTimes", 10) : numberValue("offlineHuntMapTimes", 10),
            regionId: isTroopMode ? undefined : optionalNumber("offlineHuntRegionId"),
            troopId,
            enemyBook: !!$("offlineHuntEnemyBook").checked,
            recover: !!$("offlineHuntRecover").checked,
            save: !!$("offlineHuntSave").checked,
            saveSlot: numberValue("offlineHuntSaveSlot", 1),
            nativeDrops: !!$("offlineHuntNativeDrops").checked,
            specialBoost: !!$("offlineHuntSpecialBoost").checked,
            specialRate: numberValue("offlineHuntSpecialRate", 10),
            forceShenMiao: !!$("offlineHuntForceShenMiao").checked,
            forceTiangong: !!$("offlineHuntForceTiangong").checked,
            autoSellQualities: selectedOfflineQualities([
                ["offlineAutoSellRough", 0],
                ["offlineAutoSellNormal", 1],
                ["offlineAutoSellExcellent", 2],
                ["offlineAutoSellFine", 3],
                ["offlineAutoSellEpic", 4],
                ["offlineAutoSellLegendary", 5],
                ["offlineAutoSellArtifact", 6],
                ["offlineAutoSellHeritage", 7],
                ["offlineAutoSellImmortal", 8]
            ]),
            blockDropQualities: selectedOfflineQualities([
                ["offlineBlockNormal", 1],
                ["offlineBlockExcellent", 2],
                ["offlineBlockFine", 3]
            ])
        };
    }
    function selectedOfflineQualities(rows) {
        return rows
            .filter(([id]) => !!$(id).checked)
            .map(([, quality]) => quality);
    }
    function previewOfflineHunt() {
        const command = offlineHuntCommandBase("offlineHunt.preview");
        if (command)
            sendCommand(command);
    }
    function runOfflineHunt() {
        const command = offlineHuntCommandBase("offlineHunt.run");
        if (command)
            sendCommand(command);
    }
    function runCommonEvent(id) {
        selectCommonEvent(id);
        sendCommand({ type: "commonEvent.run", id: Number(id) });
    }
    function handleCatalogClick(event) {
        const actionButton = event.target.closest("[data-catalog-action]");
        const row = event.target.closest(".catalog-row");
        if (!row)
            return;
        const id = Number(row.dataset.id);
        const kind = row.dataset.kind;
        if (!actionButton) {
            if (kind === "item" || kind === "weapon" || kind === "armor")
                selectItem(kind, id, $("itemKind").value === "all");
            else if (kind === "skill")
                selectSkill(id);
            else if (kind === "actor")
                selectActor(id);
            else if (kind === "variable")
                selectVariable(id);
            else if (kind === "switch")
                selectSwitch(id);
            else if (kind === "map")
                selectMap(id);
            else if (kind === "huntMap")
                selectOfflineHuntMap(id);
            else if (kind === "huntTroop")
                selectOfflineHuntTroop(id);
            else if (kind === "commonEvent")
                selectCommonEvent(id);
            return;
        }
        const action = actionButton.dataset.catalogAction;
        if (action === "item-add")
            addItem(kind, id);
        else if (action === "skill-learn")
            learnSkill(id);
        else if (action === "skill-forget")
            forgetSkill(id);
        else if (action === "actor-unlock")
            unlockActor(id);
        else if (action === "actor-select")
            selectActor(id);
        else if (action === "variable-select")
            selectVariable(id);
        else if (action === "variable-set")
            setVariable(id);
        else if (action === "switch-on")
            setSwitch(id, true);
        else if (action === "switch-off")
            setSwitch(id, false);
        else if (action === "map-transfer")
            transferMap(id);
        else if (action === "offline-hunt-select")
            selectOfflineHuntMap(id);
        else if (action === "offline-troop-select")
            selectOfflineHuntTroop(id);
        else if (action === "offline-troop-run") {
            selectOfflineHuntTroop(id);
            runOfflineHunt();
        }
        else if (action === "common-event-run")
            runCommonEvent(id);
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
            dom.fishingPowerMetric.textContent = "0";
            dom.fishingState.textContent = "";
            dom.fishingVariables.textContent = "";
            dom.battleState.textContent = "";
            dom.offlineHuntMetric.textContent = "0";
            dom.offlineHuntState.textContent = "";
            dom.offlineHuntResult.innerHTML = "";
            $("offlineHuntPreviewBtn").disabled = true;
            $("offlineHuntRunBtn").disabled = true;
            $("offlineHuntPreviewTroopBtn").disabled = true;
            $("offlineHuntRunTroopBtn").disabled = true;
            return;
        }
        const age = Date.now() - Number(state.ts || 0);
        const fresh = age >= 0 && age < 5000;
        const version = state.bridgeVersion || "?";
        const versionOk = version === EXPECTED_BRIDGE_VERSION;
        if (!fresh)
            setStatus("idle", "离线");
        else if (!versionOk)
            setStatus("error", "需重启");
        else if (state.lastError)
            setStatus("error", "有错误");
        else if (state.hasParty)
            setStatus("online", "已连接");
        else
            setStatus("idle", "加载中");
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
        if (fresh)
            updateOptionInputs(options);
        updateBattleButtons(options, fresh && state.hooksPatched, fresh ? state.rateStats : null, fresh ? state.battleStats : null);
        updateFishingPanel(fresh ? (state.fishingOptions || {}) : {}, fresh ? state.fishing : null, fresh ? state.fishingStats : null);
        updateOfflineHuntPanel(fresh ? state.offlineHunt : null);
        $("offlineHuntPreviewBtn").disabled = !fresh;
        $("offlineHuntRunBtn").disabled = !(fresh && state.hasParty);
        $("offlineHuntPreviewTroopBtn").disabled = !fresh;
        $("offlineHuntRunTroopBtn").disabled = !(fresh && state.hasParty);
    }
    function updateOptionInputs(options) {
        [["expRate", options.expRate], ["goldRate", options.goldRate], ["dropRate", options.dropRate], ["skillRate", options.skillRate]].forEach(([id, value]) => {
            const input = $(id);
            if (document.activeElement !== input && value != null)
                input.value = value;
        });
    }
    function updateBattleButtons(options, hooksPatched, rateStats, battleStats) {
        $("noCostBtn").classList.toggle("active", !!options.noSkillCost);
        $("oneHitKillBtn").classList.toggle("active", !!options.oneHitKill);
        $("invincibleBtn").classList.toggle("active", !!options.invincible);
        const noCost = options.noSkillCost ? "无耗ON" : "无耗OFF";
        const oneHit = options.oneHitKill ? "秒杀ON" : "秒杀OFF";
        const invincible = options.invincible ? "无敌ON" : "无敌OFF";
        const last = rateStats && rateStats.last
            ? `倍率命中 ${rateStats.last.name}`
            : "倍率未命中";
        const battle = battleStats && battleStats.last
            ? `战斗命中 ${battleStats.last.name}`
            : "战斗未命中";
        dom.battleState.textContent = `${noCost} / ${oneHit} / ${invincible} / hooks ${hooksPatched ? "OK" : "--"} / ${last} / ${battle}`;
    }
    function compactListHtml(rows, emptyText, itemText, limit = 8) {
        if (!Array.isArray(rows) || !rows.length)
            return `<span>${escapeHtml(emptyText)}</span>`;
        return rows.slice(0, limit).map(itemText).join("");
    }
    function chanceText(chance) {
        const value = Number(chance);
        if (!Number.isFinite(value))
            return "";
        const percent = Math.max(0, value * 100);
        return `${percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10}%`;
    }
    function previewDropRows(preview) {
        const groups = {};
        (preview && preview.troops || []).forEach((row) => {
            (row.preview && row.preview.possibleDrops || []).forEach((drop) => {
                if (!drop || !drop.kind || !drop.id)
                    return;
                const key = `${drop.kind}:${drop.id}`;
                if (!groups[key]) {
                    groups[key] = {
                        kind: drop.kind,
                        id: drop.id,
                        name: drop.name || "",
                        chance: Number(drop.chance || 0),
                        quality: drop.quality,
                        qualityLabel: drop.qualityLabel || "",
                        specialLabels: Array.isArray(drop.specialLabels) ? drop.specialLabels : [],
                        troops: new Set()
                    };
                }
                groups[key].chance = Math.max(Number(groups[key].chance || 0), Number(drop.chance || 0));
                groups[key].troops.add(row.troopId);
            });
        });
        const order = { item: 1, weapon: 2, armor: 3 };
        return Object.values(groups)
            .map((entry) => ({ ...entry, troopCount: entry.troops.size }))
            .sort((a, b) => (order[a.kind] || 9) - (order[b.kind] || 9) || b.chance - a.chance || a.id - b.id);
    }
    function dropKindSummary(rows) {
        const counts = rows.reduce((total, row) => {
            total[row.kind] = Number(total[row.kind] || 0) + 1;
            return total;
        }, {});
        return [
            `物品 ${formatNumber(counts.item || 0)} 种`,
            `武器 ${formatNumber(counts.weapon || 0)} 种`,
            `防具 ${formatNumber(counts.armor || 0)} 种`
        ].join(" / ");
    }
    function dropChipName(row) {
        const quality = row && row.qualityLabel ? `[${row.qualityLabel}] ` : "";
        const special = row && Array.isArray(row.specialLabels) && row.specialLabels.length
            ? ` · ${row.specialLabels.join("/")}`
            : "";
        return `${quality}${row && (row.name || `${row.kind}:${row.id}`) || ""}${special}`;
    }
    function updateOfflineHuntPanel(offlineHunt) {
        const last = offlineHunt && offlineHunt.last;
        const preview = offlineHunt && offlineHunt.preview;
        const showPreview = preview && (!last || Number(preview.ts || 0) >= Number(last.ts || 0));
        if (!offlineHunt) {
            dom.offlineHuntMetric.textContent = "0";
            dom.offlineHuntState.textContent = "等待运行时状态";
            dom.offlineHuntResult.innerHTML = "";
            return;
        }
        if (!offlineHunt.dataAvailable) {
            dom.offlineHuntMetric.textContent = "0";
            dom.offlineHuntState.textContent = "缺少 output/extract/data，先执行数据解包/解密";
            dom.offlineHuntResult.innerHTML = "";
            return;
        }
        if (showPreview || !last) {
            if (preview) {
                const average = preview.average || {};
                dom.offlineHuntMetric.textContent = `${formatNumber(average.exp || 0)} EXP/次`;
                dom.offlineHuntState.textContent = [
                    preview.mode === "troop" ? `敌群 ${preview.troopId}` : `地图 ${preview.mapId}`,
                    `预览 ${preview.name || preview.mapId}`,
                    `${formatNumber(preview.encounterCount || 0)} 组遇敌`,
                    `金币 ${formatNumber(average.gold || 0)}/次`,
                    preview.encounterStep ? `步数 ${preview.encounterStep}` : ""
                ].filter(Boolean).join(" / ");
                const troops = compactListHtml(preview.troops, "无遇敌", (row) => `<span class="result-chip">${escapeHtml(row.troopId)} ${escapeHtml(row.preview && row.preview.name || "")} / ${formatNumber(row.preview && row.preview.exp || 0)} EXP</span>`, 12);
                const dropRows = previewDropRows(preview);
                const drops = compactListHtml(dropRows, "无掉落表", (row) => `<span class="result-chip">${escapeHtml(itemKindLabels[row.kind] || row.kind)}:${escapeHtml(dropChipName(row))} ${escapeHtml(chanceText(row.chance))}</span>`, 24);
                dom.offlineHuntResult.innerHTML = `
          <div><strong>预览</strong>${troops}</div>
          <div><strong>掉落分类</strong><span>${escapeHtml(dropKindSummary(dropRows))}</span></div>
          <div><strong>可能掉落</strong>${drops}</div>
        `;
                return;
            }
            dom.offlineHuntMetric.textContent = "0";
            dom.offlineHuntState.textContent = offlineHuntMode === "troop"
                ? `可用敌群 ${catalogs.troop.length} 个，先选择敌群并预览或执行一次`
                : `可挂机地图 ${catalogs.huntMap.filter((entry) => entry.hasEncounters).length} / 全部地图 ${catalogs.huntMap.length}，先预览或执行一次`;
            dom.offlineHuntResult.innerHTML = "";
            return;
        }
        const time = new Date(last.ts || Date.now()).toLocaleTimeString("zh-CN", { hour12: false });
        const lastMode = last.mode === "troop" || Number(last.fixedTroopId || 0) > 0 ? "troop" : "map";
        dom.offlineHuntMetric.textContent = `${formatNumber(last.exp || 0)} EXP`;
        dom.offlineHuntState.textContent = [
            `${time}`,
            lastMode === "troop" ? `敌群 ${last.fixedTroopId || last.troopId || ""}` : `地图 ${last.mapId}`,
            `${formatNumber(last.times)} 次`,
            `金币 ${formatNumber(last.gold || 0)}`,
            last.autoSell && last.autoSell.gold ? `自动卖 ${formatNumber(last.autoSell.gold)} 金币` : "",
            last.blockedDrops && last.blockedDrops.count ? `屏蔽 ${formatNumber(last.blockedDrops.count)} 件` : "",
            last.specialAffixes && last.specialAffixes.count ? `特殊 ${formatNumber(last.specialAffixes.count)} 条` : "",
            last.dropMode === "runtime"
                ? `原生入包 ${formatNumber(last.runtimeDropCount || 0)} / 数据抽样 ${formatNumber(last.dataDropCount || 0)}`
                : "数据掉落",
            `掉落 ${formatNumber((last.dropSummary || []).length)} 种`,
            last.enemyBook && last.enemyBook.count ? `图鉴 ${last.enemyBook.count}` : "",
            last.saved ? `已保存 ${last.saved.id}` : ""
        ].filter(Boolean).join(" / ");
        const troops = compactListHtml(last.troopSummary, "无队列", (row) => `<span class="result-chip">${escapeHtml(row.id)} ${escapeHtml(row.name || "")} x${formatNumber(row.count)}</span>`, 12);
        const drops = compactListHtml(last.dropSummary, "无掉落", (row) => `<span class="result-chip">${escapeHtml(itemKindLabels[row.kind] || row.kind || "")}:${escapeHtml(dropChipName(row))} x${formatNumber(row.count)}</span>`, 24);
        const sold = compactListHtml(last.autoSell && last.autoSell.summary, "无自动卖出", (row) => `<span class="result-chip">${escapeHtml(itemKindLabels[row.kind] || row.kind || "")}:${escapeHtml(dropChipName(row))} x${formatNumber(row.count)}</span>`, 16);
        const blocked = compactListHtml(last.blockedDrops && last.blockedDrops.summary, "无屏蔽", (row) => `<span class="result-chip">${escapeHtml(itemKindLabels[row.kind] || row.kind || "")}:${escapeHtml(dropChipName(row))} x${formatNumber(row.count)}</span>`, 16);
        const specialAffixes = last.specialAffixes || {};
        const specialLabels = Object.entries(specialAffixes.byLabel || {}).map(([label, count]) => ({ label, count }));
        const specials = compactListHtml(specialLabels, "无额外特殊词缀", (row) => `<span class="result-chip">${escapeHtml(row.label)} x${formatNumber(row.count)}</span>`, 8);
        const kindCounts = last.dropKindCounts || {};
        const dropKinds = [
            `物品 ${formatNumber(kindCounts.item || 0)} 种`,
            `武器 ${formatNumber(kindCounts.weapon || 0)} 种`,
            `防具 ${formatNumber(kindCounts.armor || 0)} 种`
        ].join(" / ");
        dom.offlineHuntResult.innerHTML = `
      <div><strong>遇敌</strong>${troops}</div>
      <div><strong>分类</strong><span>${escapeHtml(dropKinds)}</span></div>
      <div><strong>掉落</strong>${drops}</div>
      <div><strong>特殊词缀</strong><span>${formatNumber(specialAffixes.count || 0)} 条</span>${specials}</div>
      <div><strong>自动卖出</strong><span>${formatNumber(last.autoSell && last.autoSell.gold || 0)} 金币</span>${sold}</div>
      <div><strong>已屏蔽</strong>${blocked}</div>
    `;
    }
    function updateFishingPanel(options, fishing, fishingStats) {
        const calls = fishing && fishing.calls || {};
        const fields = fishing && fishing.fields || {};
        const variables = fishing && fishing.variables || {};
        const switches = fishing && fishing.switches || {};
        const effectivePower = calls.fishPower && typeof calls.fishPower === "object" ? null : calls.fishPower;
        dom.fishingPowerMetric.textContent = formatNumber(effectivePower == null ? fields._fishPower || 0 : effectivePower);
        const autoSuccess = !!options.autoSuccess;
        $("fishingAutoSuccessBtn").classList.toggle("active", autoSuccess);
        [
            ["fishingPowerRate", options.powerRate],
            ["fishingPowerBonus", options.powerBonus],
            ["fishingPowerValue", fields._fishPower],
            ["fishingMedals", variables.medals],
            ["fishingCount", variables.count]
        ].forEach(([id, value]) => {
            const input = $(id);
            if (document.activeElement !== input && value != null)
                input.value = value;
        });
        const use = Array.isArray(fields._fishUse) ? fields._fishUse.join(", ") : "-";
        const last = fishingStats && fishingStats.last
            ? `${fishingStats.last.name} ${new Date(fishingStats.last.ts || Date.now()).toLocaleTimeString("zh-CN", { hour12: false })}`
            : "无";
        dom.fishingState.textContent = `自动成功 ${autoSuccess ? "ON" : "OFF"} / 钓具 ${use} / 最近 ${last}`;
        dom.fishingVariables.textContent = [
            `奖章 ${formatNumber(variables.medals)}`,
            `钓鱼数量 ${formatNumber(variables.count)}`,
            `技巧变量 ${formatNumber(variables.skill)}`,
            `渔夫 ${switches.fisherman ? "ON" : "OFF"}`,
            `钓者 ${switches.fisher ? "ON" : "OFF"}`,
            `钓师 ${switches.master ? "ON" : "OFF"}`
        ].join(" / ");
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
        }
        catch {
            renderEvents([]);
        }
    }
    function activateTab(tab) {
        activeToolTab = tab || "core";
        document.querySelectorAll("[data-tool-tab]").forEach((button) => {
            button.classList.toggle("active", button.dataset.toolTab === activeToolTab);
        });
        ensureActiveToolSection(activeToolTab);
        if (activeToolTab === "offline") {
            const sectionMode = activeToolSections.offline === "troop" ? "troop" : "map";
            setOfflineHuntMode(sectionMode, { keepSection: true, deferRender: true });
        }
        else
            updateVisiblePanels();
        requestAnimationFrame(() => {
            scrollActiveToolAreaToTop();
            renderActiveCatalogs();
        });
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
        document.querySelectorAll("[data-tool-tab]").forEach((button) => {
            button.addEventListener("click", () => activateTab(button.dataset.toolTab));
        });
        dom.toolSectionNav.addEventListener("click", (event) => {
            const button = event.target.closest("[data-tool-section-jump]");
            if (!button)
                return;
            activateToolSection(button.dataset.toolSectionJump || "");
        });
        dom.launchBtn.addEventListener("click", launchGame);
        dom.refreshBtn.addEventListener("click", refresh);
        dom.itemList.addEventListener("click", handleCatalogClick);
        dom.skillList.addEventListener("click", handleCatalogClick);
        dom.actorList.addEventListener("click", handleCatalogClick);
        dom.variableList.addEventListener("click", handleCatalogClick);
        dom.switchList.addEventListener("click", handleCatalogClick);
        dom.mapList.addEventListener("click", handleCatalogClick);
        dom.offlineHuntMapList.addEventListener("click", handleCatalogClick);
        dom.offlineHuntTroopList.addEventListener("click", handleCatalogClick);
        dom.commonEventList.addEventListener("click", handleCatalogClick);
        bindVirtualScroll(dom.itemList);
        bindVirtualScroll(dom.skillList);
        bindVirtualScroll(dom.actorList);
        bindVirtualScroll(dom.variableList);
        bindVirtualScroll(dom.switchList);
        bindVirtualScroll(dom.mapList);
        bindVirtualScroll(dom.offlineHuntMapList);
        bindVirtualScroll(dom.offlineHuntTroopList);
        bindVirtualScroll(dom.commonEventList);
        setupCatalogTools();
        bindViewportResize();
        $("goldSetBtn").addEventListener("click", () => sendCommand({ type: "gold.set", value: Number($("goldValue").value || 0) }));
        $("goldAddBtn").addEventListener("click", () => sendCommand({ type: "gold.add", amount: Number($("goldValue").value || 0) }));
        document.querySelectorAll("[data-gold-add]").forEach((button) => {
            button.addEventListener("click", () => sendCommand({ type: "gold.add", amount: Number(button.dataset.goldAdd) }));
        });
        document.querySelectorAll("[data-gold-set]").forEach((button) => {
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
        document.querySelectorAll("[data-rate]").forEach((button) => {
            button.addEventListener("click", () => {
                const rate = Number(button.dataset.rate || 1);
                $("expRate").value = rate;
                $("goldRate").value = rate;
                $("dropRate").value = rate;
                $("skillRate").value = rate;
                sendOptions({ expRate: rate, goldRate: rate, dropRate: rate, skillRate: rate });
            });
        });
        $("fishingPowerSetBtn").addEventListener("click", () => sendCommand({
            type: "fishing.power.set",
            value: numberValue("fishingPowerValue", 0)
        }));
        $("fishingPowerAddBtn").addEventListener("click", () => sendCommand({
            type: "fishing.power.add",
            amount: numberValue("fishingPowerAddValue", 0)
        }));
        $("fishingOptionsApplyBtn").addEventListener("click", () => sendFishingOptions({
            powerRate: numberValue("fishingPowerRate", 1),
            powerBonus: numberValue("fishingPowerBonus", 0)
        }));
        $("fishingAutoSuccessBtn").addEventListener("click", () => sendFishingOptions({
            autoSuccess: !$("fishingAutoSuccessBtn").classList.contains("active")
        }));
        document.querySelectorAll("[data-fishing-rate]").forEach((button) => {
            button.addEventListener("click", () => {
                const rate = Number(button.dataset.fishingRate || 1);
                $("fishingPowerRate").value = rate;
                sendFishingOptions({ powerRate: rate, powerBonus: numberValue("fishingPowerBonus", 0) });
            });
        });
        $("fishingAddRodsBtn").addEventListener("click", () => sendCommand({
            type: "fishing.items.add",
            roles: ["rod"],
            amount: numberValue("fishingItemAmount", 1)
        }));
        $("fishingAddBaitsBtn").addEventListener("click", () => sendCommand({
            type: "fishing.items.add",
            roles: ["bait"],
            amount: numberValue("fishingItemAmount", 1)
        }));
        $("fishingAddKitBtn").addEventListener("click", () => sendCommand({
            type: "fishing.items.add",
            roles: ["rod", "bait"],
            amount: numberValue("fishingItemAmount", 1)
        }));
        $("fishingAddFishBtn").addEventListener("click", () => sendCommand({
            type: "fishing.items.add",
            roles: ["fish"],
            amount: numberValue("fishingItemAmount", 1)
        }));
        $("fishingUnlockQualBtn").addEventListener("click", () => sendCommand({ type: "fishing.qualifications.unlock" }));
        $("fishingMedalSetBtn").addEventListener("click", () => sendCommand({
            type: "fishing.medals.set",
            value: numberValue("fishingMedals", 0)
        }));
        $("fishingMedalAddBtn").addEventListener("click", () => sendCommand({
            type: "fishing.medals.add",
            amount: numberValue("fishingMedalDelta", 0)
        }));
        $("fishingCountSetBtn").addEventListener("click", () => sendCommand({
            type: "fishing.count.set",
            value: numberValue("fishingCount", 0)
        }));
        $("fishingCountAddBtn").addEventListener("click", () => sendCommand({
            type: "fishing.count.add",
            amount: numberValue("fishingCountDelta", 0)
        }));
        $("fishingCatchBtn").addEventListener("click", () => sendCommand({
            type: "fishing.catch",
            pointId: numberValue("fishingPointId", 1),
            times: numberValue("fishingTimes", 1)
        }));
        $("noCostBtn").addEventListener("click", () => sendOptions({ noSkillCost: !$("noCostBtn").classList.contains("active") }));
        $("oneHitKillBtn").addEventListener("click", () => sendOptions({ oneHitKill: !$("oneHitKillBtn").classList.contains("active") }));
        $("invincibleBtn").addEventListener("click", () => sendOptions({ invincible: !$("invincibleBtn").classList.contains("active") }));
        $("battleKillBtn").addEventListener("click", () => sendCommand({ type: "battle.killEnemies" }));
        $("battleEscapeBtn").addEventListener("click", () => sendCommand({ type: "battle.escape" }));
        $("offlineHuntPreviewBtn").addEventListener("click", previewOfflineHunt);
        $("offlineHuntRunBtn").addEventListener("click", runOfflineHunt);
        $("offlineHuntPreviewTroopBtn").addEventListener("click", previewOfflineHunt);
        $("offlineHuntRunTroopBtn").addEventListener("click", runOfflineHunt);
        $("offlineHuntClearTroopBtn").addEventListener("click", () => {
            setOfflineHuntMode("map");
            $("offlineHuntTroopId").value = "";
            updateLookupHints();
            renderOfflineHuntTroopList();
        });
        document.querySelectorAll("[data-offline-hunt-times]").forEach((button) => {
            button.addEventListener("click", () => {
                $(offlineHuntMode === "troop" ? "offlineHuntTroopTimes" : "offlineHuntMapTimes").value = String(button.dataset.offlineHuntTimes || 10);
            });
        });
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
            }
            catch (error) {
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
    setOfflineHuntMode("map");
    refresh();
    setInterval(refresh, 700);
})();
