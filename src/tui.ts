import { loadSessions } from './data.js';
import { search } from './search.js';
import type { SearchResult, SearchMatch } from './search.js';
import { getPreviewData, clearPreviewCache } from './preview.js';
import { resumeSession } from './resume.js';
import {
  BOLD, DIM, RESET, YELLOW, CYAN, GREEN, WHITE,
  BG_BLUE, INVERSE,
  HIDE_CURSOR, SHOW_CURSOR, ENTER_ALT_SCREEN, EXIT_ALT_SCREEN,
  CURSOR_HOME, CLEAR_LINE, stripAnsi,
} from './ansi.js';
import {
  getStringWidth, truncateToWidth, truncateAnsiToWidth, fitToWidth,
} from './width.js';

const ITEM_HEIGHT = 3; // title + metadata + blank

interface TUIState {
  query: string;
  cursor: number;
  scroll: number;
  isGlobal: boolean;
  includeAssistant: boolean;
  results: SearchResult[];
  sessions: ReturnType<typeof loadSessions>;
  cols: number;
  rows: number;
  focus: 'list' | 'preview';
  previewScroll: number;
  previewMatchLines: number[];
  previewMatchIndex: number;
  previewTotalLines: number;
}

export interface TUIOptions {
  isGlobal?: boolean;
  includeAssistant?: boolean;
  keyword?: string;
}

export function startTUI({ isGlobal = false, includeAssistant = false, keyword = '' }: TUIOptions = {}): void {
  const state: TUIState = {
    query: keyword,
    cursor: 0,
    scroll: 0,
    isGlobal,
    includeAssistant,
    results: [],
    sessions: [],
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    focus: 'list',
    previewScroll: 0,
    previewMatchLines: [],
    previewMatchIndex: -1,
    previewTotalLines: 0,
  };

  reloadData(state);

  process.stdin.setRawMode!(true);
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
  process.stdin.on('data', (key: string) => handleKey(key, state));
}

// ─── Data ────────────────────────────────────────────────────

function reloadData(state: TUIState): void {
  const projectDir = state.isGlobal ? null : process.cwd();
  state.sessions = loadSessions({ projectDir, includeAssistant: state.includeAssistant });
  state.results = search(state.query, state.sessions);
  state.cursor = 0;
  state.scroll = 0;
  resetPreviewState(state);
}

function resetPreviewState(state: TUIState): void {
  state.previewScroll = 0;
  state.previewMatchLines = [];
  state.previewMatchIndex = -1;
  state.previewTotalLines = 0;
}

// ─── Keyboard ────────────────────────────────────────────────

function handleKey(key: string, state: TUIState): void {
  if (key === '\x03') { cleanup(); process.exit(0); }

  if (key === '\x1b') {
    if (state.focus === 'preview') { state.focus = 'list'; render(state); return; }
    cleanup(); process.exit(0);
  }

  if (key === '\r') {
    const selected = state.results[state.cursor];
    if (selected) { cleanup(); resumeSession(selected.item.sessionId, selected.item.project); }
    return;
  }

  if (key === '\t') {
    state.isGlobal = !state.isGlobal;
    state.focus = 'list';
    clearPreviewCache();
    reloadData(state);
    render(state);
    return;
  }

  // Arrow Right → focus preview
  if (key === '\x1b[C') {
    if (state.focus === 'list' && state.results.length > 0) {
      state.focus = 'preview';
      if (state.previewMatchLines.length > 0) { state.previewMatchIndex = 0; scrollToMatch(state); }
    }
    render(state); return;
  }

  // Arrow Left → focus list
  if (key === '\x1b[D') {
    if (state.focus === 'preview') state.focus = 'list';
    render(state); return;
  }

  // Arrow Up
  if (key === '\x1b[A') {
    if (state.focus === 'preview') {
      if (state.previewMatchLines.length > 0) {
        state.previewMatchIndex = state.previewMatchIndex > 0
          ? state.previewMatchIndex - 1 : state.previewMatchLines.length - 1;
        scrollToMatch(state);
      } else if (state.previewScroll > 0) {
        state.previewScroll--;
      }
    } else if (state.cursor > 0) {
      state.cursor--;
      adjustListScroll(state);
      resetPreviewState(state);
    }
    render(state); return;
  }

  // Arrow Down
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
    } else if (state.cursor < state.results.length - 1) {
      state.cursor++;
      adjustListScroll(state);
      resetPreviewState(state);
    }
    render(state); return;
  }

  if (state.focus === 'preview') return;

  // Backspace
  if (key === '\x7f' || key === '\b') {
    if (state.query.length > 0) {
      state.query = state.query.slice(0, -1);
      state.results = search(state.query, state.sessions);
      state.cursor = 0; state.scroll = 0; resetPreviewState(state);
    }
    render(state); return;
  }

  // Printable input (including IME multi-char like Chinese)
  if (!key.startsWith('\x1b') && key >= ' ') {
    state.query += key;
    state.results = search(state.query, state.sessions);
    state.cursor = 0; state.scroll = 0; resetPreviewState(state);
    render(state);
  }
}

