import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveProjectRootFromTool(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..");
}

export function resolveGameRoot(projectRoot, explicitGameRoot = "") {
  const candidates = [];
  if (explicitGameRoot) candidates.push({ value: explicitGameRoot, base: process.cwd() });
  if (process.env.DQ2_GAME_ROOT) candidates.push({ value: process.env.DQ2_GAME_ROOT, base: projectRoot });

  const configPath = path.join(projectRoot, "config.local.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (config && config.gameRoot) candidates.push({ value: String(config.gameRoot), base: projectRoot });
  }

  candidates.push({ value: path.resolve(projectRoot, ".."), base: projectRoot });

  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const expanded = expandEnv(candidate.value);
    const fullPath = path.resolve(candidate.base, expanded);
    if (fs.existsSync(path.join(fullPath, "www", "index.html"))) {
      return fs.realpathSync(fullPath);
    }
  }

  throw new Error("Game root not found. Copy config.example.json to config.local.json and set gameRoot to the game directory that contains www/index.html.");
}

function expandEnv(value) {
  return String(value).replace(/%([^%]+)%|\$\{([^}]+)\}/g, (match, winName, posixName) => {
    const name = winName || posixName;
    return process.env[name] || match;
  });
}
