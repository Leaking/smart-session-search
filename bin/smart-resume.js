#!/usr/bin/env node

import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import Fuse from "fuse.js";

// ── Paths ──────────────────────────────────────────────
const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, ".claude");
const HISTORY_FILE = path.join(CLAUDE_DIR, "history.jsonl");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

// ── ANSI helpers ───────────────────────────────────────
const CSI = "\x1b[";
const RESET = `${CSI}0m`;
const BOLD = `${CSI}1m`;
const DIM = `${CSI}2m`;
const YELLOW = `${CSI}33m`;
const CYAN = `${CSI}36m`;
const GREEN = `${CSI}32m`;
const MAGENTA = `${CSI}35m`;
const WHITE = `${CSI}37m`;
const BG_CYAN = `${CSI}46m`;
const BG_DARK = `${CSI}48;5;236m`;
const INVERSE = `${CSI}7m`;
const HIDE_CURSOR = `${CSI}?25l`;
const SHOW_CURSOR = `${CSI}?25h`;
const CLEAR_LINE = `${CSI}2K`;
const CLEAR_SCREEN = `${CSI}2J${CSI}H`;

function moveTo(row, col) {
  return `${CSI}${row};${col}H`;
}

// ── Data loading ───────────────────────────────────────

function loadSessions() {
  // 1. Build session list from history.jsonl (grouped by sessionId)
  const sessionMap = new Map();

  if (fs.existsSync(HISTORY_FILE)) {
    const lines = fs.readFileSync(HISTORY_FILE, "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const sid = obj.sessionId;
        if (!sid) continue;
        if (!sessionMap.has(sid)) {
          sessionMap.set(sid, {
            sessionId: sid,
            title: obj.display || "",
            project: obj.project || "",
            timestamp: obj.timestamp || 0,
            messages: [],
          });
        }
        const sess = sessionMap.get(sid);
        // Update title to first message, timestamp to latest
        if (!sess.title && obj.display) sess.title = obj.display;
        if (obj.timestamp > sess.timestamp) sess.timestamp = obj.timestamp;
      } catch {
        // skip
      }
    }
  }

  // 2. Enrich with user messages from JSONL content files for deep search
  for (const [sid, sess] of sessionMap) {
    const jsonlPath = findSessionFile(sid, sess.project);
    if (!jsonlPath) continue;
    try {
      const content = fs.readFileSync(jsonlPath, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "user" && obj.message?.content) {
            const text =
              typeof obj.message.content === "string"
                ? obj.message.content
                : Array.isArray(obj.message.content)
                  ? obj.message.content
                      .filter((b) => b.type === "text")
                      .map((b) => b.text)
                      .join(" ")
                  : "";
            const clean = text.trim();
            if (clean && clean.length < 500) {
              sess.messages.push(clean);
            }
          }
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
  }

  // Sort by timestamp descending (most recent first)
  return Array.from(sessionMap.values()).sort(
    (a, b) => b.timestamp - a.timestamp
  );
}

function findSessionFile(sessionId, project) {
  // Try to find the .jsonl file for this session
  if (project) {
    const encoded = project.replace(/\//g, "-");
    const dir = path.join(PROJECTS_DIR, encoded);
    const file = path.join(dir, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  // Fallback: scan all project dirs
  try {
    const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const file = path.join(PROJECTS_DIR, d.name, `${sessionId}.jsonl`);
      if (fs.existsSync(file)) return file;
    }
  } catch {
    // skip
  }
  return null;
}

// ── Search ─────────────────────────────────────────────

function buildFuse(sessions) {
  return new Fuse(sessions, {
    keys: [
      { name: "title", weight: 2 },
      { name: "messages", weight: 1 },
      { name: "project", weight: 0.5 },
    ],
    threshold: 0.4,
    includeMatches: true,
    ignoreLocation: true,
    minMatchCharLength: 1,
  });
}

function searchSessions(sessions, fuse, query) {
  if (!query.trim()) return sessions.map((s) => ({ item: s, matches: [] }));
  return fuse.search(query).map((r) => ({
    item: r.item,
    matches: r.matches || [],
  }));
}

// ── Highlight helpers ──────────────────────────────────

function highlightMatch(text, query, maxLen) {
  if (!query) return truncate(text, maxLen);
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx === -1) return truncate(text, maxLen);

  // Show context around the match
  const matchLen = query.length;
  const contextBefore = 20;
  const start = Math.max(0, idx - contextBefore);
  const end = Math.min(text.length, start + maxLen);

  let result = "";
  if (start > 0) result += "…";
  result += text.slice(start, idx);
  result += `${YELLOW}${BOLD}${text.slice(idx, idx + matchLen)}${RESET}`;
  result += text.slice(idx + matchLen, end);
  if (end < text.length) result += "…";
  return result;
}

function truncate(text, maxLen) {
  if (!text) return "";
  const clean = text.replace(/\n/g, " ").replace(/\s+/g, " ");
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + "…";
}

function formatTime(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString("zh-CN");
  } catch {
    return "";
  }
}

