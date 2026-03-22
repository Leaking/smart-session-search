/**
 * Get the terminal display width of a character by its code point.
 * CJK, emoji, and fullwidth chars take 2 columns; others take 1.
 */
export function charWidth(cp: number): number {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;

  // Zero-width characters
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) return 0;

  // Ambiguous-width chars often rendered as fullwidth in CJK terminals
  if (
    cp === 0x00b7 || cp === 0x2014 || cp === 0x2018 || cp === 0x2019 ||
    cp === 0x201c || cp === 0x201d || cp === 0x2026 || cp === 0x25a0 ||
    cp === 0x25cb || cp === 0x25cf || cp === 0x2605 || cp === 0x2606 ||
    (cp >= 0x2010 && cp <= 0x2027) || (cp >= 0x2030 && cp <= 0x2046)
  ) return 2;

  // Wide character ranges
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||  // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) ||  // CJK Radicals
    (cp >= 0x3040 && cp <= 0x33bf) ||  // Japanese, CJK compatibility
    (cp >= 0x3400 && cp <= 0x4dbf) ||  // CJK Unified Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) ||  // CJK Unified
    (cp >= 0xa000 && cp <= 0xa4cf) ||  // Yi
    (cp >= 0xac00 && cp <= 0xd7af) ||  // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||  // CJK Compat Ideographs
    (cp >= 0xfe30 && cp <= 0xfe6f) ||  // CJK Compat Forms
    (cp >= 0xff01 && cp <= 0xff60) ||  // Fullwidth Forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||  // Fullwidth Signs
    (cp >= 0x20000 && cp <= 0x2fffd) || // CJK Ext B+
    (cp >= 0x30000 && cp <= 0x3fffd) || // CJK Ext G+
    (cp >= 0x1f000 && cp <= 0x1fbff) || // Emoji & Symbols
    (cp >= 0x1f300 && cp <= 0x1f9ff) || // Misc Symbols & Emoji
    (cp >= 0x1fa00 && cp <= 0x1faff)    // Extended-A Emoji
  ) return 2;

  return 1;
}

/**
 * Get the terminal display width of a plain string (no ANSI codes).
 */
export function getStringWidth(str: string): number {
  let w = 0;
  for (const ch of str) w += charWidth(ch.codePointAt(0)!);
  return w;
}

/**
 * Wrap text to fit within a given terminal column width.
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  const chars = [...text];
  let line = '';
  let lineW = 0;

  for (const ch of chars) {
    const w = charWidth(ch.codePointAt(0)!);
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
 * Truncate a plain-text string to fit in `maxW` terminal columns.
 * Appends \u2026 if truncated.
 */
export function truncateToWidth(str: string, maxW: number): string {
  let w = 0;
  const chars = [...str];
  for (let i = 0; i < chars.length; i++) {
    const cw = charWidth(chars[i].codePointAt(0)!);
    if (w + cw > maxW - 1) return chars.slice(0, i).join('') + '\u2026';
    w += cw;
  }
  return str;
}

/**
 * Truncate a string (possibly containing ANSI codes) to fit in `maxW` terminal columns.
 */
export function truncateAnsiToWidth(str: string, maxW: number): string {
  if (maxW <= 0) return '';
  let w = 0, result = '', inEsc = false;
  for (const ch of str) {
    if (ch === '\x1b') { inEsc = true; result += ch; continue; }
    if (inEsc) { result += ch; if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) inEsc = false; continue; }
    const cw = charWidth(ch.codePointAt(0)!);
    if (w + cw > maxW) { result += '\x1b[0m'; return result; }
    w += cw; result += ch;
  }
  return result;
}

/**
 * Fit an ANSI-styled string to exactly `targetWidth` terminal columns.
 * Truncates if too wide, pads with spaces if too narrow.
 */
export function fitToWidth(str: string, targetWidth: number): string {
  const truncated = truncateAnsiToWidth(str, targetWidth);
  const visWidth = getStringWidth(truncated.replace(/\x1b\[[0-9;]*m/g, ''));
  const pad = Math.max(0, targetWidth - visWidth);
  return truncated + ' '.repeat(pad);
}
