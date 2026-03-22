# sss — smart-session-search

**Search and resume Claude Code sessions by keyword.**

The built-in `/resume` only matches session titles. `sss` searches both titles and message content, with a full-screen TUI, preview pane, keyword highlighting, and cross-project resume.

Zero dependencies. Works with any terminal.

## The Problem

You've had hundreds of Claude Code sessions. You remember discussing something — maybe "docker compose" or "auth middleware" — but you can't find it. The built-in `/resume` only searches titles, so if the title doesn't match, you're stuck scrolling.

## The Solution

```
 sss — smart-session-search ──────────────────────── [Global] ─
 Resume Session (3 of 125)
 ❯ Deploy to production                  │ 👤 help me set up the docker
   2 hours ago - 689.1KB - …/my-project  │    compose file for deploying
                                          │
   Fix auth middleware                    │ 🤖 I'll help you set up Docker
   1 day ago - 24.5KB - …/backend        │    Compose for deployment...
   ↳ …check the JWT token validation     │
                                          │
   Database migration                     │
   3 days ago - 5.8MB - …/my-project     │
 ─────────────────────────────────────────┴─────────────────────
 > docker▏
                   Enter: resume · →: preview · Tab: scope · Esc: quit
```

## Install

```bash
npm install -g smart-session-search
```

Requires Node.js >= 18 and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed.

## Usage

```bash
sss                  # Search current project sessions
sss -g               # Search ALL projects
sss docker           # Pre-fill search with "docker"
sss -g auth          # Global search for "auth"
```

## Features

### Search Titles + Message Content
Searches across session titles, user messages, and project paths. Finds sessions even when the title doesn't mention what you're looking for.

### Split-Pane TUI
- **Left pane**: Session list with title, relative time, file size, and project path
- **Right pane**: Live preview of the selected session's conversation
- Match snippets shown inline when the keyword is found in messages but not the title

### Keyword Highlighting
Matched keywords are highlighted in both the session list and the preview pane. When searching, the preview filters to only show messages containing the keyword.

### Cross-Project Resume
Select any session and press Enter — `sss` automatically `cd`s to the correct project directory and runs `claude --resume`. No need to manually switch directories.

### Global Search
Press `Tab` to toggle between current project and all projects. Find that session from last week, even if you don't remember which project it was in.

### Preview Navigation
Press `→` to focus the preview pane, then `↑`/`↓` to jump between keyword matches. Press `←` or `Esc` to go back to the session list.

### Session File Expiration Guidance
When a session file has been cleaned up by Claude Code (default: 30 days), the preview shows a clear message with instructions to extend the retention period.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Type | Search sessions in real-time |
| `↑` `↓` | Navigate session list |
| `Enter` | Resume selected session |
| `Tab` | Toggle current project / global scope |
| `→` | Focus preview pane |
| `←` `Esc` | Back to session list (or quit) |
| `Ctrl+C` | Quit |

## How It Works

`sss` reads from Claude Code's local data:

- **`~/.claude/history.jsonl`** — session index with titles, project paths, and timestamps
- **`~/.claude/projects/<path>/<session-id>.jsonl`** — full session conversations

Search is case-insensitive exact (substring) matching. No external services, no network requests, everything stays local.

## CJK / Emoji Support

Terminal column widths are calculated correctly for CJK characters, emoji, and fullwidth symbols. Ambiguous-width characters (like `·`, `—`, `…`) are treated as 2 columns wide for CJK terminal compatibility.

## License

MIT
