import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDir, "..");
const bridgeDir = path.join(projectRoot, "runtime", "bridge-state");
const commandPath = path.join(bridgeDir, "commands.jsonl");
const statePath = path.join(bridgeDir, "state.json");
const eventPath = path.join(bridgeDir, "events.jsonl");

function usage() {
  console.log(`Usage:
  node trainer-send.mjs status
  node trainer-send.mjs ping
  node trainer-send.mjs gold.add 10000
  node trainer-send.mjs gold.set 999999
  node trainer-send.mjs variable.set 12 999
  node trainer-send.mjs switch.set 34 true
  node trainer-send.mjs item.add item 5 10
  node trainer-send.mjs actor.unlock 1
  node trainer-send.mjs actor.add 1
  node trainer-send.mjs actor.remove 1
  node trainer-send.mjs actor.recover 1
  node trainer-send.mjs actor.level.set 1 20
  node trainer-send.mjs actor.exp.add 1 1000
  node trainer-send.mjs actor.skill.learn 1 10
  node trainer-send.mjs actor.skill.forget 1 10
  node trainer-send.mjs actor.param.add 1 2 50
  node trainer-send.mjs progress.enemyBook.unlock
  node trainer-send.mjs party.recover
  node trainer-send.mjs trainer.options.set expRate=2 goldRate=2 dropRate=3 skillRate=5 noSkillCost=true oneHitKill=true invincible=true
  node trainer-send.mjs trainer.hooks.info
  node trainer-send.mjs battle.killEnemies
  node trainer-send.mjs battle.escape
  node trainer-send.mjs hangup.info
  node trainer-send.mjs hangup.start
  node trainer-send.mjs hangup.stop
  node trainer-send.mjs hangup.refresh
  node trainer-send.mjs offlineHunt.info
  node trainer-send.mjs offlineHunt.preview 31
  node trainer-send.mjs offlineHunt.preview troopId=192
  node trainer-send.mjs offlineHunt.run mapId=31 times=10 enemyBook=true recover=true save=false autoSellQualities=0,1,2 blockDropQualities=1,2,3
  node trainer-send.mjs offlineHunt.run troopId=192 times=10 enemyBook=true save=false autoSellQualities=0,1,2,3,4,5,6,7,8
  node trainer-send.mjs runtime.search fish fishing 钓 鱼
  node trainer-send.mjs runtime.inspect window.TK.$ 300
  node trainer-send.mjs fishing.info
  node trainer-send.mjs fishing.options.set autoSuccess=true powerRate=5 powerBonus=20
  node trainer-send.mjs fishing.power.set 100
  node trainer-send.mjs fishing.power.add 10
  node trainer-send.mjs fishing.items.add rod,bait 1
  node trainer-send.mjs fishing.qualifications.unlock
  node trainer-send.mjs fishing.catch 1 5
  node trainer-send.mjs map.current
  node trainer-send.mjs map.transfer 5 10 12
  node trainer-send.mjs commonEvent.run 10
  node trainer-send.mjs save 1
  node trainer-send.mjs title.refresh`);
}

function parseValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  const number = Number(value);
  if (Number.isFinite(number) && String(number) === String(value)) return number;
  return value;
}

function parseKeyValueArgs(parts) {
  const options = {};
  for (const part of parts) {
    const index = String(part).indexOf("=");
    if (index <= 0) continue;
    options[String(part).slice(0, index)] = parseValue(String(part).slice(index + 1));
  }
  return options;
}

function makeOfflineHuntCommand(type, args) {
  if (args.some(part => String(part).includes("="))) {
    return { type, ...parseKeyValueArgs(args) };
  }
  return {
    type,
    mapId: type === "offlineHunt.info" && args[0] === undefined ? undefined : Number(args[0] || 31),
    times: type === "offlineHunt.run" ? Number(args[1] || 10) : undefined,
    regionId: args[2] === undefined ? undefined : Number(args[2]),
    troopId: args[3] === undefined ? undefined : Number(args[3]),
    enemyBook: args[4] === undefined ? undefined : parseValue(args[4]),
    recover: args[5] === undefined ? undefined : parseValue(args[5]),
    save: args[6] === undefined ? undefined : parseValue(args[6]),
    saveSlot: args[7] === undefined ? undefined : Number(args[7])
  };
}

