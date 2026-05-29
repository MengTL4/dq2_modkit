# Formats and Contracts

## Table of Contents

1. Runtime-generated files
2. PAK/data formats
3. useData format
4. Save formats
5. IconSet decoding
6. Bridge state files
7. Command contracts
8. Hook targets
9. Validation commands

## 1. Runtime-Generated Files

Generated NW runtime files:

```text
d3dcompiler_47.dll
ffmpeg.dll
Game.exe
icudtl.dat
libEGL.dll
libGLESv2.dll
node.dll
notification_helper.exe
nw_100_percent.pak
nw_200_percent.pak
nw_elf.dll
nw.dll
resources.pak
v8_context_snapshot.bin
Dictionaries/
locales/
swiftshader/
```

Generate them in:

```text
dq2_modkit/app/gui
dq2_modkit/runtime/trainer
dq2_modkit/runtime/save-harness
```

Generated save harness bytecode:

```text
plugins.js.jsc
rpg_core.js.jsc
rpg_managers.js.jsc
rpg_objects.js.jsc
rpg_scenes.js.jsc
rpg_sprites.js.jsc
rpg_windows.js.jsc
TK_Expand.js.jsc
```

## 2. PAK/data Formats

### manifest.enc

JSON envelope:

```json
{
  "iv": "...",
  "encryptedData": "..."
}
```

Decrypt:

```text
AES-256-CBC
key = UTF-8 bytes of "f5bd74e6a64130031cd105edce551df2"
iv = hex envelope.iv
ciphertext = hex envelope.encryptedData
```

The key string is used as 32 UTF-8 bytes; do not hex-decode it to 16 bytes.

### data.pak PAKX

Header:

```text
4 bytes   magic: PAKX
4 bytes   little-endian index envelope length
N bytes   index envelope JSON
...       sealed entries
```

Key derivation:

```js
normalized = Buffer.from(String(key).padEnd(32, "0").slice(0, 32), "utf8");
encKey = sha256(Buffer.concat([Buffer.from("enc:"), normalized]));
macKey = sha256(Buffer.concat([Buffer.from("mac:"), normalized]));
```

Envelope:

```json
{
  "v": 2,
  "alg": "A256CBC-HS256",
  "iv": "...",
  "data": "...",
  "mac": "..."
}
```

Index MAC:

```text
HMAC-SHA256(macKey, "PAKX_INDEX_V2" || iv || ciphertext)
```

Entry MAC:

```text
HMAC-SHA256(macKey, "PAKX_DATA:" + entry.path || iv || ciphertext)
```

Decrypt with:

```text
AES-256-CBC(encKey, iv)
```

Each entry then contains `PAK1`, followed by an old AES JSON envelope that uses the manifest key.

## 3. useData Format

For `www/useData/*.data`:

```text
gzip payload
  -> inflate
  -> first 20 bytes are prefix
  -> remaining bytes are MessagePack
  -> decode to JSON
```

Write:

```text
<name>.msgpack
<name>.json
_index.json
```

## 4. Save Formats

### config.rpgsave

```text
base64 text -> zlib inflate -> MessagePack -> JSON
```

No AES/HMAC v2 shell.

### global.rpgsave and file*.rpgsave

Binary payload after base64 decode:

```text
4 bytes   magic: 93 c1 4a 2e
1 byte    version: 02
16 bytes  iv
4 bytes   ciphertext length, little-endian
N bytes   ciphertext
32 bytes  HMAC-SHA256
```

Seed:

```js
savefileId === 0
  ? "dq2|sv2|tk_expand|RPGMV|MV|global|0"
  : `dq2|sv2|tk_expand|RPGMV|MV|save|${savefileId}`;
```

Derive:

```js
base = sha256(seed).hex;
encKey = sha256(`${base}|enc|`);
macKey = sha256(`${base}|mac|`);
```

HMAC covers:

```text
magic || version || iv || ciphertextLength || ciphertext
```

It does not include the MAC itself.

Encrypt:

```text
JSON -> MessagePack encode -> zlib deflate -> AES-256-CBC(encKey, random iv)
  -> header + ciphertext -> HMAC-SHA256(macKey, header + ciphertext) -> base64
```

Always verify generated saves by decrypting and comparing JSON.

## 5. IconSet Decoding

Source:

```text
www/img/system/IconSet.png
```

Decode rule used by the GUI:

1. Preserve the first 100 bytes.
2. For bytes after offset 100, reverse the game's shuffle.
3. XOR each body byte:

```js
body[i] ^= (i % 256) ^ 90;
```

RPG Maker MV icon layout:

```text
icon width  = 32
icon height = 32
icons/row   = 16
x = (iconIndex % 16) * 32
y = Math.floor(iconIndex / 16) * 32
```

If icon decoding fails, keep the list functional and show empty icon boxes; do not block item/skill features.

## 6. Bridge State Files

Directory:

```text
dq2_modkit/runtime/bridge-state
```

Files:

```text
commands.jsonl   GUI/CLI appends commands
events.jsonl     bridge appends command results
state.json       bridge heartbeat and live game summary
bridge.log       bridge diagnostics
launcher.log     launcher diagnostics
```

Command record:

```json
{
  "type": "gold.add",
  "amount": 10000,
  "commandId": "timestamp-random",
  "ts": 1770000000000
}
```

