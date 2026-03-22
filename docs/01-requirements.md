# Step 1 — 需求澄清

## 核心需求

用户有大量 Claude Code session（120+），需要通过搜索对话中的关键字来找到目标 session 并 resume。

## 已明确

### 搜索范围
- Session 标题 + 用户消息 + assistant 回复内容
- Assistant 消息：只索引 `type: "text"` block，**跳过 `type: "thinking"`**
- 单条消息超过 2000 字符则跳过（避免系统提示等噪音）
- 提供参数让用户可选只搜 user 或只搜 assistant

### 数据源策略（性能优化）
- **默认只搜 user 消息**：仅读取 `~/.claude/history.jsonl` 即可，无需解析 session 文件，速度极快
- **搜索 assistant 回复时**：才逐个读取 `~/.claude/projects/<path>/<sessionId>.jsonl`，按需加载

### 搜索方式
- 模糊匹配（Fuse.js）

### 搜索后动作
- 选中后**自动 resume**（不只是打印 ID）
- 技术方案：优先使用 execvp 替换当前进程，不行再退回 spawn
- **关键发现**：`claude --resume` 必须在 session 对应的 project 目录下执行，否则报 "No conversation found"。工具需要先 cd 到对应目录再 resume。

### Session 存储结构
- 全局索引：`~/.claude/history.jsonl`（标题、project 路径、时间戳、sessionId）
- Session 内容：`~/.claude/projects/<编码路径>/<sessionId>.jsonl`
- 编码规则：`/Users/foo/bar` → `-Users-foo-bar`
- 项目目录是**平铺关系**，不是包含关系
- 新版 session 可能同时有 `.jsonl` 文件和同名目录（存放 subagents/tool-results）

### 搜索范围（项目维度）
- **默认搜索当前目录**相关的 session（与原生 `/resume` 行为一致）
- 提供 `--global` / `-g` 选项搜索**所有项目的 session**
- 全局搜索是**核心差异化亮点**：原生 `claude --resume` 只能搜当前目录的 session，我们支持跨项目搜索

### Resume 跨目录支持
- 使用 execvp 时，自动 cd 到 session 对应的 project 目录再 resume
- 用户无需手动切换目录，选中即可直接 resume 任何项目的 session
- 这解决了原生 `/resume` 无法跨项目恢复的限制

### TUI 交互能力
- **Preview Pane**: 左右分栏，右侧实时预览选中 session 的前几条对话
- **上下文过滤**: 快捷键切换「当前项目」和「全局」搜索范围
- **实时模糊搜索 + 高亮**: 输入即搜，匹配关键字在结果中高亮

### 目标用户
- 开源发布给社区使用

### 分发方式
- Homebrew

### 命名
- 项目名/命令名：`claude-fuzzy-search`
