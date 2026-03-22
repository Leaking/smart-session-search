#!/usr/bin/env node

import { loadSessions } from '../lib/data.js';
import { createIndex, search } from '../lib/search.js';
import { startTUI } from '../lib/tui.js';

// ── Parse arguments ──
const args = process.argv.slice(2);
let isGlobal = false;
let includeAssistant = false;
const keywords = [];

for (const arg of args) {
  if (arg === '-g' || arg === '--global') {
    isGlobal = true;
  } else if (arg === '-a' || arg === '--assistant') {
    includeAssistant = true;
  } else if (arg === '-h' || arg === '--help') {
    printHelp();
    process.exit(0);
  } else if (!arg.startsWith('-')) {
    keywords.push(arg);
  }
}

const keyword = keywords.join(' ');

// ── TTY → TUI mode, non-TTY → text output ──
if (process.stdin.isTTY) {
  startTUI({ isGlobal, includeAssistant, keyword });
} else {
  printResults({ isGlobal, includeAssistant, keyword });
}

// ── Non-interactive mode ──
function printResults({ isGlobal, includeAssistant, keyword }) {
  const projectDir = isGlobal ? null : process.cwd();
  const sessions = loadSessions({ projectDir, includeAssistant });
  const fuse = createIndex(sessions);
  const results = search(fuse, keyword, sessions);

  const RESET = '\x1b[0m';
  const BOLD = '\x1b[1m';
  const DIM = '\x1b[2m';
  const CYAN = '\x1b[36m';
  const YELLOW = '\x1b[33m';
  const GREEN = '\x1b[32m';

  const maxResults = 20;
  const shown = results.slice(0, maxResults);

  if (shown.length === 0) {
    console.log(`${DIM}No sessions found.${RESET}`);
    return;
  }

  console.log(`${BOLD}Found ${results.length} session(s)${results.length > maxResults ? ` (showing top ${maxResults})` : ''}${RESET}\n`);

  for (const result of shown) {
    const s = result.item;
    const time = formatTime(s.timestamp);
    const title = s.title || '(untitled)';
    const project = s.project || '(unknown)';

    console.log(`${CYAN}${BOLD}${title}${RESET}`);
    console.log(`  ${DIM}Project:${RESET} ${project}`);
    console.log(`  ${DIM}Time:${RESET}    ${time}`);

    // Show matching message snippet if available
    if (keyword && result.matches) {
      const msgMatch = result.matches.find(m => m.key === 'messages');
      if (msgMatch?.value) {
        const snippet = typeof msgMatch.value === 'string'
          ? msgMatch.value.slice(0, 120)
          : String(msgMatch.value).slice(0, 120);
        console.log(`  ${DIM}Match:${RESET}   ${YELLOW}${snippet}${RESET}`);
      }
    }

    console.log(`  ${DIM}Resume:${RESET}  ${GREEN}cd ${project} && claude --resume ${s.sessionId}${RESET}`);
    console.log();
  }
}

function formatTime(ts) {
  if (!ts) return 'unknown';
  return new Date(ts).toLocaleString();
}

function printHelp() {
  console.log(`
sss — smart-session-search

Search and resume Claude Code sessions by keyword.

Usage:
  sss                    TUI mode, search current project sessions
  sss -g                 TUI mode, search all projects
  sss keyword            TUI mode, pre-fill search query
  sss -g keyword         TUI mode, global + pre-fill search query

Options:
  -g, --global           Search sessions across all projects
  -a, --assistant        Also search assistant reply content
  -h, --help             Show this help message
`.trim());
}
