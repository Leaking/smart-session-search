# Step 2 — 竞品调研

## 一、Claude Code Session 搜索工具

### Tier 1：主流工具（100+ stars）

#### 1. cass（coding-agent-search）⭐ 615
- **GitHub**: https://github.com/Dicklesworthstone/coding_agent_session_search
- **语言**: Rust | **安装**: `brew install dicklesworthstone/tap/cass`
- **定位**: 统一的多 Agent session 搜索（支持 Claude Code、Codex、Gemini CLI、Cline、Cursor、Aider 等 11+ 个）
- **特点**: ratatui TUI、全文搜索、`--robot`/`--json` 编程模式、MCP agent-mail 集成
- **启发**: 多 Agent 支持是趋势，但增加了复杂度；我们专注 Claude Code 做深做透

#### 2. Agent Sessions ⭐ 393
- **GitHub**: https://github.com/jazzyalex/agent-sessions
- **语言**: Swift | **平台**: macOS 桌面应用
- **定位**: macOS 原生 GUI 浏览/搜索/恢复多 Agent session
- **特点**: Agent Cockpit 实时监控、图片浏览、使用量追踪、右键 "Copy Resume Command"
- **启发**: GUI 方案，与我们 CLI/TUI 路线不同；"Copy Resume Command" 交互值得参考

#### 3. claude-historian-mcp ⭐ 217
- **GitHub**: https://github.com/Vvkmnn/claude-historian-mcp
- **语言**: TypeScript | **安装**: `claude mcp add claude-historian-mcp -- npx claude-historian-mcp`
- **定位**: MCP 服务器，让 Claude Code 自己搜索自己的历史对话
- **特点**: 倒排索引、MCP 原生、零配置
- **启发**: MCP 集成让 Claude 在对话中直接搜历史，是一个我们可以考虑的补充方向

### Tier 2：中小工具（10-50 stars）

| 工具 | Stars | 语言 | 特点 |
|------|-------|------|------|
| claude-code-vector-memory | 31 | Python | 向量语义搜索 |
| cc-conversation-search | 17 | Python | 语义搜索，返回 session ID + project path |
| search-sessions | 16 | Rust | 快速 CLI，扫 JSONL |
| claude-session-index | 14 | Python | SQLite FTS5 全文搜索 + 分析 |

### Tier 3：新兴工具（<15 stars）

- universal-session-viewer (12) — Electron 桌面应用
- claude-sesh (9) — Session 浏览器
- smart-fork (8) — MCP + 语义搜索 + session 分叉
- claude-history (2) — Raycast 扩展
- claude-history-viewer (1) — 跨项目浏览器

---

## 二、TUI 搜索工具（UX 参考）

### fzf — 标杆级模糊搜索
- **核心体验**: 底部输入框，结果实时流式更新，零延迟
- **Preview Pane**: `--preview` 显示选中项的详情，随光标移动实时更新（杀手级功能）
- **大数据**: 流式处理，Go 异步架构，百万行无卡顿
- **集成**: Unix pipe 模型，`cmd | fzf`，极致可组合性
- **关键启发**: **Preview Pane 必须有**，实时显示 session 的前几条消息

### Atuin — Shell 历史搜索
- **Context Filter**: session → directory → host → global，逐级放大搜索范围
- **元数据**: 每条记录存储 cwd、hostname、exit code、duration
- **Frecency**: 结合频率和时间的排序，比纯时间排序更智能
- **关键启发**: **按项目/全局的上下文切换** 正好对应我们的需求（默认当前项目，`-g` 全局）

### Telescope.nvim — Neovim 模糊搜索
- **三栏布局**: 输入 + 结果列表 + 预览
- **统一交互**: 所有搜索共享相同的操作模型
- **Action 系统**: Enter 打开、Tab 多选、Ctrl-Q 发到 quickfix
- **关键启发**: **一致的操作模型**，Enter resume、可能的扩展操作

### skim (sk) — Rust 版 fzf
- **`--interactive` 模式**: 每次击键重新查询数据源（不是过滤缓存）
- **关键启发**: 搜索 assistant 内容时可以考虑类似的按需查询模式

---

## 三、竞品对比总结

| 维度 | cass | agent-sessions | historian-mcp | **我们 (claude-fuzzy-search)** |
|------|------|----------------|---------------|-------------------------------|
| 形态 | CLI/TUI | macOS GUI | MCP Server | CLI/TUI |
| 多 Agent | ✅ 11+ | ✅ 6+ | ❌ Claude only | ❌ Claude only |
| 搜索方式 | 全文 | 全文 | 倒排索引 | **模糊搜索 (Fuse.js)** |
| 搜 user | ✅ | ✅ | ✅ | ✅ |
| 搜 assistant | ✅ | ✅ | ✅ | ✅ (可选) |
| 全局跨项目 | ✅ | ✅ | ✅ | **✅ (-g 选项)** |
| 自动 resume | ❌ 需复制 | ❌ 需复制 | N/A | **✅ execvp 直接恢复** |
| 自动切目录 | ❌ | ❌ | N/A | **✅ 自动 cd 到项目目录** |
| Preview | ? | ✅ GUI | N/A | **✅ TUI preview** |
| 安装 | brew | DMG | npx | **brew** |
| 依赖 | Rust 编译 | macOS only | Node.js | **Node.js (轻量)** |

---

## 四、我们的差异化优势

1. **自动 resume** — 选中直接恢复，不需要复制粘贴命令（竞品都没做到）
2. **自动切目录 resume** — 跨项目选中也能直接恢复（解决 claude 原生限制）
3. **全局搜索** — `-g` 跨所有项目搜索（原生 `/resume` 做不到）
4. **轻量级** — Node.js + Fuse.js，无需 Rust 编译或 macOS 独占
5. **Homebrew 一键安装** — 开箱即用
6. **快速默认路径** — 只搜 user 时直接读 history.jsonl，毫秒级响应

## 五、值得借鉴的 UX 模式

| 模式 | 来源 | 优先级 | 说明 |
|------|------|--------|------|
| Preview Pane | fzf, Telescope | **高** | 选中 session 时显示前几条消息 |
| 上下文过滤 | Atuin | **高** | 默认当前项目，`-g` 全局 |
| 实时模糊搜索 | fzf | **高** | 输入即搜，无需按回车 |
| Frecency 排序 | Zoxide, Atuin | 中 | 结合使用频率和时间排序 |
| 高亮匹配 | fzf | **高** | 搜索关键字在结果中高亮 |
| 最小化 UI | fzf | **高** | 快速启动、快速退出 |