function projectShortName(proj) {
  if (!proj) return "";
  const home = HOME;
  let short = proj.startsWith(home) ? "~" + proj.slice(home.length) : proj;
  // Further shorten
  const parts = short.split("/");
  if (parts.length > 4) {
    short = parts.slice(0, 2).join("/") + "/…/" + parts.slice(-1).join("/");
  }
  return short;
}

// ── TUI ────────────────────────────────────────────────

class InteractiveUI {
  constructor(sessions) {
    this.sessions = sessions;
    this.fuse = buildFuse(sessions);
    this.query = "";
    this.cursor = 0;
    this.scroll = 0;
    this.results = sessions.map((s) => ({ item: s, matches: [] }));
    this.selectedId = null;

    // Terminal dimensions
    this.cols = process.stdout.columns || 80;
    this.rows = process.stdout.rows || 24;
    // Reserve rows: 1 header + 1 input + 1 separator + 1 footer = 4
    this.listHeight = this.rows - 5;
    // Each item takes 3 lines (title + content + blank)
    this.itemHeight = 3;
    this.visibleItems = Math.max(1, Math.floor(this.listHeight / this.itemHeight));
  }

  start() {
    return new Promise((resolve) => {
      this.resolve = resolve;
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf-8");
      process.stdout.write(HIDE_CURSOR);

      process.stdout.on("resize", () => {
        this.cols = process.stdout.columns || 80;
        this.rows = process.stdout.rows || 24;
        this.listHeight = this.rows - 5;
        this.visibleItems = Math.max(1, Math.floor(this.listHeight / this.itemHeight));
        this.render();
      });

      process.stdin.on("data", (key) => this.onKey(key));
      this.render();
    });
  }

  onKey(key) {
    // Ctrl+C / Escape
    if (key === "\x03" || key === "\x1b") {
      this.exit(null);
      return;
    }
    // Enter
    if (key === "\r" || key === "\n") {
      if (this.results.length > 0) {
        this.exit(this.results[this.cursor]?.item?.sessionId || null);
      }
      return;
    }
    // Backspace
    if (key === "\x7f" || key === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.updateSearch();
      }
      return;
    }
    // Arrow up
    if (key === "\x1b[A") {
      if (this.cursor > 0) {
        this.cursor--;
        if (this.cursor < this.scroll) this.scroll = this.cursor;
      }
      this.render();
      return;
    }
    // Arrow down
    if (key === "\x1b[B") {
      if (this.cursor < this.results.length - 1) {
        this.cursor++;
        if (this.cursor >= this.scroll + this.visibleItems) {
          this.scroll = this.cursor - this.visibleItems + 1;
        }
      }
      this.render();
      return;
    }
    // Tab - cycle down
    if (key === "\t") {
      if (this.cursor < this.results.length - 1) {
        this.cursor++;
        if (this.cursor >= this.scroll + this.visibleItems) {
          this.scroll = this.cursor - this.visibleItems + 1;
        }
      }
      this.render();
      return;
    }
    // Regular character
    if (key >= " " && !key.startsWith("\x1b")) {
      this.query += key;
      this.updateSearch();
    }
  }

  updateSearch() {
    this.results = searchSessions(this.sessions, this.fuse, this.query);
    this.cursor = 0;
    this.scroll = 0;
    this.render();
  }

  render() {
    const { cols } = this;
    let output = CLEAR_SCREEN;

    // Header
    output += moveTo(1, 1);
    output += `${BOLD}${CYAN} Smart Resume${RESET}${DIM} — search session titles & content (↑↓ navigate, enter select, esc quit)${RESET}`;

    // Search input
    output += moveTo(2, 1);
    const prompt = ` > `;
    output += `${BOLD}${GREEN}${prompt}${RESET}${WHITE}${this.query}${RESET}`;

    // Separator
    output += moveTo(3, 1);
    output += `${DIM}${"─".repeat(Math.min(cols, 120))}${RESET}`;

    // List
    const visible = this.results.slice(
      this.scroll,
      this.scroll + this.visibleItems
    );
    let row = 4;
    const contentWidth = Math.min(cols - 4, 120);

    for (let i = 0; i < visible.length; i++) {
      const idx = this.scroll + i;
      const { item, matches } = visible[i];
      const isSelected = idx === this.cursor;

      // Line 1: title + time + project
      output += moveTo(row, 1);
      output += CLEAR_LINE;

      const timeStr = formatTime(item.timestamp);
      const projStr = projectShortName(item.project);
      const prefix = isSelected ? `${BOLD}${CYAN} ❯ ` : `   `;
      const titleMaxLen = contentWidth - timeStr.length - 4;

      let titleDisplay;
      const titleMatch = matches.find((m) => m.key === "title");
      if (titleMatch && this.query) {
        titleDisplay = highlightMatch(item.title, this.query, titleMaxLen);
      } else {
        titleDisplay = truncate(item.title, titleMaxLen);
      }
      if (isSelected) titleDisplay = `${BOLD}${WHITE}${titleDisplay}${RESET}`;

      output += `${prefix}${titleDisplay}${RESET}`;
      output += `  ${DIM}${timeStr}${RESET}`;

      // Line 2: project + content match (if any)
      row++;
      output += moveTo(row, 1);
      output += CLEAR_LINE;

      const contentMatch = matches.find((m) => m.key === "messages");
      let line2 = `     ${DIM}${projStr}${RESET}`;

      if (contentMatch && this.query && contentMatch.value) {
        const matchedText =
          typeof contentMatch.value === "string"
            ? contentMatch.value
            : Array.isArray(contentMatch.value)
              ? contentMatch.value[contentMatch.refIndex] || contentMatch.value[0] || ""
              : "";
        if (matchedText) {
          const contentPreview = highlightMatch(
            matchedText,
            this.query,
            contentWidth - projStr.length - 8
          );
          line2 += `  ${DIM}│${RESET} ${contentPreview}`;
        }
      }
      output += line2;

      // Line 3: blank separator
      row++;
      output += moveTo(row, 1);
      output += CLEAR_LINE;

      row++;
    }

    // Clear remaining lines
    for (let r = row; r <= this.rows - 1; r++) {
      output += moveTo(r, 1) + CLEAR_LINE;
    }

    // Footer
    output += moveTo(this.rows, 1);
    output += CLEAR_LINE;
    const total = this.results.length;
    const totalSessions = this.sessions.length;
    output += `${DIM} ${total}/${totalSessions} sessions`;
    if (this.query) output += ` matching "${this.query}"`;
    output += RESET;

    process.stdout.write(output);
  }

  exit(sessionId) {
    process.stdout.write(SHOW_CURSOR + CLEAR_SCREEN);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    this.resolve(sessionId);
  }
}