// ─── Scroll ──────────────────────────────────────────────────

function scrollToMatch(state: TUIState): void {
  const h = getBodyHeight(state.rows);
  const line = state.previewMatchLines[state.previewMatchIndex];
  if (line === undefined) return;
  const target = Math.max(0, line - Math.floor(h / 2));
  state.previewScroll = Math.min(target, Math.max(0, state.previewTotalLines - h));
}

function adjustListScroll(state: TUIState): void {
  const visible = getVisibleItemCount(state.rows);
  if (state.cursor < state.scroll) state.scroll = state.cursor;
  else if (state.cursor >= state.scroll + visible) state.scroll = state.cursor - visible + 1;
}

/** Body rows between header and footer. Layout: header(1) + title(1) + body + sep(1) + input(1) + hints(1) */
function getBodyHeight(rows: number): number {
  return Math.max(1, rows - 5);
}

function getVisibleItemCount(rows: number): number {
  return Math.max(1, Math.floor(getBodyHeight(rows) / ITEM_HEIGHT));
}

function cleanup(): void {
  process.stdout.write(EXIT_ALT_SCREEN);
  process.stdout.write(SHOW_CURSOR);
  if (process.stdin.setRawMode) process.stdin.setRawMode(false);
  process.stdin.pause();
}

// ─── Rendering ───────────────────────────────────────────────

