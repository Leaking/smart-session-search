# TODO — 优化方向

## 内存与性能

### 当前状况（基于实际数据分析）

| 数据 | 规模 | 说明 |
|------|------|------|
| history.jsonl | 0.23 MB | 搜索索引来源，常驻内存，126 个 session、41 KB 消息文本 |
| Session 文件 | 64 个，共 26.65 MB | 最大单文件 11.2 MB，按需加载用于 preview |
| Preview 缓存 | 按 sessionId 缓存 | 选中过的 session 消息会留在 Map 中 |

### 评估

**搜索阶段（history.jsonl）— 无风险**
- 所有 session 的 messages 数组一次性全部加载到内存（当前约 41 KB）
- 即使增长到 1000+ session，预计 < 1 MB，不构成问题
- `String.includes()` 是 O(n*m) 但数据量小，毫秒级

**Preview 阶段（session .jsonl）— 需关注**
- 大文件（如 11 MB）会被 `readFileSync` 一次性读入，再逐行 `JSON.parse`
- 整个 messages 数组留在 preview 缓存中
- 多个大 session 切换后，缓存会累积

### 优化方案（按优先级）

#### P2: Preview 流式读取
当前 `readFileSync` + `split('\n')` 对大文件会产生两倍峰值内存（原始字符串 + 行数组）。可改为 `readline` 或自定义流式解析：
```js
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

async function* streamMessages(filePath) {
  const rl = createInterface({ input: createReadStream(filePath) });
  for await (const line of rl) {
    // parse and yield
  }
}
```
好处：峰值内存从 O(文件大小*2) 降到 O(单行大小)。
代价：需要改为异步，TUI 渲染需要处理 loading 状态。

#### P2: Preview 缓存淘汰（LRU）
当前缓存无上限。可加 LRU 策略，只保留最近 N 个 session 的 preview：
```js
if (cache.size > 10) {
  const oldest = cache.keys().next().value;
  cache.delete(oldest);
}
```

#### P3: 搜索结果限流
当前搜索返回所有匹配的 session。极端情况（通用词如 "the"）可能返回全部 session。可加 `maxResults` 参数，搜索时 early return。

#### P3: Preview 按需搜索 + 分页
有搜索词时当前加载全部消息再过滤。对于超大 session 可改为流式扫描 + 只提取匹配行附近的上下文，避免全量解析。

## 功能

- [ ] `--assistant` 模式：搜索 assistant 回复内容（需解析 session .jsonl + subagent 文件）
- [ ] Claude Code Command `/cfs` 集成
- [ ] npm publish + Homebrew tap 分发
- [ ] README 文档
