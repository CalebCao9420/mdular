# mdular · v1

> **致谢**  
> **mdular** 起源于 **[files.md](https://github.com/zakirullin/files.md)**（作者 [Artem Zakirullin](https://github.com/zakirullin)）之上的二次封装与扩展，并非从零重写。侧边栏浏览、Markdown 编辑/阅读等核心体验与交互思路，均来自原作者的出色工作；在此向原作者致以诚挚谢意。若无 [files.md](https://github.com/zakirullin/files.md)，便不会有 mdular。

mdular 当前可运行的 v1 是一个本地 Markdown 工具箱：**浏览/编辑 + Chat（Core）** + 可选插件（Docs 归档、工单看板）；Git/SVN 外挂。

`src/` → `npm run build` → `web/` · 本地 HTTP · 无云同步

---

## v1 有什么

| 能力 | 说明 |
|------|------|
| **Core** | 侧边栏、编辑/阅读、搜索、Chat、未保存 dirty 提示、VCS 面板 |
| **插件 `docs`** | Chat → **To Docs**（写入 `docs/`） |
| **插件 `kanban`** | Chat → **To Issues**；工具栏打开看板（**Ctrl+Shift+B**） |
| **桌面** | `start-tauri.bat` 开发 · `build-tauri-installer.bat` 打 **Windows 安装包** · `start.bat` 浏览器 |

Tauri：**开发**用 `start-tauri.bat`（`-Folder` 自动绑工作区）；**分发**用 `build-tauri-installer.bat` 产出 `*-setup.exe`。编辑区 viewport/滚动见 7b-1；改 UI 后须重新打安装包。

Chat 操作栏的 **To Docs / To Issues** 由插件注册；看板全屏 UI 需工具栏或快捷键单独打开。

---

## 快速开始

**Tauri 桌面（推荐）：** `start-tauri.bat` · **安装包** `build-tauri-installer.bat`

**浏览器 / LAN：** Chrome/Edge · Python 3（`start.bat` 用本地 HTTP）

```bat
start-tauri.bat              REM 开发调试
build-tauri-installer.bat    REM 打 Windows 安装包（首次较慢）
start.bat
```

默认打开 <http://localhost:8765>，并绑定**本仓库目录**为工作区。勿用 `file://`。

工作区根目录 `.mdtk/config.json`：

```json
{
  "plugins": ["docs", "kanban"],
  "workspacePath": "D:\\your\\notes"
}
```

- `plugins`：插件**文件夹名**（对应 `web/plugins/<id>/`）
- `start.bat` / `launch.ps1` 从**磁盘**读此文件，写入 `web/.launcher-hint.json`；浏览器按此加载插件

其它启动方式：

```powershell
.\launch.ps1 -Folder "D:\your\notes"
.\launch.ps1 -Tauri -Folder "D:\your\notes"
```

首次在纯浏览器模式下可能需 **Open folder** 并勾选 Allow on every visit。

---

## 开发

```powershell
npm install
npm run build      # src/ → web/，勿手改 Generated 文件
npm run watch
npm run typecheck
npm run setup:tauri-nsis   # 仅 Windows 打安装包前需要（或 build-tauri-installer.bat 自动跑）
npm run tauri:build        # Release exe + NSIS（需 Rust + NSIS 已就绪）
```

---

## 结构（简）

```
src/
├── app/ · chat/ · editor/ · files/     # Core
├── plugins/
│   ├── api.ts                          # initPlugins
│   ├── chat-archive.ts                 # Chat 归档注册表
│   ├── docs/                           # To Docs
│   └── kanban/                         # 看板 + To Issues
├── desktop/shell.ts                    # launcher hint · Tauri
└── mdtk/workspace-config.ts
web/          # 构建产物 + 静态资源
src-tauri/    # Tauri 桌面壳（Rust）
launch.ps1 · start.bat · start-tauri.bat · build-tauri-installer.bat
```

---

## 来源与许可

mdular 现已脱离 GitHub fork network，作为独立项目继续演进。项目采用 MIT License；
[LICENSE](LICENSE) 同时保留上游作者 Artem Zakirullin 与 mdular 修改者的版权声明。
