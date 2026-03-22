import { loadSessions } from './data.js';
import { createIndex, search } from './search.js';
import { getPreviewData, clearPreviewCache } from './preview.js';
import { resumeSession } from './resume.js';

// ANSI helpers
const ESC = '\x1b[';
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const RESET = `${ESC}0m`;
const YELLOW = `${ESC}33m`;
const CYAN = `${ESC}36m`;
const GREEN = `${ESC}32m`;
const WHITE = `${ESC}37m`;
const BG_BLUE = `${ESC}44m`;
const INVERSE = `${ESC}7m`;
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const ENTER_ALT_SCREEN = `${ESC}?1049h`;
const EXIT_ALT_SCREEN = `${ESC}?1049l`;
const CURSOR_HOME = `${ESC}H`;
const CLEAR_LINE = `${ESC}K`;

// Each session item takes 3 rows: title, metadata, blank separator
const ITEM_HEIGHT = 3;

export function startTUI({ isGlobal = false, includeAssistant = false, keyword = '' } = {}) {
  const state = {
    query: keyword,
    cursor: 0,
    scroll: 0,
    isGlobal,
    includeAssistant,
    results: [],
    sessions: [],
    fuse: null,
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    focus: 'list',
    previewScroll: 0,
    previewMatchLines: [],
    previewMatchIndex: -1,
    previewTotalLines: 0,
  };

  reloadData(state);

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf-8');
  process.stdout.write(ENTER_ALT_SCREEN);
  process.stdout.write(HIDE_CURSOR);

  process.stdout.on('resize', () => {
    state.cols = process.stdout.columns || 80;
    state.rows = process.stdout.rows || 24;
    render(state);
  });

  render(state);
  process.stdin.on('data', (key) => handleKey(key, state));
}

function reloadData(state) {
  const projectDir = state.isGlobal ? null : process.cwd();
  state.sessions = loadSessions({ projectDir, includeAssistant: state.includeAssistant });
  state.fuse = createIndex(state.sessions);
  state.results = search(state.fuse, state.query, state.sessions);
  state.cursor = 0;
  state.scroll = 0;
  resetPreviewState(state);
}

function resetPreviewState(state) {
  state.previewScroll = 0;
  state.previewMatchLines = [];
  state.previewMatchIndex = -1;
  state.previewTotalLines = 0;
}

function handleKey(key, state) {
  if (key === '\x03') { cleanup(); process.exit(0); }
  if (key === '\x1b') {
    if (state.focus === 'preview') { state.focus = 'list'; render(state); return; }
    cleanup(); process.exit(0);
  }
  if (key === '\r') {
    const s = state.results[state.cursor];
    if (s) { cleanup(); resumeSession(s.item.sessionId, s.item.project); }
    return;
  }
  if (key === '\t') {
    state.isGlobal = !state.isGlobal; state.focus = 'list';
    clearPreviewCache(); reloadData(state);
    state.results = search(state.fuse, state.query, state.sessions);
    render(state); return;
  }
  if (key === '\x1b[C') {
    if (state.focus === 'list' && state.results.length > 0) {
      state.focus = 'preview';
      if (state.previewMatchLines.length > 0) { state.previewMatchIndex = 0; scrollToMatch(state); }
    }
    render(state); return;
  }
  if (key === '\x1b[D') {
    if (state.focus === 'preview') state.focus = 'list';
    render(state); return;
  }
  if (key === '\x1b[A') {
    if (state.focus === 'preview') {
      if (state.previewMatchLines.length > 0) {
        state.previewMatchIndex = state.previewMatchIndex > 0
          ? state.previewMatchIndex - 1 : state.previewMatchLines.length - 1;
        scrollToMatch(state);
      } else if (state.previewScroll > 0) state.previewScroll--;
    } else {
      if (state.cursor > 0) { state.cursor--; adjustListScroll(state); resetPreviewState(state); }
    }
    render(state); return;
  }
  if (key === '\x1b[B') {
    if (state.focus === 'preview') {
      if (state.previewMatchLines.length > 0) {
        state.previewMatchIndex = state.previewMatchIndex < state.previewMatchLines.length - 1
          ? state.previewMatchIndex + 1 : 0;
        scrollToMatch(state);
      } else {
        const maxS = Math.max(0, state.previewTotalLines - getBodyHeight(state.rows));
        if (state.previewScroll < maxS) state.previewScroll++;
      }
    } else {
      if (state.cursor < state.results.length - 1) { state.cursor++; adjustListScroll(state); resetPreviewState(state); }
    }
    render(state); return;
  }
  if (state.focus === 'preview') return;
  if (key === '\x7f' || key === '\b') {
    if (state.query.length > 0) {
      state.query = state.query.slice(0, -1);
      state.results = search(state.fuse, state.query, state.sessions);
      state.cursor = 0; state.scroll = 0; resetPreviewState(state);
    }
    render(state); return;
  }
  if (!key.startsWith('\x1b') && key >= ' ') {
    state.query += key;
    state.results = search(state.fuse, state.query, state.sessions);
    state.cursor = 0; state.scroll = 0; resetPreviewState(state);
    render(state); return;
  }
}

