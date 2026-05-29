import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { decode } from "@msgpack/msgpack";
import { resolveGameRoot, resolveProjectRootFromTool } from "./modkit-config.mjs";

const projectRoot = resolveProjectRootFromTool(import.meta.url);
const gameRoot = resolveGameRoot(projectRoot);
const inDir = path.join(gameRoot, "www", "useData");
const outDir = path.join(projectRoot, "output", "extract", "useData");

function jsonReplacer(key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function main() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const index = [];
  const files = fs.readdirSync(inDir).filter(name => name.endsWith(".data")).sort();
  for (const name of files) {
    const inputPath = path.join(inDir, name);
    const raw = zlib.gunzipSync(fs.readFileSync(inputPath));
    if (raw.length < 21) throw new Error(`${name}: too short after gzip`);

    const prefix = raw.subarray(0, 20);
    const msgpack = raw.subarray(20);
    const value = decode(msgpack);
    const baseName = name.replace(/\.data$/i, "");

    fs.writeFileSync(path.join(outDir, `${baseName}.msgpack`), msgpack);
    fs.writeFileSync(path.join(outDir, `${baseName}.json`), JSON.stringify(value, jsonReplacer, 2), "utf8");

    index.push({
      file: name,
      rawSize: raw.length,
      prefixHex: prefix.toString("hex"),
      decodedType: Object.prototype.toString.call(value),
      keys: value && typeof value === "object" ? Object.keys(value).slice(0, 30) : []
    });
  }

  fs.writeFileSync(path.join(outDir, "_index.json"), JSON.stringify(index, null, 2), "utf8");
  console.log(`Extracted ${files.length} useData files to ${outDir}`);
}

main();