function makeCommand(argv) {
  const type = argv[0];
  if (!type || type === "help" || type === "--help") return null;
  if (type === "status") return { statusOnly: true };
  if (type === "ping") return { type: "ping" };
  if (type === "gold.add") return { type, amount: Number(argv[1]) };
  if (type === "gold.set") return { type, value: Number(argv[1]) };
  if (type === "variable.set") return { type, id: Number(argv[1]), value: parseValue(argv[2]) };
  if (type === "switch.set") return { type, id: Number(argv[1]), value: parseValue(argv[2]) };
  if (type === "item.add") return { type, kind: argv[1] || "item", id: Number(argv[2]), amount: Number(argv[3] || 1) };
  if (type === "actor.unlock") return { type, id: Number(argv[1]) };
  if (type === "actor.add") return { type, id: Number(argv[1]) };
  if (type === "actor.remove") return { type, id: Number(argv[1]) };
  if (type === "actor.recover") return { type, id: Number(argv[1]) };
  if (type === "actor.level.set") return { type, id: Number(argv[1]), level: Number(argv[2]) };
  if (type === "actor.exp.add") return { type, id: Number(argv[1]), amount: Number(argv[2]) };
  if (type === "actor.vitals.set") return { type, id: Number(argv[1]), hp: parseValue(argv[2]), mp: parseValue(argv[3]), tp: parseValue(argv[4]) };
  if (type === "actor.param.add") return { type, id: Number(argv[1]), paramId: Number(argv[2]), value: Number(argv[3]) };
  if (type === "actor.name.set") return { type, id: Number(argv[1]), name: argv.slice(2).join(" ") };
  if (type === "actor.skill.learn") return { type, id: Number(argv[1]), skillId: Number(argv[2]) };
  if (type === "actor.skill.forget") return { type, id: Number(argv[1]), skillId: Number(argv[2]) };
  if (type === "progress.enemyBook.unlock") return { type, ids: argv.slice(1) };
  if (type === "battle.killEnemies") return { type, finish: argv[1] === undefined ? undefined : parseValue(argv[1]) };
  if (type === "battle.escape") return { type };
  if (type === "hangup.info") return { type };
  if (type === "hangup.start") return { type };
  if (type === "hangup.stop") return { type };
  if (type === "hangup.refresh") return { type };
  if (type === "offlineHunt.info") return makeOfflineHuntCommand(type, argv.slice(1));
  if (type === "offlineHunt.preview") return makeOfflineHuntCommand(type, argv.slice(1));
  if (type === "offlineHunt.run") return makeOfflineHuntCommand(type, argv.slice(1));
  if (type === "party.recover") return { type };
  if (type === "trainer.options.get") return { type };
  if (type === "trainer.hooks.info") return { type };
  if (type === "runtime.search") return { type, keywords: argv.slice(1).filter(Boolean) };
  if (type === "runtime.inspect") return { type, path: argv[1] || "window", maxKeys: argv[2] ? Number(argv[2]) : undefined };
  if (type === "fishing.info") return { type, limit: argv[1] ? Number(argv[1]) : undefined };
  if (type === "fishing.options.get") return { type };
  if (type === "fishing.options.set") {
    return { type, options: parseKeyValueArgs(argv.slice(1)) };
  }
  if (type === "fishing.power.set") return { type, value: Number(argv[1]) };
  if (type === "fishing.power.add") return { type, amount: Number(argv[1]) };
  if (type === "fishing.medals.set") return { type, value: Number(argv[1]) };
  if (type === "fishing.medals.add") return { type, amount: Number(argv[1]) };
  if (type === "fishing.count.set") return { type, value: Number(argv[1]) };
  if (type === "fishing.count.add") return { type, amount: Number(argv[1]) };
  if (type === "fishing.items.add") {
    const roles = String(argv[1] || "rod,bait").split(/[,，\s]+/).filter(Boolean);
    return { type, roles, amount: Number(argv[2] || 1) };
  }
  if (type === "fishing.qualifications.unlock") return { type };
  if (type === "fishing.catch") return { type, pointId: Number(argv[1] || 1), times: Number(argv[2] || 1) };
  if (type === "map.current") return { type };
  if (type === "map.transfer") return { type, mapId: Number(argv[1]), x: Number(argv[2] || 0), y: Number(argv[3] || 0), direction: Number(argv[4] || 2), fade: Number(argv[5] || 0) };
  if (type === "commonEvent.run") return { type, id: Number(argv[1]) };
  if (type === "trainer.options.set") {
    return { type, options: parseKeyValueArgs(argv.slice(1)) };
  }
  if (type === "save") return { type, id: Number(argv[1] || 1) };
  if (type === "title.refresh") return { type };
  throw new Error(`unknown command: ${type}`);
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const command = makeCommand(process.argv.slice(2));
if (!command) {
  usage();
  process.exit(0);
}

if (command.statusOnly) {
  console.log(JSON.stringify(readJsonIfExists(statePath), null, 2));
  process.exit(0);
}

fs.mkdirSync(bridgeDir, { recursive: true });
command.commandId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
command.ts = Date.now();
fs.appendFileSync(commandPath, JSON.stringify(command) + "\n", "utf8");
console.log(`queued ${command.type} commandId=${command.commandId}`);

setTimeout(() => {
  const state = readJsonIfExists(statePath);
  console.log("state:");
  console.log(JSON.stringify(state, null, 2));
  if (fs.existsSync(eventPath)) {
    const lines = fs.readFileSync(eventPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
    const event = lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean).reverse().find(item => item.commandId === command.commandId);
    if (event) {
      console.log("event:");
      console.log(JSON.stringify(event, null, 2));
    }
  }
}, 700);