// ── Non-interactive (piped) mode ───────────────────────

function runNonInteractive(sessions, fuse, query) {
  const results = query
    ? searchSessions(sessions, fuse, query)
    : sessions.slice(0, 20).map((s) => ({ item: s, matches: [] }));

  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  const total = results.length;
  const shown = results.slice(0, 20);
  console.log(
    `\n${BOLD}${GREEN}Found ${total} session(s)${query ? ` matching "${query}"` : ""}${RESET}\n`
  );

  for (const { item, matches } of shown) {
    const timeStr = formatTime(item.timestamp);
    const projStr = projectShortName(item.project);

    // Title line
    let titleDisplay;
    const titleMatch = matches.find((m) => m.key === "title");
    if (titleMatch && query) {
      titleDisplay = highlightMatch(item.title, query, 100);
    } else {
      titleDisplay = truncate(item.title, 100);
    }
    console.log(`${BOLD}${CYAN}❯${RESET} ${titleDisplay}  ${DIM}${timeStr}${RESET}`);

    // Project + content match
    let line2 = `  ${DIM}${projStr}${RESET}`;
    const contentMatch = matches.find((m) => m.key === "messages");
    if (contentMatch && query && contentMatch.value) {
      const matchedText =
        typeof contentMatch.value === "string"
          ? contentMatch.value
          : Array.isArray(contentMatch.value)
            ? contentMatch.value[contentMatch.refIndex] || contentMatch.value[0] || ""
            : "";
      if (matchedText) {
        const preview = highlightMatch(matchedText, query, 80);
        line2 += `  ${DIM}│${RESET} ${preview}`;
      }
    }
    console.log(line2);

    // Session ID for resume
    console.log(`  ${DIM}claude --resume ${item.sessionId}${RESET}\n`);
  }

  if (total > 20) {
    console.log(`${DIM}... and ${total - 20} more sessions${RESET}`);
  }
}

// ── Main ───────────────────────────────────────────────

const isTTY = process.stdin.isTTY && process.stdout.isTTY;
const args = process.argv.slice(2);

console.log(`${DIM}Loading sessions...${RESET}`);
const sessions = loadSessions();

if (sessions.length === 0) {
  console.log("No sessions found.");
  process.exit(0);
}

if (isTTY) {
  // Interactive TUI mode
  const ui = new InteractiveUI(sessions);
  const selectedId = await ui.start();

  if (selectedId) {
    console.log(`\n${BOLD}Resume session:${RESET}`);
    console.log(`  claude --resume ${selectedId}\n`);
  } else {
    console.log(`\n${DIM}Cancelled.${RESET}`);
  }
} else {
  // Non-interactive mode (piped stdin, e.g. from Claude Code)
  const query = args.join(" ");
  const fuse = buildFuse(sessions);
  runNonInteractive(sessions, fuse, query);
}
