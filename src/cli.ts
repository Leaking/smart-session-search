#!/usr/bin/env node

import { loadSessions } from './data.js';
import { search } from './search.js';
import type { SearchMatch } from './search.js';
import { startTUI } from './tui.js';
import { BOLD, DIM, RESET, CYAN, YELLOW, GREEN } from './ansi.js';

// ── Parse arguments ──
const args = process.argv.slice(2);
let isGlobal = false;
let includeAssistant = false;
const keywords: string[] = [];

for (const arg of args) {
  switch (arg) {
    case '-g': case '--global':    isGlobal = true; break;
    case '-a': case '--assistant': includeAssistant = true; break;
    case '-h': case '--help':     printHelp(); process.exit(0);
    default:
      if (!arg.startsWith('-')) keywords.push(arg);
  }
}

const keyword = keywords.join(' ');

// ── TTY → TUI mode, non-TTY → text output ──
if (process.stdin.isTTY) {
  startTUI({ isGlobal, includeAssistant, keyword });
} else {
  printResults(isGlobal, includeAssistant, keyword);
}

// ── Non-interactive mode ──
function printResults(isGlobal: boolean, includeAssistant: boolean, keyword: string): void {
  const projectDir = isGlobal ? null : process.cwd();
  const sessions = loadSessions({ projectDir, includeAssistant });
  const results = search(keyword, sessions);

  const maxResults = 20;
  const shown = results.slice(0, maxResults);

  if (shown.length === 0) {
    console.log(`${DIM}No sessions found.${RESET}`);
    return;
  }

  console.log(`${BOLD}Found ${results.length} session(s)${results.length > maxResults ? ` (showing top ${maxResults})` : ''}${RESET}\n`);

  for (const result of shown) {
    const { sessionId, title, project, timestamp } = result.item;

    console.log(`${CYAN}${BOLD}${title || '(untitled)'}${RESET}`);
    console.log(`  ${DIM}Project:${RESET} ${project || '(unknown)'}`);
    console.log(`  ${DIM}Time:${RESET}    ${timestamp ? new Date(timestamp).toLocaleString() : 'unknown'}`);

    if (keyword) {
      const msgMatch = result.matches.find((m: SearchMatch) => m.key === 'messages');
      if (msgMatch?.value) {
        console.log(`  ${DIM}Match:${RESET}   ${YELLOW}${msgMatch.value.slice(0, 120)}${RESET}`);
      }
    }

    console.log(`  ${DIM}Resume:${RESET}  ${GREEN}cd ${project} && claude --resume ${sessionId}${RESET}`);
    console.log();
  }
}

function printHelp(): void {
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
