# Agent Status

Windows 桌面监控面板，实时查看 **Cursor Agent** 与 **Claude Code CLI** 会话状态。双列布局、一键打开/恢复、自定义 Claude 会话名称、窗口置顶。

[English](#english) · [中文](#中文)

---

## 中文

### 功能

- **双列视图**：左列 Claude Code，中列 Cursor
- **状态灯**（参考 [Herdr](https://herdr.dev/docs/agents/) 语义）：
  - 🔴 需处理 — Agent 在等你回复/确认
  - ⛔ 异常 — 终端报错
  - 🟡 运行中 — Agent 正在执行
  - 🟢 空闲 — 暂无近期活动
- **会话操作**：查看对话、打开/恢复、隐藏、Claude 自定义命名
- **窗口**：最小化 / 最大化 / 关闭到托盘 / 置顶
- **性能**：文件监听 + 缓存，空闲时降低扫描频率

### 系统要求

- Windows 10/11 x64
- 已安装 [Cursor](https://cursor.com) 和/或 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

### 下载

在 [GitHub Releases](https://github.com/guochao99/agent-status/releases) 下载：

| 文件 | 说明 |
|------|------|
| `Agent Status-x.x.x-Portable.exe` | 绿色版，推荐 |
| `Agent Status-x.x.x-win-x64.exe` | 安装版 |

### 从源码运行

```powershell
git clone https://github.com/guochao99/agent-status.git
cd agent-status
npm install
npm run electron:dev
```

### 打包

国内网络建议设置 Electron 镜像：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm run pack:clean
```

产物在 `release/` 目录。

### 项目结构

```
agent-status/
├── electron/          # 主进程：窗口、托盘、IPC、文件监听
├── packages/core/     # 扫描 transcript、状态推断（无 Electron 依赖）
├── src/               # React UI
├── scripts/           # 打包前清理脚本
└── release/           # 构建产物（不提交 git）
```

### 数据与隐私

- 仅读取本机 `~/.cursor/projects` 与 `~/.claude/projects` 下的 transcript 文件
- 自定义名称、隐藏列表保存在 `%APPDATA%/agent-status/`
- 不上传任何数据

### 限制

- Cursor 无公开 API 跳转到具体 Chat，只能聚焦窗口或 `cursor -r` 打开工作区
- 工作区路径从 terminal `cwd` 或项目 key 推断，特殊目录结构可能需手动打开

### 致谢

状态模型与优先级参考了开源项目 [Herdr](https://github.com/ogulcancelik/herdr)。

### License

[MIT](LICENSE)

---

## English

**Agent Status** is a Windows desktop panel that monitors **Cursor Agent** and **Claude Code CLI** sessions side by side, with Herdr-inspired status semantics, session actions, and always-on-top support.

### Quick start

```bash
git clone https://github.com/guochao99/agent-status.git
cd agent-status
npm install
npm run electron:dev
```

### Build (Windows)

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm run pack:clean
```

See [Releases](https://github.com/guochao99/agent-status/releases) for pre-built binaries.

MIT License — see [LICENSE](LICENSE).