function scrollToMatch(state) {
  const h = getBodyHeight(state.rows);
  const line = state.previewMatchLines[state.previewMatchIndex];
  if (line === undefined) return;
  const target = Math.max(0, line - Math.floor(h / 2));
  state.previewScroll = Math.min(target, Math.max(0, state.previewTotalLines - h));
}

function adjustListScroll(state) {
  const visible = getVisibleItemCount(state.rows);
  if (state.cursor < state.scroll) state.scroll = state.cursor;
  else if (state.cursor >= state.scroll + visible) state.scroll = state.cursor - visible + 1;
}

/**
 * Body rows = everything between header and footer.
 * Layout: header(1) + title(1) + body + separator(1) + input(1) + hints(1) = rows
 * So body = rows - 5
 */
function getBodyHeight(rows) {
  return Math.max(1, rows - 5);
}

function getVisibleItemCount(rows) {
  return Math.max(1, Math.floor(getBodyHeight(rows) / ITEM_HEIGHT));
}

function cleanup() {
  process.stdout.write(EXIT_ALT_SCREEN);
  process.stdout.write(SHOW_CURSOR);
  if (process.stdin.setRawMode) process.stdin.setRawMode(false);
  process.stdin.pause();
}

// ─── Rendering ───────────────────────────────────────────────

function render(state) {
  const { cols, rows, query, cursor, scroll, results, isGlobal, focus } = state;
  const leftWidth = Math.floor(cols * 0.45);
  const rightWidth = cols - leftWidth - 1;
  const bodyHeight = getBodyHeight(rows);

  // Build preview data
  const selectedResult = results[cursor];
  let previewLines = [];
  if (selectedResult) {
    const data = getPreviewData(selectedResult.item.sessionId, selectedResult.item.project, rightWidth - 2, query);
    previewLines = data.lines;
    state.previewMatchLines = data.matchLineIndices;
    state.previewTotalLines = data.lines.length;
    // Auto-scroll to first match if we haven't navigated yet
    if (state.previewMatchIndex === -1 && data.matchLineIndices.length > 0) {
      state.previewMatchIndex = 0;
      scrollToMatch(state);
    }
  } else {
    previewLines = ['  (no session selected)'];
    state.previewMatchLines = [];
    state.previewTotalLines = 1;
  }
  const currentMatchLine = state.previewMatchIndex >= 0 ? state.previewMatchLines[state.previewMatchIndex] : -1;

  // Build left pane lines
  const leftLines = buildLeftPane(state, leftWidth);

  let output = CURSOR_HOME;

  // ── Row 0: Header bar ──
  const scopeLabel = isGlobal ? ' [全局] ' : ' [当前项目] ';
  const title = ' sss — smart-session-search ';
  const hdrPad = Math.max(0, cols - title.length - scopeLabel.length);
  output += `${BG_BLUE}${WHITE}${BOLD}${title}${' '.repeat(hdrPad)}${scopeLabel}${RESET}${CLEAR_LINE}\n`;

  // ── Body rows: title(1) + list items on left, preview on right ──
  // leftLines[0] = title, leftLines[1..] = session items
  const totalBodyRows = 1 + bodyHeight; // 1 for title row

  for (let row = 0; row < totalBodyRows; row++) {
    const leftLine = row < leftLines.length ? leftLines[row] : '';
    const paddedLeft = fitToWidth(leftLine, leftWidth);

    const previewIdx = state.previewScroll + row;
    let rightLine = '';
    if (previewIdx < previewLines.length) {
      rightLine = previewLines[previewIdx];
      if (focus === 'preview' && previewIdx === currentMatchLine) {
        rightLine = `${INVERSE}${stripAnsi(rightLine)}${RESET}`;
      }
    }
    const rightTruncated = truncateAnsiToWidth(rightLine, rightWidth - 1);

    output += `${paddedLeft}${DIM}│${RESET} ${rightTruncated}${CLEAR_LINE}\n`;
  }

  // ── Separator ──
  output += `${DIM}${'─'.repeat(leftWidth)}┴${'─'.repeat(rightWidth)}${RESET}${CLEAR_LINE}\n`;

  // ── Search input line ──
  const prompt = `${GREEN}>${RESET} `;
  const cursorCh = focus === 'list' ? `${DIM}▏${RESET}` : '';
  const placeholder = !query ? `${DIM}Type to search sessions...${RESET}` : '';
  const inputDisplay = query ? `${query}${cursorCh}` : `${placeholder}${cursorCh}`;
  output += ` ${prompt}${inputDisplay}${CLEAR_LINE}\n`;

  // ── Hints line (right-aligned) ──
  let hints;
  if (focus === 'preview') {
    const mi = state.previewMatchLines.length > 0
      ? `${state.previewMatchIndex + 1}/${state.previewMatchLines.length}` : '0';
    hints = `match: ${mi} · ←: back · Enter: resume`;
  } else {
    hints = `Enter: resume · →: preview · Tab: scope · Esc: quit`;
  }
  const hintsPad = Math.max(0, cols - hints.length - 1);
  output += `${DIM}${' '.repeat(hintsPad)}${hints} ${RESET}${CLEAR_LINE}`;

  process.stdout.write(output);
}

