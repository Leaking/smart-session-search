import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadPreviewMessages, encodeProjectPath } from './data.js';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

// ANSI helpers
const ESC = '\x1b[';
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const RESET = `${ESC}0m`;
const YELLOW = `${ESC}33m`;
const CYAN = `${ESC}36m`;
const RED = `${ESC}31m`;
const WHITE = `${ESC}37m`;
const BG_YELLOW = `${ESC}43m`;
const BLACK = `${ESC}30m`;

/** Cache loaded raw messages to avoid re-reading files on cursor movement. */
const cache = new Map();

/**
 * Get ALL formatted preview lines for a session, with keyword highlighting.
 * Includes a header section showing session metadata.
 *
 * @param {string} sessionId
 * @param {string} projectPath
 * @param {number} maxWidth - max characters per line
 * @param {string} query - search keyword for highlighting
 * @returns {{ lines: string[], matchLineIndices: number[] }}
 */
export function getPreviewData(sessionId, projectPath, maxWidth, query = '') {
  const cacheKey = `${sessionId}:${maxWidth}:${query}`;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const lines = [];
  const matchLineIndices = [];
  const queryLower = query.toLowerCase().trim();

  // ── Header: session metadata ──
  const encodedPath = projectPath ? encodeProjectPath(projectPath) : '(unknown)';
  const sessionDir = projectPath
    ? join(PROJECTS_DIR, encodedPath)
    : '(unknown)';
  const sessionFile = projectPath
    ? join(sessionDir, `${sessionId}.jsonl`)
    : null;
  const fileExists = sessionFile && existsSync(sessionFile);

  lines.push(`${DIM}ID:${RESET}   ${CYAN}${sessionId}${RESET}`);
  lines.push(`${DIM}Dir:${RESET}  ${wrapHeaderValue(sessionDir, maxWidth - 6)}`);
  if (fileExists) {
    lines.push(`${DIM}File:${RESET} ${wrapHeaderValue(sessionFile, maxWidth - 6)}`);
  } else {
    lines.push(`${DIM}File:${RESET} ${RED}session file not found (expired)${RESET}`);
  }
  lines.push(`${DIM}${'─'.repeat(Math.max(1, maxWidth))}${RESET}`);

  // ── Conversation preview ──
  if (!fileExists) {
    lines.push('');
    lines.push(`  ${DIM}Session file has been cleaned up by Claude Code.${RESET}`);
    lines.push(`  ${DIM}Default expiration: 30 days.${RESET}`);
    lines.push('');
    lines.push(`  ${YELLOW}To extend or disable expiration, add to${RESET}`);
    lines.push(`  ${CYAN}~/.claude/settings.json${RESET}${DIM}:${RESET}`);
    lines.push('');
    lines.push(`  ${WHITE}{ "cleanupPeriodDays": 99999 }${RESET}`);
    const result = { lines, matchLineIndices };
    cache.set(cacheKey, result);
    return result;
  }

  const messages = loadPreviewMessages(sessionId, projectPath);
  const contentWidth = maxWidth - 3; // icon + space

  if (queryLower) {
    // Filter mode: only show messages that contain the query
    let matchCount = 0;
    for (const msg of messages) {
      const text = msg.text.replace(/[\r\n]+/g, ' ').trim();
      if (!text.toLowerCase().includes(queryLower)) continue;

      matchCount++;
      const icon = msg.role === 'user' ? '👤' : '🤖';
      const wrapped = wrapText(text, contentWidth);

      for (let i = 0; i < wrapped.length; i++) {
        const lineText = wrapped[i];
        const highlighted = highlightKeyword(lineText, queryLower);
        const prefix = i === 0 ? `${icon} ` : '   ';
        lines.push(`${prefix}${highlighted}`);

        if (lineText.toLowerCase().includes(queryLower)) {
          matchLineIndices.push(lines.length - 1);
        }
      }
      lines.push('');
    }

    if (matchCount === 0) {
      lines.push('');
      lines.push(`  ${DIM}(no matching messages in session file)${RESET}`);
    } else {
      // Summary at end
      lines.push(`${DIM}── ${matchCount} matching message(s) ──${RESET}`);
    }
  } else {
    // No query: show all messages
    for (const msg of messages) {
      const icon = msg.role === 'user' ? '👤' : '🤖';
      const text = msg.text.replace(/[\r\n]+/g, ' ').trim();
      const wrapped = wrapText(text, contentWidth);

      for (let i = 0; i < wrapped.length; i++) {
        const prefix = i === 0 ? `${icon} ` : '   ';
        lines.push(`${prefix}${wrapped[i]}`);
      }
      lines.push('');
    }

    if (messages.length === 0) {
      lines.push('');
      lines.push('  (no messages found in session file)');
    }
  }

  const result = { lines, matchLineIndices };
  cache.set(cacheKey, result);
  return result;
}

/**
 * Truncate a header value if it's too wide, showing the tail.
 */
function wrapHeaderValue(value, maxWidth) {
  let w = 0;
  for (const ch of value) w += charWidth(ch.codePointAt(0));
  if (w <= maxWidth) return value;
  // Show from the end
  const chars = [...value];
  let result = '', rw = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = charWidth(chars[i].codePointAt(0));
    if (rw + cw + 1 > maxWidth) break; // +1 for …
    result = chars[i] + result;
    rw += cw;
  }
  return '…' + result;
}

/**
 * Highlight all occurrences of keyword in text (case-insensitive).
 */
function highlightKeyword(text, queryLower) {
  const textLower = text.toLowerCase();
  let result = '';
  let lastEnd = 0;

  let pos = textLower.indexOf(queryLower, 0);
  while (pos !== -1) {
    result += text.slice(lastEnd, pos);
    result += `${BG_YELLOW}${BLACK}${text.slice(pos, pos + queryLower.length)}${RESET}`;
    lastEnd = pos + queryLower.length;
    pos = textLower.indexOf(queryLower, lastEnd);
  }
  result += text.slice(lastEnd);
  return result;
}

/**
 * Wrap text to fit within a given terminal column width.
 * Handles CJK/emoji characters that take 2 columns.
 */
function wrapText(text, width) {
  if (width <= 0) return [text];
  const lines = [];
  const chars = [...text];
  let line = '';
  let lineW = 0;

  for (const ch of chars) {
    const w = charWidth(ch.codePointAt(0));
    if (lineW + w > width) {
      lines.push(line);
      line = ch;
      lineW = w;
    } else {
      line += ch;
      lineW += w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * Get the terminal display width of a character.
 */
function charWidth(cp) {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) return 0;
  if (cp === 0x00b7 || (cp >= 0x2010 && cp <= 0x2027) || (cp >= 0x2030 && cp <= 0x2046)) return 2;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3040 && cp <= 0x33bf) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff01 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x2fffd) ||
    (cp >= 0x30000 && cp <= 0x3fffd) ||
    (cp >= 0x1f000 && cp <= 0x1fbff) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) ||
    (cp >= 0x1fa00 && cp <= 0x1faff)
  ) return 2;
  return 1;
}

/**
 * Clear the preview cache.
 */
export function clearPreviewCache() {
  cache.clear();
}
