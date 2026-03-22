# Step 4 — 技术方案设计

## 一、技术选型

| 维度 | 选择 | 理由 |
|------|------|------|
| 语言 | Node.js (ESM) | 轻量、用户普遍已安装 |
| TUI 渲染 | Raw ANSI escape codes | 零依赖、全控制、当前方案已验证可行 |
| 模糊搜索 | Fuse.js | 唯一运行时依赖，成熟稳定 |
| 进程替换 | `spawnSync` + `cwd` | Node.js 无原生 execvp，spawnSync 是最佳替代 |
| 分发 | Homebrew tap | 开箱即用，无编译依赖 |

### 为什么不用 TUI 库
- **ink**：24+ 依赖（React + Yoga），严重过度
- **blessed/neo-blessed**：已停止维护（2015/2018）
- **terminal-kit**：携带图像处理等无关依赖
- **Raw ANSI**：零额外依赖，当前代码已工作，加 Preview Pane 仅需 ~100 行

### 进程替换方案

优先方案：`spawnSync` + `cwd` 选项
```js
// TUI 退出后
process.stdin.setRawMode(false);  // 恢复终端
process.stdout.write('\x1b[?25h'); // 显示光标

const { status } = spawnSync('claude', ['--resume', sessionId], {
  stdio: 'inherit',
  cwd: projectDir  // 自动切到 session 对应的项目目录
});
process.exit(status ?? 0);
```

Fallback：打印命令让用户复制
```
cd /path/to/project && claude --resume <sessionId>
```

## 二、项目结构

```
claude-fuzzy-search/
├── bin/
│   └── cfs.js                # 入口文件（#!/usr/bin/env node）
├── lib/
│   ├── data.js               # 数据加载层
│   ├── search.js             # 搜索引擎（Fuse.js 封装）
│   ├── tui.js                # TUI 渲染 + 交互
│   ├── preview.js            # Preview Pane 数据加载
│   └── resume.js             # Resume 执行（spawnSync）
├── package.json
├── CLAUDE.md
├── README.md
├── LICENSE
└── docs/                     # 设计文档（不发布）
```

## 三、模块设计

### 3.1 `lib/data.js` — 数据加载层

**职责**：从文件系统读取 session 数据，构建搜索索引

```
输入：项目路径（可选）、是否包含 assistant
输出：Session[] 数组
```

**数据结构**：
```ts
interface Session {
  sessionId: string;
  title: string;           // 第一条 display 或首条 user 消息
  project: string;         // 原始项目路径
  timestamp: number;       // 最新时间戳
  messages: string[];      // 用于搜索的消息文本数组
}
```

**加载策略**：

| 场景 | 数据源 | 逻辑 |
|------|--------|------|
| 默认（user only） | `history.jsonl` | 按 sessionId 聚合，display 作为 messages |
| `--assistant` | `history.jsonl` + session `.jsonl` + `subagents/*.jsonl` | 额外解析 assistant text block |
| 当前项目 | 过滤 `project === cwd` 或前缀匹配 | history 中 project 字段过滤 |
| 全局 `-g` | 不过滤 | 返回所有 session |

**history.jsonl 聚合逻辑**：
- 同一个 sessionId 有多行记录（每条 user 消息一行）
- 聚合为一个 Session 对象：title 取第一条 display，messages 收集所有 display
- timestamp 取最新值
- 跳过 display 超过 2000 字符的记录

**Assistant 消息解析**：
- 读取 `~/.claude/projects/<编码路径>/<sessionId>.jsonl`
- 同时读取 `~/.claude/projects/<编码路径>/<sessionId>/subagents/agent-*.jsonl`
- 只取 `type: "assistant"` 消息中 `message.content` 数组里 `type: "text"` 的 block
- 跳过 `type: "thinking"` block
- 跳过超过 2000 字符的单条文本
- Subagent 内容归属到父 sessionId

**项目路径编码**：
- 文件系统目录名：`/Users/foo/bar` → `-Users-foo-bar`
- `history.jsonl` 中的 project 字段是原始路径

### 3.2 `lib/search.js` — 搜索引擎

**职责**：封装 Fuse.js，提供搜索接口

```js
// 构建索引
function createIndex(sessions: Session[]): Fuse

// 执行搜索
function search(fuse: Fuse, query: string): SearchResult[]

// SearchResult = { item: Session, matches: FuseMatch[] }
```

**Fuse.js 配置**：
```js
{
  keys: [
    { name: 'title', weight: 2 },
    { name: 'messages', weight: 1 },
    { name: 'project', weight: 0.5 }
  ],
  threshold: 0.4,
  includeMatches: true,
  ignoreLocation: true,
  minMatchCharLength: 1
}
```

### 3.3 `lib/tui.js` — TUI 渲染与交互

**职责**：全屏 TUI，实时搜索，左右分栏

**状态模型**（类 Elm Architecture）：
```js
state = {
  query: '',           // 搜索输入
  cursor: 0,           // 当前选中索引
  scroll: 0,           // 列表滚动偏移
  isGlobal: false,     // 是否全局搜索
  results: [],         // 当前搜索结果
  previewLines: [],    // 右栏预览内容
  cols: 80,            // 终端宽度
  rows: 24             // 终端高度
}
```

**布局计算**：
```
总宽度 = cols
左栏宽度 = Math.floor(cols * 0.45)   // 45%
右栏宽度 = cols - 左栏宽度 - 1        // 55%（减 1 为分隔线）
列表高度 = rows - 4                   // 减去 header + input + separator + footer
```