/**
 * Build left pane lines:
 *   [0] Title: "Resume Session (X of Y)"
 *   [1+] Session items (3 rows each: title, metadata, blank)
 */
function buildLeftPane(state, leftWidth) {
  const { query, cursor, scroll, results, focus } = state;
  const lines = [];

  // ── Line 0: Title ──
  const cursorPos = results.length > 0 ? cursor + 1 : 0;
  lines.push(` ${BOLD}Resume Session${RESET} ${DIM}(${cursorPos} of ${results.length})${RESET}`);

  // ── Session list items ──
  const visibleItems = getVisibleItemCount(state.rows);
  const hasScrollUp = scroll > 0;
  const hasScrollDown = scroll + visibleItems < results.length;

  for (let i = 0; i < visibleItems; i++) {
    const idx = scroll + i;
    if (idx >= results.length) {
      lines.push(''); lines.push(''); lines.push('');
      continue;
    }

    const result = results[idx];
    const session = result.item;
    const isSelected = idx === cursor;

    // ── Title line ──
    let pointer = '  ';
    if (isSelected && i === 0 && hasScrollUp) pointer = `${CYAN}↑${RESET} `;
    else if (isSelected && i === visibleItems - 1 && hasScrollDown) pointer = `${CYAN}↓${RESET} `;
    else if (isSelected) pointer = `${CYAN}❯${RESET} `;

    const titleMaxW = leftWidth - 4;
    let titleStr = session.title || '(untitled)';
    titleStr = truncateToWidth(titleStr, Math.max(4, titleMaxW));

    const dimAll = focus === 'preview' ? DIM : '';
    const baseStyle = (isSelected && focus === 'list') ? `${BOLD}${WHITE}` : dimAll;

    // Apply highlight with awareness of base style — restore base style after each highlight RESET
    if (state.query) {
      titleStr = highlightQueryWithBase(titleStr, state.query, baseStyle);
    }

    lines.push(`${pointer}${baseStyle}${titleStr}${RESET}`);

    // ── Metadata line ──
    const metaMaxW = leftWidth - 4;
    const timeStr = formatRelativeTime(session.timestamp);
    const sizeStr = formatFileSize(session.fileSize);
    const fixedW = getStringWidth(timeStr) + getStringWidth(sizeStr) + 6;
    const projectStr = shortenPath(session.project, Math.max(5, metaMaxW - fixedW));
    const metaParts = [timeStr, sizeStr, projectStr].filter(Boolean);
    lines.push(`  ${DIM}${metaParts.join(' - ')}${RESET}`);

    // ── Match snippet (when title doesn't contain query but messages do) ──
    const titleHasMatch = state.query && session.title && session.title.toLowerCase().includes(state.query.toLowerCase());
    const msgMatch = !titleHasMatch && result.matches?.find(m => m.key === 'messages');
    if (msgMatch && msgMatch.value) {
      const snippetMaxW = metaMaxW - 2; // extra indent
      const snippet = getMatchSnippet(msgMatch.value, state.query, snippetMaxW);
      lines.push(`    ${DIM}↳ ${RESET}${snippet}`);
    } else {
      lines.push('');
    }
  }

  return lines;
}