Event record:

```json
{
  "ok": true,
  "type": "gold.add",
  "commandId": "timestamp-random",
  "result": { "gold": 12345 },
  "ts": 1770000000000
}
```

State should include:

```text
bridgeVersion
url
title
saveDir
saveFiles
hasParty
hasTk
gold
map
party
options
rateStats
battleStats
lastError
```

## 7. Command Contracts

Required command types:

```text
ping
status
gold.add { amount }
gold.set { amount }
item.add { kind, id, amount }
actor.unlock { actorId }
actor.remove { actorId }
actor.recover { actorId }
actor.level.set { actorId, level }
actor.exp.add { actorId, amount }
actor.param.add { actorId, paramId, value }
actor.skill.learn { actorId, skillId }
actor.skill.forget { actorId, skillId }
variable.set { id, value }
switch.set { id, value }
party.recover
map.current
map.transfer { mapId, x, y, direction, fade }
commonEvent.run { id }
progress.enemyBook.unlock
save { savefileId }
title.refresh
trainer.options.set { expRate, goldRate, dropRate, skillRate, noSkillCost }
trainer.hooks.info
```

CLI aliases may accept positional forms, for example:

```powershell
node .\trainer-send.mjs item.add item 5 10
node .\trainer-send.mjs actor.skill.learn 1 10
node .\trainer-send.mjs trainer.options.set expRate=10 noSkillCost=true
```

Validate numeric fields with clear errors. The bridge should return `FAIL` events rather than throwing out of the polling loop.

## 8. Hook Targets

Use method wrappers that preserve originals and avoid double patching.

Resolve TK aliases as well as standard globals:

```js
callAlias("gameParty") || window.$gameParty;
tkValue("BattleMrg") || window.BattleManager;
tkValue("DataMrg") || window.DataManager;
tkValue("StorageMrg") || window.StorageManager;
```

Reward hooks:

```text
BattleManager.makeRewards
BattleManager.gainRewards
BattleManager.gainExp
BattleManager.gainGold
Game_Actor.prototype.gainExp
Game_Party.prototype.gainGold
```

Drop hooks:

```text
Game_Enemy.prototype.dropItemRate
Game_Enemy.prototype.makeDropItems
```

No-cost hooks:

```text
Game_BattlerBase.prototype.canPaySkillCost
Game_BattlerBase.prototype.paySkillCost
Game_BattlerBase.prototype.skillMpCost
Game_BattlerBase.prototype.skillTpCost
Game_Actor.prototype.paySkillCost
Game_Actor.prototype.skillMpCost
Game_Actor.prototype.skillTpCost
Game_Battler.prototype.setMp
Game_Battler.prototype.setTp
Game_BattlerBase.prototype.setMp
Game_BattlerBase.prototype.setTp
Game_Actor.prototype.setMp
Game_Actor.prototype.setTp
```

Skill mastery:

```text
Observe _skillExp and _skillMasteryExp.
Keep per-actor per-skill baselines.
When current > baseline, write baseline + (current - baseline) * skillRate.
```

## 9. Game Root Config Contract

Commit only the example:

```json
{
  "gameRoot": "D:\\SteamLibrary\\steamapps\\common\\大千世界2 The Stupendous World Demo"
}
```

Each user may copy it to `config.local.json`. The local file is ignored by Git. All scripts that need original game files should resolve the game root in this order:

```text
-GameRoot parameter
DQ2_GAME_ROOT environment variable
config.local.json gameRoot
parent directory of dq2_modkit
```

The selected directory is valid only when it contains `www/index.html`.

PowerShell `-GameRoot` relative paths are relative to the caller's current location. Config/env relative paths are relative to `dq2_modkit`.

## 10. Validation Commands

Prerequisites:

```powershell
node --version
npm.cmd --version
```

If PowerShell blocks scripts, prefix `.ps1` checks with `powershell -NoProfile -ExecutionPolicy Bypass -File`.

Npm registry contract:

```text
Default first: https://mirrors.tuna.tsinghua.edu.cn/npm/
Default fallback: https://registry.npmmirror.com
Override parameter: -NpmRegistry
Override environment: DQ2_NPM_REGISTRY
```

Only `setup-runtime.ps1` installs dependencies directly. Scripts that may auto-run setup should pass through `-NpmRegistry`.

Syntax:

```powershell
cd "<dq2_modkit>"
node --check .\tools\modkit-config.mjs
node --check .\tools\extract-bytecode-bundles.mjs
node --check .\tools\extract-data-pak.mjs
node --check .\tools\extract-usedata.mjs
node --check .\tools\encrypt-saves.mjs
node --check .\tools\trainer-send.mjs
node --check .\runtime\bridge\page-bridge.js
node --check .\app\gui\app.js
```

Runtime generation:

```powershell
.\tools\setup-runtime.ps1
.\tools\setup-runtime.ps1 -Force
.\tools\clean-runtime.ps1 -DryRun
```

Extraction and save round trip:

```powershell
.\tools\extract-all.ps1
.\tools\encrypt-saves.ps1
```

CLI bridge checks after launching the bridge game:

```powershell
node .\tools\trainer-send.mjs status
node .\tools\trainer-send.mjs ping
node .\tools\trainer-send.mjs trainer.hooks.info
```
