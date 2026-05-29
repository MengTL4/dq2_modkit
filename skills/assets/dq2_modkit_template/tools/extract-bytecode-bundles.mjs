import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDir, "..");
const gameRoot = path.resolve(projectRoot, "..");
const outDir = path.join(projectRoot, "runtime", "save-harness");

const wanted = new Map([
  ["js/rpg_core.js", "rpg_core.js.jsc"],
  ["js/rpg_managers.js", "rpg_managers.js.jsc"],
  ["js/rpg_objects.js", "rpg_objects.js.jsc"],
  ["js/rpg_scenes.js", "rpg_scenes.js.jsc"],
  ["js/rpg_sprites.js", "rpg_sprites.js.jsc"],
  ["js/rpg_windows.js", "rpg_windows.js.jsc"],
  ["js/plugins.js", "plugins.js.jsc"],
  ["js/plugins/TK_Expand.js", "TK_Expand.js.jsc"]
]);

function inflatePak1(filePath) {
  const input = fs.readFileSync(filePath);
  const candidates = [];
  for (let i = 0; i < input.length - 1; i += 1) {
    if (input[i] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(input[i + 1])) {
      candidates.push(i);
      break;
    }
  }
  if (input.subarray(0, 4).toString("ascii") === "PAK1") {
    const nameLengthOffset = 4 + 8 + 4 + 4;
    if (input.length > nameLengthOffset + 4) {
      const filenameLength = input.readUInt32LE(nameLengthOffset);
      candidates.unshift(4 + 8 + 4 + 4 + 4 + 16 + filenameLength);
    }
  }
  for (const offset of candidates) {
    try {
      return zlib.inflateSync(input.subarray(offset));
    } catch {
      // Try next candidate.
    }
  }
  throw new Error(`unable to inflate ${filePath}`);
}

function extractBundle(fileName) {
  const bundle = inflatePak1(path.join(gameRoot, "www", "js", fileName));
  if (bundle.subarray(0, 8).toString("ascii") !== "BUNDLE01") {
    throw new Error(`${fileName} is not a BUNDLE01 payload`);
  }
  const metaLength = bundle.readUInt32LE(8);
  const meta = JSON.parse(bundle.subarray(12, 12 + metaLength).toString("utf8"));
  const dataStart = 12 + metaLength;
  let count = 0;
  for (const script of meta.scripts || []) {
    const outputName = wanted.get(script.name);
    if (!outputName) continue;
    const bytes = bundle.subarray(dataStart + script.offset, dataStart + script.offset + script.length);
    fs.writeFileSync(path.join(outDir, outputName), bytes);
    count += 1;
  }
  return count;
}

fs.mkdirSync(outDir, { recursive: true });
const count = extractBundle("core.jsc.pak") + extractBundle("plugins.jsc.pak");
console.log(`Extracted ${count} bytecode files to ${outDir}`);
