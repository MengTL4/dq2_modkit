# DQ2 Modkit

这是《大千世界2 The Stupendous World Demo》的本地工具项目目录，集中放置运行时修改器、离线存档树形编辑器、数据解密脚本、运行时 bridge 和文档。

## 快速入口

首次使用前先确认本机有命令行版 Node.js/npm：

```powershell
node --version
npm.cmd --version
```

脚本最低要求 Node.js 18+；新装建议直接安装当前 LTS 版。任选一种：

```powershell
winget install -e --id OpenJS.NodeJS.LTS
```

也可以去 [Node.js 官网](https://nodejs.org/zh-cn/download) 下载 Windows LTS 安装包。安装后重新打开 PowerShell，让 `node` 和 `npm.cmd` 进入 PATH。

如果 Windows 提示“无法加载 .ps1，因为在此系统上禁止运行脚本”，任选一种处理：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

或者进入项目目录后，不修改执行策略，单次绕过执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\tools\launch-gui.ps1"
```

先进入项目目录。最推荐把 `dq2_modkit` 放在游戏根目录下，也就是和 `Game.exe`、`www` 同级；这种布局不需要配置游戏路径，直接启动即可：

```powershell
cd "<你的 dq2_modkit 目录>"
.\tools\launch-gui.ps1
```

只有当 `dq2_modkit` 不在游戏根目录下时，才需要复制本地配置并把 `gameRoot` 改成自己的游戏根目录：

```powershell
Copy-Item .\config.example.json .\config.local.json
notepad .\config.local.json
```

`gameRoot` 指向包含 `Game.exe` 和 `www\index.html` 的目录。`config.local.json` 已被 Git 忽略，每个用户可以写自己的路径。

常用脚本：

```text
tools/launch-gui.ps1          启动 GUI 修改器
tools/launch-save-editor.ps1  启动离线存档树形编辑器
tools/launch-runtime.ps1      只启动 bridge 版游戏
tools/setup-runtime.ps1       从配置的游戏目录生成/刷新 NW 运行时链接
tools/clean-runtime.ps1       清理生成的 NW 运行时链接、字节码和解包导出
tools/trainer-send.mjs        CLI 发送修改器命令
tools/extract-all.ps1         导出 data.pak、useData、存档
tools/extract-data-pak.mjs    导出 data.pak
tools/extract-usedata.mjs     导出 useData
tools/extract-saves.ps1       导出存档
tools/encrypt-saves.ps1       重新加密存档
```

文档：

```text
docs/工具使用说明.md
docs/技术实现文档.md
```

## 结构

```text
app/gui/                 GUI 修改器 NW 应用，app.ts 编译为 app.js
app/save-editor/         纯网页离线存档树形编辑器
runtime/trainer/         bridge 版游戏启动器
runtime/bridge/          注入游戏页面的 bridge 脚本
runtime/bridge-state/    命令队列、状态、日志
runtime/save-harness/    存档解密 NW harness
tools/                   CLI 和数据脚本
output/extract/          解密导出结果
output/repack/           重新加密输出
output/backup/           GUI 备份目录
docs/                    使用和技术文档
skills/                  复刻本项目用的 Codex skill
```

推荐把这个目录放在游戏根目录下，此时工具会自动用 `dq2_modkit` 的父目录作为游戏目录。也可以放在任意位置，只要通过 `-GameRoot` 或 `config.local.json` 指定游戏根目录即可；`DQ2_GAME_ROOT` 仍支持，但优先级低于项目父目录，避免旧环境变量把 GUI 带到别的游戏目录。

## 运行时生成

`app/gui`、`runtime/trainer`、`runtime/save-harness` 里的 NW 运行时文件不是项目源码，而是由脚本从配置的游戏根目录生成的硬链接/目录联接。`app/save-editor` 是纯网页工具，不需要 NW 运行时。游戏更新后执行：

```powershell
.\tools\setup-runtime.ps1 -Force
```

启动 GUI、启动 bridge、解密存档时，如果运行时文件缺失，也会自动调用 setup。

`setup-runtime.ps1` 还会安装工具脚本依赖，并从当前 `www/js/*.jsc.pak` 重新提取存档解密 harness 需要的字节码。也就是说游戏更新后刷新脚本即可，不需要手动把运行时文件搬进项目。

依赖安装默认使用 `https://registry.npmmirror.com`。如需指定其它 npm registry：

```powershell
.\tools\setup-runtime.ps1 -NpmRegistry "https://registry.npmmirror.com"
```

也可以设置环境变量：

```powershell
$env:DQ2_NPM_REGISTRY = "https://registry.npmmirror.com"
```

## GUI TypeScript

GUI 修改器的源码是 `app/gui/app.ts`，NW 实际加载的是编译后的 `app/gui/app.js`。开发时手动构建：

```powershell
cd .\app\gui
npm.cmd install --registry https://registry.npmmirror.com
npm.cmd run build
```

`tools/launch-gui.ps1` 会在发现 `app.ts` 比 `app.js` 新时自动执行同样的构建流程；启动前也会检查 `output/extract/data`，如果 `data.pak` 还没导出或游戏更新后数据过期，会自动运行 `extract-data-pak.mjs` 生成 GUI 列表数据，并生成 `_gui-cache.json` 加速地图/敌群列表加载。

GUI 中的物品、技能、角色、变量、开关、地图、事件等长列表默认按 `20` 条分页显示，并提供首页、上一页、下一页和末页按钮。脱机挂机地图列表会显示全部地图，没有随机遇敌表的地图会标记为“无遇敌”，这类地图需要改用敌群挂机。掉落默认走数据表模拟，结果会按装备自动卖出语境显示 `粗糙`、`普通`、`优秀`、`精良`、`史诗`、`传说`、`神器`、`传承`、`不朽` 等基础品质；勾选“原生掉落”后会继续按数据表逐次抽掉落，但入包时交给游戏原生逻辑生成独立装备。脱机挂机还提供“提高特殊词缀概率”“强制神妙”“强制天工开物”选项；`神妙` 会从 `useData` 的 `EQlearn` 词缀池抽取并写成装备授予的被动技能，`天工开物` 会写入装备特殊标记和说明。

需要清空这些生成产物时执行：

```powershell
.\tools\clean-runtime.ps1
```

默认会删除 NW 运行时链接、存档 harness 字节码和 `output/extract/data`、`output/extract/useData`、`output/extract/save` 解包导出；不会删除 `output/backup`、`output/repack` 或 `node_modules`。如果需要连工具依赖也一起清理：

```powershell
.\tools\clean-runtime.ps1 -IncludeDependencies
```

## 离线存档树形编辑器

这个模块不启动游戏、不走 NW 运行时，只在浏览器里处理本地 `.rpgsave` 文件：

```powershell
.\tools\launch-save-editor.ps1
```

打开页面后选择 `config.rpgsave`、`global.rpgsave` 或 `fileN.rpgsave`，编辑 JSON 树，再导出新的 `.rpgsave`。如果文件名不是标准的 `file1.rpgsave` 这种格式，手动填槽位 ID；`global` 是 `0`。

## 复刻 Skill

项目内置了一个用于从零复刻这套工具的 Codex skill：

```text
dq2_modkit/skills/
```

它包含 `SKILL.md`、复刻流程参考文档、干净模板和 scaffold 脚本。示例：

```powershell
& ".\dq2_modkit\skills\scripts\scaffold-dq2-modkit.ps1" `
  -GameRoot "<你的游戏根目录>" `
  -RunSetup
```

如果 `.ps1` 被执行策略拦截，使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\dq2_modkit\skills\scripts\scaffold-dq2-modkit.ps1" -GameRoot "." -RunSetup
```

当前随项目保存的位置是 `dq2_modkit/skills`。如果要安装到 Codex 的全局 skill 目录用于自动发现，目录名建议保持为 `dq2-modkit-builder`。