/**
 * Extract a snippet around the first match occurrence, with the keyword highlighted.
 */
function getMatchSnippet(text, query, maxW) {
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const pos = lower.indexOf(qLower);
  if (pos === -1) return truncateToWidth(text, maxW);

  // Show context around the match
  const contextBefore = 10;
  let start = Math.max(0, pos - contextBefore);
  const raw = text.slice(start);
  let snippet = truncateToWidth(raw, maxW);
  if (start > 0) snippet = '…' + truncateToWidth(raw, maxW - 1);

  return highlightQueryWithBase(snippet, query, DIM);
}

// ─── Formatting helpers ──────────────────────────────────────

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  return `${months} months ago`;
}

function formatFileSize(bytes) {
  if (bytes < 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function shortenPath(path, maxW) {
  if (!path) return '';
  if (getStringWidth(path) <= maxW) return path;
  const parts = path.split('/');
  let result = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = i === parts.length - 1 ? parts[i] : parts[i] + '/' + result;
    if (getStringWidth(candidate) + 1 > maxW) break;
    result = candidate;
  }
  return '…/' + result;
}

// ─── String width ────────────────────────────────────────────

function charWidth(cp) {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) return 0;
  // Ambiguous-width chars often rendered as fullwidth in CJK terminals
  if (cp === 0x00b7 || cp === 0x2014 || cp === 0x2018 || cp === 0x2019 ||
      cp === 0x201c || cp === 0x201d || cp === 0x2026 || cp === 0x25a0 ||
      cp === 0x25cb || cp === 0x25cf || cp === 0x2605 || cp === 0x2606 ||
      (cp >= 0x2010 && cp <= 0x2027) || (cp >= 0x2030 && cp <= 0x2046)) return 2;
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

function getStringWidth(str) {
  let w = 0;
  for (const ch of str) w += charWidth(ch.codePointAt(0));
  return w;
}

function fitToWidth(str, targetWidth) {
  const truncated = truncateAnsiToWidth(str, targetWidth);
  const visWidth = getStringWidth(stripAnsi(truncated));
  const pad = Math.max(0, targetWidth - visWidth);
  return truncated + ' '.repeat(pad);
}

function truncateToWidth(str, maxW) {
  let w = 0;
  const chars = [...str];
  for (let i = 0; i < chars.length; i++) {
    const cw = charWidth(chars[i].codePointAt(0));
    if (w + cw > maxW - 1) return chars.slice(0, i).join('') + '…';
    w += cw;
  }
  return str;
}

function truncateAnsiToWidth(str, maxW) {
  if (maxW <= 0) return '';
  let w = 0, result = '', inEsc = false;
  for (const ch of str) {
    if (ch === '\x1b') { inEsc = true; result += ch; continue; }
    if (inEsc) { result += ch; if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) inEsc = false; continue; }
    const cw = charWidth(ch.codePointAt(0));
    if (w + cw > maxW) { result += RESET; return result; }
    w += cw; result += ch;
  }
  return result;
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Highlight all occurrences of query in text (case-insensitive substring).
 * After each highlight, restores baseStyle so surrounding text keeps its style.
 */
function highlightQueryWithBase(text, query, baseStyle = '') {
  if (!query) return text;
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  let result = '', lastEnd = 0, pos = 0;
  while ((pos = lower.indexOf(qLower, lastEnd)) !== -1) {
    result += text.slice(lastEnd, pos);
    result += `${RESET}${YELLOW}${BOLD}${text.slice(pos, pos + qLower.length)}${RESET}${baseStyle}`;
    lastEnd = pos + qLower.length;
  }
  return result + text.slice(lastEnd);
}
