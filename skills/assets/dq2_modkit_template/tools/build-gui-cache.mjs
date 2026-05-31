import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDir, "..");
const dataDir = path.join(projectRoot, "output", "extract", "data");
const outPath = path.join(dataDir, "_gui-cache.json");
const version = 1;

const itemKindLabels = {
  item: "物品",
  weapon: "武器",
  armor: "防具"
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readArray(fileName) {
  const file = path.join(dataDir, fileName);
  if (!fs.existsSync(file)) return [];
  const data = readJson(file);
  return Array.isArray(data) ? data : [];
}

function cleanText(value) {
  return String(value == null ? "" : value)
    .replace(/\\[A-Z]+\[[^\]]*\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeSearchText(parts) {
  return parts
    .filter((part) => part != null && part !== "")
    .map((part) => String(part))
    .join(" ")
    .toLowerCase();
}

function dropKindFromIndex(kind) {
  if (kind === 1 || kind === "1" || String(kind).toLowerCase() === "item") return "item";
  if (kind === 2 || kind === "2" || String(kind).toLowerCase() === "weapon") return "weapon";
  if (kind === 3 || kind === "3" || String(kind).toLowerCase() === "armor") return "armor";
  return "";
}

function localDropTables() {
  return {
    item: readArray("Items.json"),
    weapon: readArray("Weapons.json"),
    armor: readArray("Armors.json")
  };
}

function localDropNamesOfEnemy(enemy, tables) {
  const names = [];
  const seen = new Set();
  const add = (kind, id) => {
    const normalized = dropKindFromIndex(kind);
    const table = tables[normalized];
    const entry = table && table[Number(id)];
    if (!normalized || !entry || !entry.name) return;
    const key = `${normalized}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    names.push(`${itemKindLabels[normalized] || normalized}:${cleanText(entry.name)}`);
  };
  const note = String(enemy && enemy.note || "");
  const match = note.match(/<\s*Enemy Drops\s*>([\s\S]*?)<\s*\/\s*Enemy Drops\s*>/i);
  if (match) {
    match[1].split(/\r?\n/).forEach((line) => {
      const parsed = line.trim().match(/^(item|weapon|armor)\s+(\d+)\s*:/i);
      if (parsed) add(parsed[1], parsed[2]);
    });
  }
  (enemy && enemy.dropItems || []).forEach((drop) => {
    if (drop && drop.kind && drop.dataId) add(drop.kind, drop.dataId);
  });
  return names;
}

function localTroopDetails(troop, enemies, tables) {
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
    if (!enemyCounts[key]) enemyCounts[key] = { id: enemyId, name: enemyName, count: 0 };
    enemyCounts[key].count += 1;
    exp += Number(enemy.exp || 0);
    gold += Number(enemy.gold || 0);
    const mapMatch = String(enemy.note || "").match(/<\s*enemyMap\s*:\s*([^>]+)>/i);
    if (mapMatch && cleanText(mapMatch[1])) maps.add(cleanText(mapMatch[1]));
    localDropNamesOfEnemy(enemy, tables).forEach((name) => dropNames.add(name));
  });
  const enemyList = Object.values(enemyCounts);
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

function buildTroopCatalog(troops, enemies, tables) {
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

function buildHuntMapCatalog(mapInfos, troops, enemies, tables) {
  const ids = new Set();
  mapInfos.forEach((entry) => {
    if (entry && Number(entry.id) > 0 && entry.name) ids.add(Number(entry.id));
  });
  fs.readdirSync(dataDir).forEach((name) => {
    const match = name.match(/^Map(\d{3})\.json$/i);
    if (match) ids.add(Number(match[1]));
  });
  return Array.from(ids)
    .sort((a, b) => a - b)
    .map((id) => {
      const mapPath = path.join(dataDir, `Map${String(id).padStart(3, "0")}.json`);
      const map = fs.existsSync(mapPath) ? readJson(mapPath) : null;
      const info = mapInfos[id] || {};
      if (!map && !info.name) return null;
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

if (!fs.existsSync(dataDir)) {
  throw new Error(`data dir not found: ${dataDir}`);
}

const mapInfos = readArray("MapInfos.json");
const troops = readArray("Troops.json");
const enemies = readArray("Enemies.json");
const tables = localDropTables();
const cache = {
  version,
  generatedAt: new Date().toISOString(),
  huntMap: buildHuntMapCatalog(mapInfos, troops, enemies, tables),
  troop: buildTroopCatalog(troops, enemies, tables)
};

fs.writeFileSync(outPath, JSON.stringify(cache), "utf8");
console.log(`Wrote ${path.relative(projectRoot, outPath)} (${cache.huntMap.length} maps, ${cache.troop.length} troops)`);
