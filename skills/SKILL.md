---
name: dq2-modkit-builder
description: Build or recreate the dq2_modkit local toolkit for a single-player NW.js/RPG Maker MV game, including runtime bridge injection without editing package.json/index.html/guard.js, save/data/useData decrypt and encrypt scripts, GUI trainer, runtime setup/clean scripts, and documentation. Use when the user asks to replicate, rebuild, port, implement from scratch, package as a project, or troubleshoot this DQ2 modkit workflow.
---

# DQ2 Modkit Builder

Use this skill to recreate the local `dq2_modkit` project for the DQ2 demo or to port the same pattern to another local single-player NW.js/RPG Maker MV title.

Keep the scope local and single-player. Do not use this workflow for online games, protected multiplayer clients, anti-cheat bypass, or stealthy persistence.

## Quick Start

When the target is the same DQ2 demo, prefer the bundled clean template:

```powershell
& ".\dq2_modkit\skills\scripts\scaffold-dq2-modkit.ps1" `
  -GameRoot "<game-root>" `
  -RunSetup
```

If Windows blocks `.ps1` execution, run the same script through PowerShell's per-command bypass:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\dq2_modkit\skills\scripts\scaffold-dq2-modkit.ps1" -GameRoot "." -RunSetup
```

The template is in `assets/dq2_modkit_template`. It intentionally excludes generated runtime files, `node_modules`, extracted data, saves, and `.jsc` bytecode. `setup-runtime.ps1` regenerates those from the current game install.

The generated project supports per-user game-root configuration. If `dq2_modkit` is not directly under the game root, copy `config.example.json` to `config.local.json` and set `gameRoot`, or pass `-GameRoot` to PowerShell launch/setup/extract scripts. `config.local.json` must stay ignored and uncommitted.

This project stores the skill inside `dq2_modkit/skills` so it travels with the modkit. If installing it into Codex's global skill directory for automatic discovery, place this same folder as `dq2-modkit-builder`.

When building from scratch or adapting to a changed game, read:

- `references/rebuild-playbook.md` for the end-to-end workflow and implementation order.
- `references/formats-and-contracts.md` for file formats, encryption details, command contracts, and validation commands.

## Workflow

1. Confirm the target is a local NW.js/RPG Maker MV game and identify protected files. For this project, never modify original `package.json`, `www/index.html`, or `www/guard.js`.
2. Confirm command-line Node.js/npm are installed. Use Node.js 18+ at minimum; install the current LTS for new setups. The game's `node.dll` is not enough for tool scripts. On Windows, prefer `npm.cmd` for checks if `npm.ps1` is blocked by execution policy.
3. Choose the runtime bridge strategy: create an independent NW launcher, open the original `www/index.html`, and inject `runtime/bridge/page-bridge.js` with `inject_js_start`.
4. Scaffold `dq2_modkit` with `tools`, `app/gui`, `runtime/trainer`, `runtime/bridge`, `runtime/save-harness`, `runtime/bridge-state`, `output`, `docs`, and `config.example.json`.
5. Implement shared game-root resolution before runtime generation. Resolve `-GameRoot`, `DQ2_GAME_ROOT`, `config.local.json`, then the legacy parent-directory layout.
6. Implement runtime generation before features. `setup-runtime.ps1` must create hardlinks/junctions from the resolved game install and fall back to copying runtime files if hardlinks fail; npm dependency installation must use an explicit mirror registry, defaulting to the Tsinghua npm URL with `npmmirror` fallback and supporting `-NpmRegistry`/`DQ2_NPM_REGISTRY`.
7. Implement `clean-runtime.ps1` so it safely removes only generated artifacts.
8. Implement extractors next: `data.pak`, `useData`, and saves. Use structured parsers and cryptographic verification; do not rely on ad hoc text parsing.
9. Implement the runtime bridge command loop over local JSONL files, then expose commands through `trainer-send.mjs`.
10. Build the external GUI last. It should read exported data for searchable lists and communicate only through the bridge-state command queue.
11. Validate each layer independently: setup/clean, JS syntax, data extraction, save round-trip encryption, bridge status, GUI smoke.
12. Update usage and technical docs so the project remains reproducible after game updates and portable across user install paths.

## Implementation Rules

- Keep original game files unchanged. The modkit normally lives beside the game in `dq2_modkit`, but the game root must also be configurable for users who keep the project elsewhere.
- Treat NW runtime binaries, locales, dictionaries, `.jsc` bytecode, extracted JSON, and `node_modules` as generated artifacts.
- Prefer calling game runtime functions over writing object internals when possible: `$gameParty.gainItem`, `$gameActors.actor(id).learnSkill`, `DataManager.saveGame`, `$gameVariables.setValue`.
- Resolve both standard RPG Maker globals and TK aliases. Many failures come from patching only `$gameParty`/`BattleManager` while the game uses `TK.$.*` aliases.
- Make every command return structured success/failure events with enough error text for GUI and CLI debugging.
- Use virtualized lists in the GUI for items, skills, variables, switches, maps, and events.
- Add a validation step after every major layer. Do not stop after writing files.

## Resources

- `scripts/scaffold-dq2-modkit.ps1`: copy the clean template into a game root and optionally run setup.
- `assets/dq2_modkit_template`: source template for the current working project, without generated artifacts.
- `references/rebuild-playbook.md`: full rebuild plan and project architecture.
- `references/formats-and-contracts.md`: encryption formats, bridge commands, hooks, and checks.
