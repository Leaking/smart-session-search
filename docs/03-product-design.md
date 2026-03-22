# Step 3 — 产品方案设计

## 一、产品形态

两种形态并存：

| 形态 | 触发方式 | 场景 | 能力 |
|------|----------|------|------|
| **独立 TUI** | 终端运行 `cfs` | 日常搜索 session | 全功能：Preview Pane、上下文切换、自动 resume |
| **Claude Code Command** | 在 Claude Code 内 `/cfs keyword` | Claude 对话中搜索 | 非交互模式，打印搜索结果（Bash 无 TTY） |

命令名：`cfs`（claude-fuzzy-search 缩写）

## 二、TUI 布局

```
┌─ claude-fuzzy-search ─────────── [当前项目] Tab 切换 [全局] ────┐
│ > 搜索关键字                                                     │
│─────────────────────────────┬────────────────────────────────────│
│ ❯ Session 标题 A     2h ago│  👤 帮我改一下登录页面的 bug        │
│   Session 标题 B     1d ago│  🤖 好的，我来看看代码...           │
│   Session 标题 C     3d ago│  👤 还有一个问题...                 │
│   Session 标题 D     5d ago│                                     │
│                             │                                     │
│                             │                                     │
├─────────────────────────────┴────────────────────────────────────┤
│ 4/120 sessions │ Enter: resume │ Tab: 切换范围 │ Esc: 退出      │
└─────────────────────────────────────────────────────────────────┘
```

### 布局要素
- **顶部**：搜索输入框 + 当前过滤范围标识
- **左栏**：Session 列表（标题 + 时间 + 项目名）
- **右栏**：Preview Pane — 选中 session 的前几条对话消息
- **底部**：状态栏（结果计数 + 快捷键提示）

### 交互操作
| 操作 | 快捷键 |
|------|--------|
| 输入搜索词 | 直接输入，实时模糊搜索 |
| 上下移动 | ↑ ↓ 箭头 |
| 选中并 resume | Enter |
| 切换「当前项目」/「全局」 | Tab |
| 退出 | Esc / Ctrl+C |
| 删除搜索词 | Backspace |

### Preview Pane 内容
- 显示选中 session 的前 N 条对话（user + assistant 交替）
- 用 👤 / 🤖 区分 user / assistant
- 消息过长时截断，显示前 200 字符
- 光标移动时实时更新

## 三、CLI 参数

```
cfs                    # TUI 模式，搜当前项目的 session
cfs -g                 # TUI 模式，全局搜索所有项目
cfs keyword            # TUI 模式，预填搜索词
cfs -g keyword         # TUI 模式，全局 + 预填搜索词
cfs --assistant        # 同时搜索 assistant 回复内容（默认只搜 user）
```

### 参数说明
| 参数 | 缩写 | 说明 |
|------|------|------|
| `--global` | `-g` | 搜索所有项目的 session（默认只搜当前项目） |
| `--assistant` | `-a` | 同时搜索 assistant 回复内容 |
| `keyword` | — | 位置参数，预填搜索词 |

### 默认行为
- 默认只搜 user 消息（数据源：`history.jsonl`，毫秒级）
- `--assistant` 时额外解析 session `.jsonl` 文件 + subagent 文件

## 四、搜索策略

### 数据源分层

| 模式 | 数据源 | 速度 | 搜索内容 |
|------|--------|------|----------|
| **默认（user only）** | `~/.claude/history.jsonl` | 极快（单文件） | session 标题 + 用户消息 |
| **--assistant** | `history.jsonl` + `<sessionId>.jsonl` + `subagents/agent-*.jsonl` | 较慢（需遍历文件） | user + assistant text block（排除 thinking） |

### Subagent 处理
- Subagent 路径：`<项目>/<父sessionId>/subagents/agent-*.jsonl`
- 搜到 subagent 内容时，**归属到父 session**
- Resume 时恢复的是父 session

### 消息过滤
- 单条消息超过 2000 字符跳过
- Assistant 消息只索引 `type: "text"` block，跳过 `type: "thinking"`

### 模糊搜索配置
- 引擎：Fuse.js
- 权重：title (2x) > messages (1x) > project (0.5x)
- 阈值：0.4
- 忽略位置（`ignoreLocation: true`）

## 五、Resume 行为

### 自动 Resume
1. 用户按 Enter 选中 session
2. 工具获取 session 对应的 project 路径
3. 使用 execvp 替换当前进程：先 cd 到 project 目录，再执行 `claude --resume <sessionId>`
4. 用户直接进入恢复的 Claude Code 对话

### 跨项目 Resume
- 全局搜索时，选中的 session 可能属于其他项目
- execvp 时自动 cd 到该 session 的 project 目录
- 用户无需手动切换目录

### Fallback
- 如果 execvp 方案不可行，退回 `spawn({ stdio: 'inherit' })`
- 最差情况：打印 `cd <project> && claude --resume <id>` 让用户复制

## 六、Claude Code Command 集成

### `/cfs [keyword]`
- 定义在 `~/.claude/commands/cfs.md`
- 在 Claude Code Bash 中以非交互模式运行
- 输出搜索结果文本（标题、项目、匹配内容、resume 命令）
- 无 TUI（Claude Code Bash 无 TTY 支持）

## 七、分发方式

- **Homebrew**：`brew install <tap>/cfs`
- 包含 `cfs` 全局命令
- Node.js + Fuse.js，无编译依赖