function render(state: TUIState): void {
  const { cols, rows, query, cursor, scroll, results, isGlobal, focus } = state;
  const leftWidth = Math.floor(cols * 0.45);
  const rightWidth = cols - leftWidth - 1;
  const bodyHeight = getBodyHeight(rows);

  // Preview data
  const selectedResult = results[cursor];
  let previewLines: string[] = [];
  if (selectedResult) {
    const data = getPreviewData(selectedResult.item.sessionId, selectedResult.item.project, rightWidth - 2, query);
    previewLines = data.lines;
    state.previewMatchLines = data.matchLineIndices;
    state.previewTotalLines = data.lines.length;
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

  const leftLines = buildLeftPane(state, leftWidth);

  let output = CURSOR_HOME;

  // Header
  const scopeLabel = isGlobal ? ' [全局] ' : ' [当前项目] ';
  const title = ' sss — smart-session-search ';
  const hdrPad = Math.max(0, cols - title.length - scopeLabel.length);
  output += `${BG_BLUE}${WHITE}${BOLD}${title}${' '.repeat(hdrPad)}${scopeLabel}${RESET}${CLEAR_LINE}\n`;

  // Body: title(1) + list items
  const totalBodyRows = 1 + bodyHeight;
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
    output += `${paddedLeft}${DIM}│${RESET} ${truncateAnsiToWidth(rightLine, rightWidth - 1)}${CLEAR_LINE}\n`;
  }

  // Separator
  output += `${DIM}${'─'.repeat(leftWidth)}┴${'─'.repeat(rightWidth)}${RESET}${CLEAR_LINE}\n`;

  // Search input
  const prompt = `${GREEN}>${RESET} `;
  const cursorCh = focus === 'list' ? `${DIM}▏${RESET}` : '';
  const placeholder = !query ? `${DIM}Type to search sessions...${RESET}` : '';
  const inputDisplay = query ? `${query}${cursorCh}` : `${placeholder}${cursorCh}`;
  output += ` ${prompt}${inputDisplay}${CLEAR_LINE}\n`;

  // Hints (right-aligned)
  let hints: string;
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

// ─── Left pane ───────────────────────────────────────────────

function buildLeftPane(state: TUIState, leftWidth: number): string[] {
  const { query, cursor, scroll, results, focus } = state;
  const lines: string[] = [];

  // Title
  const cursorPos = results.length > 0 ? cursor + 1 : 0;
  lines.push(` ${BOLD}Resume Session${RESET} ${DIM}(${cursorPos} of ${results.length})${RESET}`);

  // Session items
  const visibleItems = getVisibleItemCount(state.rows);
  const hasScrollUp = scroll > 0;
  const hasScrollDown = scroll + visibleItems < results.length;

  for (let i = 0; i < visibleItems; i++) {
    const idx = scroll + i;
    if (idx >= results.length) {
      lines.push('', '', '');
      continue;
    }

    const result = results[idx];
    const session = result.item;
    const isSelected = idx === cursor;

    // Pointer
    let pointer = '  ';
    if (isSelected && i === 0 && hasScrollUp) pointer = `${CYAN}↑${RESET} `;
    else if (isSelected && i === visibleItems - 1 && hasScrollDown) pointer = `${CYAN}↓${RESET} `;
    else if (isSelected) pointer = `${CYAN}❯${RESET} `;

    // Title
    const titleMaxW = leftWidth - 4;
    let titleStr = truncateToWidth(session.title || '(untitled)', Math.max(4, titleMaxW));
    const dimAll = focus === 'preview' ? DIM : '';
    const baseStyle = (isSelected && focus === 'list') ? `${BOLD}${WHITE}` : dimAll;
    if (query) titleStr = highlightQueryWithBase(titleStr, query, baseStyle);
    lines.push(`${pointer}${baseStyle}${titleStr}${RESET}`);

    // Metadata
    const metaMaxW = leftWidth - 4;
    const timeStr = formatRelativeTime(session.timestamp);
    const sizeStr = formatFileSize(session.fileSize);
    const fixedW = getStringWidth(timeStr) + getStringWidth(sizeStr) + 6;
    const projectStr = shortenPath(session.project, Math.max(5, metaMaxW - fixedW));
    lines.push(`  ${DIM}${[timeStr, sizeStr, projectStr].filter(Boolean).join(' - ')}${RESET}`);

    // Match snippet (when match is in messages, not title)
    const titleHasMatch = query && session.title?.toLowerCase().includes(query.toLowerCase());
    const msgMatch = !titleHasMatch ? result.matches.find((m: SearchMatch) => m.key === 'messages') : undefined;
    if (msgMatch?.value) {
      lines.push(`    ${DIM}↳ ${RESET}${getMatchSnippet(msgMatch.value, query, metaMaxW - 2)}`);
    } else {
      lines.push('');
    }
  }

  return lines;
}

// ─── Helpers ─────────────────────────────────────────────────

function getMatchSnippet(text: string, query: string, maxW: number): string {
  const qLower = query.toLowerCase();
  const pos = text.toLowerCase().indexOf(qLower);
  if (pos === -1) return truncateToWidth(text, maxW);

  const start = Math.max(0, pos - 10);
  const raw = text.slice(start);
  const snippet = start > 0 ? '…' + truncateToWidth(raw, maxW - 1) : truncateToWidth(raw, maxW);
  return highlightQueryWithBase(snippet, query, DIM);
}

function highlightQueryWithBase(text: string, query: string, baseStyle = ''): string {
  if (!query) return text;
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  let result = '', lastEnd = 0, pos: number;
  while ((pos = lower.indexOf(qLower, lastEnd)) !== -1) {
    result += text.slice(lastEnd, pos);
    result += `${RESET}${YELLOW}${BOLD}${text.slice(pos, pos + qLower.length)}${RESET}${baseStyle}`;
    lastEnd = pos + qLower.length;
  }
  return result + text.slice(lastEnd);
}

function formatRelativeTime(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const h = Math.floor(mins / 60);
  if (h === 1) return '1 hour ago';
  if (h < 24) return `${h} hours ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return '1 day ago';
  if (d < 30) return `${d} days ago`;
  const mo = Math.floor(d / 30);
  return mo === 1 ? '1 month ago' : `${mo} months ago`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function shortenPath(path: string, maxW: number): string {
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
