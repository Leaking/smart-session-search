const ESC = '\x1b[';

// Style
export const BOLD = `${ESC}1m`;
export const DIM = `${ESC}2m`;
export const RESET = `${ESC}0m`;
export const INVERSE = `${ESC}7m`;

// Foreground colors
export const BLACK = `${ESC}30m`;
export const GREEN = `${ESC}32m`;
export const YELLOW = `${ESC}33m`;
export const CYAN = `${ESC}36m`;
export const WHITE = `${ESC}37m`;
export const RED = `${ESC}31m`;

// Background colors
export const BG_BLUE = `${ESC}44m`;
export const BG_YELLOW = `${ESC}43m`;

// Terminal control
export const HIDE_CURSOR = `${ESC}?25l`;
export const SHOW_CURSOR = `${ESC}?25h`;
export const ENTER_ALT_SCREEN = `${ESC}?1049h`;
export const EXIT_ALT_SCREEN = `${ESC}?1049l`;
export const CURSOR_HOME = `${ESC}H`;
export const CLEAR_LINE = `${ESC}K`;

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}
