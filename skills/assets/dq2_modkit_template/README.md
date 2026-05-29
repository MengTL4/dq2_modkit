# DQ2 Modkit

这是《大千世界2 The Stupendous World Demo》的本地工具项目目录，集中放置运行时修改器、离线存档工具、数据解密脚本、运行时 bridge 和文档。

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

也可以去 [Node.js 官网](https://nodejs.org/en/download/) 下载 Windows LTS 安装包。安装后重新打开 PowerShell，让 `node` 和 `npm.cmd` 进入 PATH。

如果 Windows 提示“无法加载 .ps1，因为在此系统上禁止运行脚本”，任选一种处理：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

或者不修改执行策略，单次绕过执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\dq2_modkit\tools\launch-gui.ps1"
```

正常启动：

```powershell
cd "f:\SteamLibrary\steamapps\common\大千世界2 The Stupendous World Demo\dq2_modkit\tools"
.\launch-gui.ps1
```

常用脚本：

```text
tools/launch-gui.ps1          启动 GUI 修改器
tools/launch-runtime.ps1      只启动 bridge 版游戏
tools/setup-runtime.ps1       从当前游戏目录生成/刷新 NW 运行时链接
tools/clean-runtime.ps1       清理生成的 NW 运行时链接和字节码
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
app/gui/                 GUI 修改器 NW 应用
runtime/trainer/         bridge 版游戏启动器
runtime/bridge/          注入游戏页面的 bridge 脚本
runtime/bridge-state/    命令队列、状态、日志
runtime/save-harness/    存档解密 NW harness
tools/                   CLI 和数据脚本
output/extract/          解密导出结果
output/repack/           重新加密输出
output/backup/           GUI 备份目录
docs/                    使用和技术文档
```

这个目录应保留在游戏根目录下。工具通过 `dq2_modkit` 的父目录定位原游戏文件。

## 运行时生成

`app/gui`、`runtime/trainer`、`runtime/save-harness` 里的 NW 运行时文件不是项目源码，而是由脚本从当前游戏根目录生成的硬链接/目录联接。游戏更新后执行：

```powershell
cd "dq2_modkit\tools"
.\setup-runtime.ps1 -Force
```

启动 GUI、启动 bridge、解密存档时，如果运行时文件缺失，也会自动调用 setup。

`setup-runtime.ps1` 还会安装工具脚本依赖，并从当前 `www/js/*.jsc.pak` 重新提取存档解密 harness 需要的字节码。也就是说游戏更新后刷新脚本即可，不需要手动把运行时文件搬进项目。

需要清空这些生成产物时执行：

```powershell
cd "dq2_modkit\tools"
.\clean-runtime.ps1
```

默认不会删除 `node_modules`。如果需要连工具依赖也一起清理：

```powershell
.\clean-runtime.ps1 -IncludeDependencies
```
