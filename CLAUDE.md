# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**smart-session-search (sss)** — An enhanced Claude Code session search tool. Searches both session **titles** and **message content** (unlike built-in `/resume` which only matches titles). Uses case-insensitive exact (substring) matching. Zero dependencies.

## Commands

```bash
npm link              # Install as global `sss` command
node bin/sss.js       # Run directly
sss                   # TUI mode, search current project
sss -g                # TUI mode, search all projects
sss -g keyword        # TUI mode, global + pre-fill search
sss --help            # Show help
```

## Architecture

### `bin/sss.js` — Entry point
- **TTY mode** (terminal): Full-screen interactive TUI with real-time search, arrow key navigation, preview pane, auto resume
- **Non-TTY mode** (Claude Code Bash): Prints search results as text, accepts keyword as CLI arg

### `lib/` modules
| Module | Responsibility |
|--------|---------------|
| `data.js` | Load sessions from `~/.claude/history.jsonl`, aggregate by sessionId, load preview messages from session `.jsonl` files |
| `search.js` | Case-insensitive substring search across title, messages, project |
| `tui.js` | Full-screen TUI: left pane (session list) + right pane (preview), keyboard navigation |
| `preview.js` | Preview pane data: session metadata header, filtered message display with keyword highlighting |
| `resume.js` | `spawnSync` to launch `claude --resume` with correct `cwd` |

### Data sources
- `~/.claude/history.jsonl` — session index (titles, project paths, timestamps)
- `~/.claude/projects/<encoded-path>/<session-id>.jsonl` — full session content
- Messages over 2000 chars are skipped during indexing

### Claude Code integration
- `/smart-resume [keyword]` command defined at `~/.claude/commands/smart-resume.md`
- Runs in non-interactive mode since Claude Code Bash has no TTY

## Session File Format

Sessions are JSONL files at `~/.claude/projects/<encoded-path>/<uuid>.jsonl`. Each line is one of:
- `file-history-snapshot` — file state checkpoint
- `type: "user"` — user message (`parentUuid: null` = conversation start)
- `type: "assistant"` — Claude response (may contain `thinking`, `text`, or `tool_use`)
- `type: "user"` with `tool_result` — tool execution output

Project paths are encoded: `/Users/foo/bar` → `-Users-foo-bar`

## Key Design Decisions

- User message content can be `string` or `Array<{type, text}>` — both must be handled
- Messages over 2000 chars are skipped during indexing to avoid noise from system prompts
- Session files may be cleaned up by Claude Code after 30 days (configurable via `cleanupPeriodDays` in `~/.claude/settings.json`)
- Preview pane: when searching, only shows messages containing the keyword; when not searching, shows all messages
- Terminal column width: CJK/emoji characters counted as 2 columns, ambiguous-width chars (·, —, …) also treated as 2 columns for CJK terminal compatibility
