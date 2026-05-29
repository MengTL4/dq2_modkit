import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { resolveGameRoot, resolveProjectRootFromTool } from "./modkit-config.mjs";

const projectRoot = resolveProjectRootFromTool(import.meta.url);
const gameRoot = resolveGameRoot(projectRoot);
const outDir = path.join(projectRoot, "output", "extract", "data");
const bootstrapKey = "f5bd74e6a64130031cd105edce551df2";

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

function hmacSha256(key, buf) {
  return crypto.createHmac("sha256", key).update(buf).digest();
}

function aesCbcDecrypt(key, iv, ciphertext) {
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function decryptManifest() {
  const manifestPath = path.join(gameRoot, "www", "manifest.enc");
  const envelope = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const plain = aesCbcDecrypt(
    Buffer.from(bootstrapKey, "utf8"),
    Buffer.from(envelope.iv, "hex"),
    Buffer.from(envelope.encryptedData, "hex")
  );
  return JSON.parse(plain.toString("utf8"));
}

function normalizeKey(key) {
  return Buffer.from(String(key).padEnd(32, "0").slice(0, 32), "utf8");
}

function derivePakKeys(key) {
  const normalized = normalizeKey(key);
  return {
    encKey: sha256(Buffer.concat([Buffer.from("enc:"), normalized])),
    macKey: sha256(Buffer.concat([Buffer.from("mac:"), normalized]))
  };
}

function decryptAuthenticatedPayload(payload, aad, keys) {
  if (!payload || payload.v !== 2 || payload.alg !== "A256CBC-HS256") {
    throw new Error(`unsupported authenticated payload for ${aad}`);
  }
  const iv = Buffer.from(payload.iv, "hex");
  const ciphertext = Buffer.from(payload.data, "hex");
  const expectedMac = Buffer.from(payload.mac, "hex");
  const actualMac = hmacSha256(keys.macKey, Buffer.concat([Buffer.from(aad), iv, ciphertext]));
  if (!crypto.timingSafeEqual(expectedMac, actualMac)) {
    throw new Error(`MAC mismatch for ${aad}`);
  }
  return aesCbcDecrypt(keys.encKey, iv, ciphertext);
}

function inflatePak1(buf) {
  if (buf.subarray(0, 4).toString("ascii") !== "PAK1") {
    return zlib.inflateSync(buf);
  }
  let off = 4;
  off += 8; // type
  off += 4; // original size
  off += 4; // compressed size
  const filenameLength = buf.readUInt32LE(off);
  off += 4;
  off += 16; // reserved
  off += filenameLength;

  const candidates = [off, 44 + filenameLength];
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(buf[i + 1])) {
      candidates.push(i);
      break;
    }
  }
  for (const start of candidates) {
    try {
      return zlib.inflateSync(buf.subarray(start));
    } catch {
      // Try the next plausible header size.
    }
  }
  throw new Error("unable to inflate PAK1 payload");
}

function decryptLegacyJson(text, key) {
  const envelope = JSON.parse(text);
  if (!envelope.iv || !envelope.encryptedData) return text;
  const plain = aesCbcDecrypt(
    Buffer.from(String(key).slice(0, 32), "utf8"),
    Buffer.from(envelope.iv, "hex"),
    Buffer.from(envelope.encryptedData, "hex")
  );
  return plain.toString("utf8");
}

function main() {
  const manifest = decryptManifest();
  const key = manifest.key || bootstrapKey;
  const keys = derivePakKeys(key);
  const pak = fs.readFileSync(path.join(gameRoot, "www", "data.pak"));

  if (pak.subarray(0, 4).toString("ascii") !== "PAKX") {
    throw new Error("data.pak is not a PAKX archive");
  }

  const metaLen = pak.readUInt32LE(4);
  const indexPayload = JSON.parse(pak.subarray(8, 8 + metaLen).toString("utf8"));
  const indexText = decryptAuthenticatedPayload(indexPayload, "PAKX_INDEX_V2", keys).toString("utf8");
  const index = JSON.parse(indexText);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "_index.json"), JSON.stringify(index, null, 2), "utf8");

  const baseOffset = 8 + metaLen - (index.files[0]?.offset || 0);
  for (const entry of index.files) {
    const start = baseOffset + entry.offset;
    const sealedText = pak.subarray(start, start + entry.compressedSize).toString("utf8");
    const sealed = JSON.parse(sealedText);
    const pak1 = decryptAuthenticatedPayload(sealed, `PAKX_DATA:${entry.path}`, keys);
    const legacyText = inflatePak1(pak1).toString("utf8");
    const plainText = decryptLegacyJson(legacyText, key);

    const outputPath = path.join(outDir, entry.path);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    try {
      fs.writeFileSync(outputPath, JSON.stringify(JSON.parse(plainText), null, 2), "utf8");
    } catch {
      fs.writeFileSync(outputPath, plainText, "utf8");
    }
  }

  console.log(`Extracted ${index.files.length} files to ${outDir}`);
}

main();
