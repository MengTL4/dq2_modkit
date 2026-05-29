# Rebuild Playbook

## Table of Contents

1. Scope and threat model
2. Recon checklist
3. Strategy selection
4. Project structure
5. Runtime launcher and bridge
6. Runtime setup and cleanup
7. Data extractors
8. Save harness and save encryption
9. Runtime trainer features
10. GUI implementation
11. Documentation and validation

## 1. Scope and Threat Model

Build a local modkit for a single-player NW.js/RPG Maker MV game. The core constraint is that the original launch chain performs integrity checks and disables remote debugging, so the tool must not modify original game files.

Protected originals:

```text
package.json
www/index.html
www/guard.js
```

Allowed project location:

```text
<game-root>/dq2_modkit
```

Also support portable placement outside the game directory. In that case the user must set the game root through `-GameRoot`, `DQ2_GAME_ROOT`, or `config.local.json`.

The runtime trainer only affects windows launched through the modkit launcher. It does not attach to arbitrary running processes.

Required local tools:

```text
Windows PowerShell
Node.js 18+ minimum; current LTS recommended
npm
Git only when publishing the project
```

Check:

```powershell
node --version
npm.cmd --version
```

Install Node.js from the official Windows LTS installer or with:

```powershell
winget install -e --id OpenJS.NodeJS.LTS
```

If `.ps1` execution is blocked, either set:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

or run scripts with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\tools\setup-runtime.ps1"
```

## 2. Recon Checklist

Confirm:

- Game root contains `Game.exe`, `nw.dll`, `node.dll`, `resources.pak`, `locales`, and `www`.
- `package.json` is an NW manifest.
- `www/index.html` loads RPG Maker MV scripts or bytecode bundles.
- `www/js/core.jsc.pak` and `www/js/plugins.jsc.pak` exist when scripts are bytecode-packed.
- `www/data.pak`, `www/manifest.enc`, `www/useData`, and `www/save` exist for this DQ2 project.
- Remote debugging is unavailable or disallowed.

Then inspect runtime globals with a controlled NW harness or bridge:

```text
$gameParty
$gameActors
$gameVariables
$gameSwitches
$gamePlayer
DataManager
ConfigManager
BattleManager
TK.$.StorageMrg
TK.$.DataMrg
TK.$.BattleMrg
```

## 3. Strategy Selection

Use this decision table before coding:

| Option | Why it is tempting | Why not use it here |
| --- | --- | --- |
| Edit original `index.html`/`package.json`/`guard.js` | Direct script injection | Triggers integrity checks and dirties game files |
| Remote debugging port | Easy console access | Disabled by config and not allowed by user constraint |
| Offline save editor only | Durable changes | Cannot affect current battle, current map, reward hooks, or no-cost skills |
| Modify `data.pak`/`useData` in place | Static database changes | Repacking and integrity risk; use for lookup first |
| Memory scanner/native injection | General-purpose | Overkill for JS/NW and less maintainable |
| Independent NW launcher + `inject_js_start` | Does not alter original files and runs in game page context | Adopt this |

The adopted design is:

```text
GUI or CLI -> bridge-state/commands.jsonl -> injected bridge -> game runtime objects
                                      <- bridge-state/events.jsonl / state.json
```

## 4. Project Structure

Create:

```text
dq2_modkit/
  README.md
  .gitignore
  .gitattributes
  config.example.json
  app/gui/
    package.json
    index.html
    styles.css
    app.ts
    app.js
    tsconfig.json
    package-lock.json
  app/save-editor/
    package.json
    index.html
    vite.config.ts
    tsconfig.json
    tsconfig.app.json
    tsconfig.node.json
    src/
      App.tsx
      codec.ts
      main.tsx
      styles.css
  runtime/
    trainer/
      package.json
      index.html
    bridge/
      page-bridge.js
      manifest.json
      content.js
    bridge-state/
    save-harness/
      package.json
      index.html
      missing-globals.json
  tools/
    package.json
    modkit-config.ps1
    modkit-config.mjs
    setup-runtime.ps1
    clean-runtime.ps1
    launch-gui.ps1
    launch-save-editor.ps1
    launch-runtime.ps1
    trainer-send.mjs
    extract-bytecode-bundles.mjs
    extract-data-pak.mjs
    extract-usedata.mjs
    extract-saves.ps1
    encrypt-saves.mjs
    encrypt-saves.ps1
    extract-all.ps1
  output/
    extract/
    repack/
    backup/
  docs/
    工具使用说明.md
    技术实现文档.md