**渲染流程**：
```
1. 清屏
2. 绘制 Header（标题 + 当前范围标识）
3. 绘制搜索输入框
4. 绘制分隔线
5. 绘制左栏：session 列表（带滚动）
6. 绘制右栏：Preview Pane（选中 session 的对话）
7. 绘制 Footer（计数 + 快捷键提示）
```

**键盘事件**：
| 按键 | 动作 |
|------|------|
| 任意字符 | 追加到 query，触发搜索 + 重绘 |
| Backspace | 删除末字符，触发搜索 + 重绘 |
| ↑ / ↓ | 移动 cursor，更新 preview，重绘 |
| Tab | 切换 isGlobal，重新加载数据 + 搜索 + 重绘 |
| Enter | 退出 TUI，执行 resume |
| Esc / Ctrl+C | 退出 TUI，不 resume |

**高亮匹配**：
- 搜索结果中，匹配的关键字用 ANSI 黄色加粗高亮
- 匹配位置可从 Fuse.js 的 `matches[].indices` 获取精确位置

### 3.4 `lib/preview.js` — Preview Pane 数据

**职责**：为选中的 session 加载对话预览

**逻辑**：
1. 根据 sessionId + project 找到 session `.jsonl` 文件
2. 解析前 N 条 user/assistant 消息（N 根据右栏高度动态计算）
3. 格式化为预览行：`👤 用户消息...` / `🤖 助手回复...`
4. 每条消息截断到右栏宽度

**缓存**：
- 用 Map 缓存已加载的 session 预览（key = sessionId）
- 避免光标快速移动时重复读文件

### 3.5 `lib/resume.js` — Resume 执行

**职责**：选中 session 后执行恢复

```js
function resumeSession(sessionId, projectDir) {
  // 1. 恢复终端状态
  process.stdin.setRawMode(false);
  process.stdout.write('\x1b[?25h');

  // 2. spawnSync 启动 claude，cwd 设为项目目录
  const { status } = spawnSync('claude', ['--resume', sessionId], {
    stdio: 'inherit',
    cwd: projectDir
  });

  // 3. 退出
  process.exit(status ?? 0);
}
```

### 3.6 `bin/cfs.js` — 入口

**职责**：解析参数，决定运行模式

```
解析参数：
  -g / --global     → isGlobal = true
  -a / --assistant  → includeAssistant = true
  其余              → keyword（预填搜索词）

if (TTY) {
  → 启动 TUI 模式
} else {
  → 非交互模式，打印搜索结果
}
```

## 四、数据流

### 默认模式（user only，当前项目）
```
history.jsonl
    ↓ 读取 + 按 sessionId 聚合
    ↓ 过滤 project === cwd
Session[]
    ↓ Fuse.js 建索引
    ↓ 用户输入 → 实时搜索
SearchResult[]
    ↓ 左栏渲染列表
    ↓ 选中项 → preview.js 加载对话
    ↓ Enter → resume.js 执行恢复
```

### --assistant 模式
```
history.jsonl → Session[]（user 消息）
    +
各 session .jsonl + subagents/*.jsonl → assistant text 追加到 Session.messages
    ↓
Fuse.js 建索引 → 搜索 → 渲染 → resume
```

## 五、非交互模式（Claude Code Command）

当 `!process.stdin.isTTY` 时：
```
1. 加载数据
2. 用 keyword 搜索
3. 打印前 20 条结果（标题、项目、匹配内容、resume 命令）
4. 格式：带 ANSI 颜色的文本
```

Claude Code Command 文件 `~/.claude/commands/cfs.md`：
```markdown
Search Claude Code sessions by keyword.
Usage: /cfs [keyword]

$ARGUMENTS
```

内部执行：`cfs $ARGUMENTS`

## 六、分发方案

### npm 包
```json
{
  "name": "claude-fuzzy-search",
  "bin": { "cfs": "./bin/cfs.js" },
  "dependencies": { "fuse.js": "^7.0.0" }
}
```

### Homebrew Tap

创建 GitHub 仓库 `homebrew-tap`，包含 Formula：

```ruby
class ClaudeFuzzySearch < Formula
  desc "Fuzzy search & resume Claude Code sessions"
  homepage "https://github.com/<user>/claude-fuzzy-search"
  url "https://registry.npmjs.org/claude-fuzzy-search/-/claude-fuzzy-search-<version>.tgz"
  sha256 "<sha>"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end
end
```

安装命令：
```bash
brew tap <user>/tap
brew install claude-fuzzy-search
```

### 发布流程
1. `npm version patch/minor/major`
2. `npm publish`
3. 更新 Homebrew Formula 的 url + sha256
4. `brew upgrade claude-fuzzy-search`

## 七、实现计划

### Phase 1：核心功能
1. 重构项目结构（bin/cfs.js + lib/*.js）
2. 实现 data.js（history.jsonl 加载 + 项目过滤）
3. 实现 search.js（Fuse.js 封装）
4. 实现 tui.js（左右分栏 + 实时搜索 + 高亮）
5. 实现 preview.js（Preview Pane）
6. 实现 resume.js（spawnSync 自动恢复）

### Phase 2：完善功能
7. Tab 切换全局/当前项目
8. `--assistant` 模式（解析 session 文件 + subagent）
9. 非交互模式（非 TTY 输出）
10. CLI 参数解析（-g, -a, keyword）

### Phase 3：分发
11. 创建 Claude Code Command `/cfs`
12. npm 包配置 + 发布
13. Homebrew tap 创建 + Formula
14. README 文档
