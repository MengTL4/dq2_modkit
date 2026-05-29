import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { decode, encode } from "@msgpack/msgpack";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDir, "..");

function parseArgs(argv) {
  const options = {
    inputDir: path.join(projectRoot, "output", "extract", "save"),
    outputDir: path.join(projectRoot, "output", "repack", "save"),
    ids: [0, 1, 3],
    includeConfig: true
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input") options.inputDir = path.resolve(argv[++i]);
    else if (arg === "--output") options.outputDir = path.resolve(argv[++i]);
    else if (arg === "--ids") options.ids = argv[++i].split(",").map(x => Number(x.trim())).filter(Number.isFinite);
    else if (arg === "--no-config") options.includeConfig = false;
    else if (!arg.startsWith("--") && !options._posInput) {
      options.inputDir = path.resolve(arg);
      options._posInput = true;
    } else if (!arg.startsWith("--") && !options._posOutput) {
      options.outputDir = path.resolve(arg);
      options._posOutput = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function sha256Bytes(data) {
  return crypto.createHash("sha256").update(data).digest();
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function saveSeed(savefileId) {
  if (Number(savefileId) === 0) {
    return "dq2|sv2|tk_expand|RPGMV|MV|global|0";
  }
  return `dq2|sv2|tk_expand|RPGMV|MV|save|${savefileId}`;
}

function deriveSaveKeys(savefileId) {
  const base = sha256Hex(saveSeed(savefileId));
  return {
    encKey: sha256Bytes(`${base}|enc|`),
    macKey: sha256Bytes(`${base}|mac|`),
    base
  };
}

function aesCbcEncrypt(key, iv, plaintext) {
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function aesCbcDecrypt(key, iv, ciphertext) {
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function packSaveV2(savefileId, msgpackBytes) {
  const keys = deriveSaveKeys(savefileId);
  const compressed = zlib.deflateSync(Buffer.from(msgpackBytes));
  const iv = crypto.randomBytes(16);
  const ciphertext = aesCbcEncrypt(keys.encKey, iv, compressed);

  const header = Buffer.alloc(25);
  header[0] = 0x93;
  header[1] = 0xc1;
  header[2] = 0x4a;
  header[3] = 0x2e;
  header[4] = 0x02;
  iv.copy(header, 5);
  header.writeUInt32LE(ciphertext.length, 21);

  const authenticated = Buffer.concat([header, ciphertext]);
  const mac = hmacSha256(keys.macKey, authenticated);
  return Buffer.concat([authenticated, mac]).toString("base64");
}

function unpackSaveV2(savefileId, text) {
  const raw = Buffer.from(String(text).trim(), "base64");
  if (raw.length < 57 || raw[0] !== 0x93 || raw[1] !== 0xc1 || raw[2] !== 0x4a || raw[3] !== 0x2e || raw[4] !== 0x02) {
    throw new Error("not a supported v2 save");
  }
  const iv = raw.subarray(5, 21);
  const ciphertextLength = raw.readUInt32LE(21);
  const ciphertextStart = 25;
  const ciphertextEnd = ciphertextStart + ciphertextLength;
  const ciphertext = raw.subarray(ciphertextStart, ciphertextEnd);
  const mac = raw.subarray(ciphertextEnd, ciphertextEnd + 32);
  const keys = deriveSaveKeys(savefileId);
  const actualMac = hmacSha256(keys.macKey, raw.subarray(0, ciphertextEnd));
  if (mac.length !== 32 || !crypto.timingSafeEqual(mac, actualMac)) {
    throw new Error("save HMAC verification failed");
  }
  const compressed = aesCbcDecrypt(keys.encKey, iv, ciphertext);
  return zlib.inflateSync(compressed);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stableJson(value) {
  return JSON.stringify(value, (key, val) => typeof val === "bigint" ? val.toString() : val);
}

function writeConfig(inputDir, outputDir) {
  const inputPath = path.join(inputDir, "config.json");
  if (!fs.existsSync(inputPath)) return null;
  const value = readJson(inputPath);
  const msgpackBytes = Buffer.from(encode(value));
  const text = zlib.deflateSync(msgpackBytes).toString("base64");
  const outputPath = path.join(outputDir, "config.rpgsave");
  fs.writeFileSync(outputPath, text, "utf8");
  const roundTrip = decode(zlib.inflateSync(Buffer.from(text, "base64")));
  return {
    name: "config.rpgsave",
    source: inputPath,
    output: outputPath,
    msgpackLength: msgpackBytes.length,
    outputLength: text.length,
    verified: stableJson(roundTrip) === stableJson(value)
  };
}

function writeSave(inputDir, outputDir, savefileId) {
  const baseName = Number(savefileId) === 0 ? "global" : `file${savefileId}`;
  const inputPath = path.join(inputDir, `${baseName}.json`);
  if (!fs.existsSync(inputPath)) return null;
  const value = readJson(inputPath);
  const msgpackBytes = Buffer.from(encode(value));
  const text = packSaveV2(savefileId, msgpackBytes);
  const outputPath = path.join(outputDir, `${baseName}.rpgsave`);
  fs.writeFileSync(outputPath, text, "utf8");
  const roundTrip = decode(unpackSaveV2(savefileId, text));
  return {
    id: savefileId,
    name: `${baseName}.rpgsave`,
    source: inputPath,
    output: outputPath,
    seed: saveSeed(savefileId),
    msgpackLength: msgpackBytes.length,
    outputLength: text.length,
    verified: stableJson(roundTrip) === stableJson(value)
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.outputDir, { recursive: true });

  const results = [];
  if (options.includeConfig) {
    const config = writeConfig(options.inputDir, options.outputDir);
    if (config) results.push(config);
  }
  for (const id of options.ids) {
    const result = writeSave(options.inputDir, options.outputDir, id);
    if (result) results.push(result);
  }

  const failures = results.filter(x => !x.verified);
  fs.writeFileSync(path.join(options.outputDir, "_repack-report.json"), JSON.stringify({
    inputDir: options.inputDir,
    outputDir: options.outputDir,
    results
  }, null, 2), "utf8");

  if (failures.length > 0) {
    throw new Error(`verification failed for: ${failures.map(x => x.name).join(", ")}`);
  }

  for (const result of results) {
    console.log(`${result.name}\t${result.outputLength}\tverified=${result.verified}`);
  }
  console.log(`Wrote ${results.length} files to ${options.outputDir}`);
}

main();