```

## 5. Runtime Launcher and Bridge

Implement game-root resolution before writing launchers. Every script that reads original game files should use this order:

1. Explicit PowerShell parameter such as `-GameRoot`.
2. Environment variable `DQ2_GAME_ROOT`.
3. `config.local.json` beside `README.md`:

```json
{
  "gameRoot": "D:\\SteamLibrary\\steamapps\\common\\大千世界2 The Stupendous World Demo"
}
```

4. Legacy fallback: the parent directory of `dq2_modkit`.

Validate candidates by checking for `www/index.html`. Resolve explicit `-GameRoot` relative to the caller's current PowerShell location; resolve config/env relative paths relative to the project root. Commit `config.example.json`, ignore `config.local.json`, and set `DQ2_MODKIT_ROOT` plus `DQ2_GAME_ROOT` before spawning NW child processes.

`runtime/trainer/package.json` must enable Node and remote access for the opened file URL:

```json
{
  "name": "dq2-runtime-trainer",
  "main": "index.html",
  "nodejs": true,
  "node-remote": "<all_urls>",
  "window": { "show": false }
}
```

`runtime/trainer/index.html` should:

1. Resolve `projectRoot` as `dq2_modkit`.
2. Resolve `gameRoot` through the shared config order above.
3. Set `process.env.DQ2_MODKIT_ROOT` and `process.env.DQ2_GAME_ROOT`.
4. `process.chdir(gameRoot)`.
5. Open `file:///<gameRoot>/www/index.html` with `inject_js_start` pointing to `runtime/bridge/page-bridge.js`.

The bridge should:

- Patch save paths to `gameRoot/www/save`.
- Poll `runtime/bridge-state/commands.jsonl`.
- Append results to `events.jsonl`.
- Write online state to `state.json`.
- Ignore commands older than the bridge start time.
- Deduplicate commands by ID.
- Resolve objects through both standard globals and TK aliases.

## 6. Runtime Setup and Cleanup

Do not commit or manually maintain NW runtime files. Implement `setup-runtime.ps1` to generate:

- Hardlinks for `Game.exe`, `nw.dll`, `node.dll`, `ffmpeg.dll`, `resources.pak`, and other NW runtime files.
- A normal file copy fallback when hardlinks fail, for example when the project and game live on different drives.
- Junctions for `Dictionaries`, `locales`, and `swiftshader`.
- Extracted save harness bytecode from current `www/js/*.jsc.pak`.
- Missing `node_modules` under `tools` and `runtime/save-harness`.

When installing npm dependencies, do not mutate global npm config. Call npm with an explicit registry:

```powershell
npm.cmd install --omit=dev --registry <registry>
```

Default registry:

```text
https://registry.npmmirror.com
```

Expose `-NpmRegistry` and `DQ2_NPM_REGISTRY` for users who need another mirror or internal registry. If the selected registry fails, report the registry in the error so proxy or internal registry problems are easy to diagnose.

Targets:

```text
app/gui
runtime/trainer
runtime/save-harness
```

Author `app/gui` behavior in TypeScript (`app.ts`) and compile it to `app.js`, because the NW package still loads `app.js` from `index.html`. `launch-gui.ps1` should rebuild when `app.ts` is newer than `app.js`, using the configured npm registry.

Do not include `app/save-editor` in these NW runtime targets. It is a Vite browser app and should not receive `Game.exe`, `nw.dll`, or junctions.

Implement `clean-runtime.ps1` to delete only:

- Generated hardlinks.
- Generated junctions.
- Extracted `.jsc` bytecode in `runtime/save-harness`.
- `probe-result.json`.

It must verify every target path stays under `dq2_modkit`. It must refuse ordinary directories unless explicitly cleaning dependency directories with `-IncludeDependencies`.

## 7. Data Extractors

Implement `extract-data-pak.mjs` for:

```text
www/manifest.enc
www/data.pak
```

Output:

```text
dq2_modkit/output/extract/data
```

Use the manifest key to decrypt the PAKX index and entries, then unpack PAK1 and the old AES JSON envelope. See `formats-and-contracts.md` for exact cryptographic details.

Implement `extract-usedata.mjs` for:

```text
www/useData/*.data
```

Each file:

```text
gzip inflate -> skip 20-byte prefix -> MessagePack decode
```

Write `.json`, `.msgpack`, and `_index.json`.

Implement `extract-bytecode-bundles.mjs` for:

```text
www/js/core.jsc.pak
www/js/plugins.jsc.pak
```

Extract at least:

```text
rpg_core.js.jsc
rpg_managers.js.jsc
rpg_objects.js.jsc
rpg_scenes.js.jsc
rpg_sprites.js.jsc
rpg_windows.js.jsc
plugins.js.jsc
TK_Expand.js.jsc
```

## 8. Save Harness and Save Encryption

Use `runtime/save-harness` to run under the game NW version and load `.jsc` bytecode with:

```js
nw.Window.get().evalNWBin(null, Buffer.from(bytecode));
```

