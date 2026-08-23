# mdular · v1

> **致谢**  
> **本项目**起源于 **[files.md](https://github.com/zakirullin/files.md)**（作者 [Artem Zakirullin](https://github.com/zakirullin)）之上的二次封装与扩展，并非从零重写。侧边栏浏览、Markdown 编辑/阅读等核心体验与交互思路，均来自原作者的出色工作；在此向原作者致以诚挚谢意。

当前可运行的 v1 是一个本地 Markdown 工具箱：**浏览/编辑 + Chat（Core）** + 可选插件（Docs 归档、工单看板）；Git/SVN 外挂。

`src/` → `npm run build` → `web/` · 本地 HTTP · 无云同步

---

## v1 有什么

| 能力 | 说明 |
|------|------|
| **Core** | 侧边栏、编辑/阅读、搜索、Chat、未保存 dirty 提示、VCS 面板 |
| **插件 `docs`** | Chat → **To Docs**（写入 `docs/`） |
| **插件 `kanban`** | Chat → **To Issues**；工具栏打开看板（**Ctrl+Shift+B**） |
| **桌面** | `start-tauri.bat` 开发 · GitHub Actions 构建 Windows/macOS/Linux 安装包 · `start.bat` 浏览器 |

Tauri：**开发**用 `start-tauri.bat`（`-Folder` 自动绑工作区）；`Build Desktop` workflow 统一生成 Windows NSIS、macOS DMG 与 Linux AppImage。手动触发时产出短期 candidate artifacts，版本 tag 触发时才汇总到 Draft Release。

Chat 操作栏的 **To Docs / To Issues** 由插件注册；看板全屏 UI 需工具栏或快捷键单独打开。

---

## 快速开始

**Tauri 桌面开发：** `start-tauri.bat` · **安装包：** GitHub Releases

**浏览器 / LAN：** Chrome/Edge · Python 3（`start.bat` 用本地 HTTP）

```bat
start-tauri.bat              REM 开发调试
start.bat
```

默认打开 <http://localhost:8765>，并绑定**本仓库目录**为工作区。勿用 `file://`。

工作区根目录 `.mdular/config.json`：

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
npm run check
npm run sync:app-metadata  # 将 app.manifest.json 同步到各宿主 manifest
```

根 `app.manifest.json` 是应用名称、版本、identifier、描述、作者与仓库地址的唯一来源。
`package.json` 只负责依赖、workspace 和脚本。CI 会运行 `check:app-metadata`，阻止 Tauri、Cargo 和
PWA manifest 中的派生值发生漂移。

从 Actions 手动运行 `Build Desktop` 会先执行完整检查，再并行构建四个平台并上传保留 7 天的
candidate artifacts，不会创建 Release。推送与 `app.manifest.json` 版本一致的标签（例如 `v1.2.3`）后，
同一 workflow 才创建 Draft Release；标签与 manifest 版本不一致时，发布门禁会在构建前失败。
macOS CI 产物使用 ad-hoc 临时签名，但未经过 Apple notarization。

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
└── workspace/config.ts
web/          # 构建产物 + 静态资源
src-tauri/    # Tauri 桌面壳（Rust）
launch.ps1 · start.bat · start-tauri.bat
```

---

## 来源与许可

本仓库现已脱离 GitHub fork network，作为独立项目继续演进。项目采用 MIT License；
[LICENSE](LICENSE) 同时保留上游作者 Artem Zakirullin 与本项目修改者的版权声明。
