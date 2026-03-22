import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadPreviewMessages, encodeProjectPath } from './data.js';
import { BOLD, DIM, RESET, YELLOW, CYAN, RED, WHITE, BG_YELLOW, BLACK } from './ansi.js';
import { charWidth, getStringWidth, wrapText } from './width.js';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

export interface PreviewData {
  lines: string[];
  matchLineIndices: number[];
}

const cache = new Map<string, PreviewData>();

/**
 * Get formatted preview lines for a session, with keyword highlighting.
 * Includes a header section showing session metadata.
 */
export function getPreviewData(sessionId: string, projectPath: string, maxWidth: number, query = ''): PreviewData {
  const cacheKey = `${sessionId}:${maxWidth}:${query}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const lines: string[] = [];
  const matchLineIndices: number[] = [];
  const queryLower = query.toLowerCase().trim();

  // ── Header: session metadata ──
  const encodedPath = projectPath ? encodeProjectPath(projectPath) : '(unknown)';
  const sessionDir = projectPath ? join(PROJECTS_DIR, encodedPath) : '(unknown)';
  const sessionFile = projectPath ? join(sessionDir, `${sessionId}.jsonl`) : null;
  const fileExists = sessionFile !== null && existsSync(sessionFile);

  lines.push(`${DIM}ID:${RESET}   ${CYAN}${sessionId}${RESET}`);
  lines.push(`${DIM}Dir:${RESET}  ${truncateFromEnd(sessionDir, maxWidth - 6)}`);

  if (fileExists) {
    lines.push(`${DIM}File:${RESET} ${truncateFromEnd(sessionFile, maxWidth - 6)}`);
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
    const result: PreviewData = { lines, matchLineIndices };
    cache.set(cacheKey, result);
    return result;
  }

  const messages = loadPreviewMessages(sessionId, projectPath);
  const contentWidth = maxWidth - 3; // icon(2) + space(1)

  if (queryLower) {
    let matchCount = 0;
    for (const msg of messages) {
      const text = msg.text.replace(/[\r\n]+/g, ' ').trim();
      if (!text.toLowerCase().includes(queryLower)) continue;

      matchCount++;
      const icon = msg.role === 'user' ? '\u{1F464}' : '\u{1F916}';
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
      lines.push(`${DIM}── ${matchCount} matching message(s) ──${RESET}`);
    }
  } else {
    for (const msg of messages) {
      const icon = msg.role === 'user' ? '\u{1F464}' : '\u{1F916}';
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

  const result: PreviewData = { lines, matchLineIndices };
  cache.set(cacheKey, result);
  return result;
}

export function clearPreviewCache(): void {
  cache.clear();
}

// ── Helpers ──

function truncateFromEnd(value: string, maxWidth: number): string {
  let w = 0;
  for (const ch of value) w += charWidth(ch.codePointAt(0)!);
  if (w <= maxWidth) return value;

  const chars = [...value];
  let result = '';
  let rw = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = charWidth(chars[i].codePointAt(0)!);
    if (rw + cw + 1 > maxWidth) break;
    result = chars[i] + result;
    rw += cw;
  }
  return '\u2026' + result;
}

function highlightKeyword(text: string, queryLower: string): string {
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