Stub missing browser/RPG Maker globals only as much as needed to initialize `TK.$.StorageMrg` and `TK.$.DataMrg`. Redirect storage paths to `gameRoot/www/save`, then call the game's storage load methods to obtain decoded MessagePack bytes.

For encryption, implement a direct Node path once keys and MAC ranges are known:

```text
JSON -> MessagePack -> zlib deflate -> AES-256-CBC -> HMAC-SHA256 -> base64
```

Always verify by decrypting the generated file and deep-comparing with the input JSON.

Implement the offline save tree editor as a separate browser module:

- Use Vite + React + `jsoneditor`.
- Use `@msgpack/msgpack`, `pako`, and WebCrypto in `app/save-editor/src/codec.ts`.
- Support `config.rpgsave` and v2 `global/fileN.rpgsave`.
- Infer slot ID from `global.rpgsave` and `fileN.rpgsave`, while allowing manual override.
- Use browser file input/download only; do not read the game directory directly and do not launch NW.
- Provide `tools/launch-save-editor.ps1` to install editor dependencies and start a local Vite server.

## 9. Runtime Trainer Features

Implement commands around game functions first:

```text
ping
status
gold.add / gold.set
item.add
actor.unlock / actor.remove / actor.recover
actor.level.set / actor.exp.add / actor.param.add
actor.skill.learn / actor.skill.forget
variable.set
switch.set
party.recover
map.current / map.transfer
commonEvent.run
progress.enemyBook.unlock
save
title.refresh
trainer.options.set
trainer.hooks.info
```

Feature implementation guidelines:

- `item.add`: resolve `kind` as `item`, `weapon`, or `armor`; call `$gameParty.gainItem(data[id], amount)`.
- `actor.skill.learn`: call `$gameActors.actor(actorId).learnSkill(skillId)`.
- `variable.set`: call `$gameVariables.setValue(id, value)`.
- `switch.set`: call `$gameSwitches.setValue(id, Boolean(value))`.
- `save`: call `DataManager.saveGame(savefileId)`.
- Enemy book: update `ConfigManager.enemyBook` and save config.

For rewards and combat:

- Patch `BattleManager.makeRewards`, `gainRewards`, `gainExp`, `gainGold`.
- Add fallback hooks on `Game_Actor.prototype.gainExp` and `Game_Party.prototype.gainGold`.
- Patch `Game_Enemy.prototype.dropItemRate` and `makeDropItems`.
- Track skill mastery baselines and multiply only the observed delta.
- For no skill cost, combine cost-method hooks with MP/TP resource guard hooks.

## 10. GUI Implementation

Use an external NW GUI, not injected in-game UI. It is easier to maintain and avoids input/menu conflicts.

GUI requirements:

- Launch bridge game window.
- Poll `state.json`.
- Append commands to `commands.jsonl`.
- Read `events.jsonl` for results.
- Load extracted RPG Maker data from `output/extract/data`.
- Show searchable and virtualized lists for items, weapons, armors, skills, actors, variables, switches, maps, common events.
- Search ID, name, description, note where available.
- Include item mode `all`, merging item/weapon/armor while preserving `kind`.
- Decode `www/img/system/IconSet.png` into per-entry icons when possible.
- Keep controls dense and utilitarian; avoid marketing-style layout.

GUI tabs:

```text
Common: gold, rates, no-cost, party recover, save, title refresh
Items/Actors: add item/weapon/armor, unlock actor, edit actor, learn/forget skill
Map/Event: transfer, current position, common event
Misc: variables, switches, enemy book unlock
Debug: raw JSON command
```

## 11. Documentation and Validation

Write two docs:

- `docs/工具使用说明.md`: user workflow for GUI, CLI, save decrypt/encrypt, extractors.
- `docs/技术实现文档.md`: strategy, runtime bridge, data formats, encryption, hooks, validation.

Minimum validation:

```powershell
cd "<dq2_modkit>"
.\tools\setup-runtime.ps1 -Force
.\tools\clean-runtime.ps1 -DryRun
node --check .\runtime\bridge\page-bridge.js
node --check .\app\gui\app.js
node --check .\tools\modkit-config.mjs
node --check .\tools\trainer-send.mjs
Push-Location .\app\gui; npm.cmd run build; Pop-Location
Push-Location .\app\save-editor; npm.cmd run build; Pop-Location
.\tools\extract-all.ps1
.\tools\encrypt-saves.ps1
```

Expected:

- Setup recreates hardlinks/junctions and extracted bytecode.
- Clean dry-run lists only generated runtime artifacts.
- Save editor builds as a standalone Vite app.
- `extract-data-pak` exports RPG Maker JSON files.
- `extract-usedata` exports JSON and MessagePack.
- `extract-saves` exports save JSON.
- `encrypt-saves` writes `_repack-report.json` with `verified=true`.
