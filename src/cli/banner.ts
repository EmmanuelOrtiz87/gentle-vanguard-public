/**
 * banner — Gentle-Vanguard ASCII art header
 *
 * Reusable banner for all main scripts. Provides consistent branding.
 *
 * Usage:
 *   import { printBanner } from './banner.js';
 *   printBanner();
 *   printBanner('Presentations Server', 'cyan');  // custom subtitle + color
 */

const CYAN = '\x1b[36m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// ─── GENTLE in ASCII block art ──────────────────────────────────────
const GENTLE_ART = [
  ' ██████╗ ███████╗███╗   ██╗████████╗██╗     ███████╗',
  '██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║     ██╔════╝',
  '██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║     █████╗  ',
  '██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║     ██╔══╝  ',
  '╚██████╔╝███████╗██║ ╚████║   ██║   ███████╗███████╗',
  ' ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚══════╝',
];

// ─── VANGUARD in ASCII block art (FIXED: G not C) ─────────────────
// The original had a 'C' block (██████╗/██╔════╝/██║/██║/╚██████╗/╚═════╝)
// instead of 'G' block (██████╗/██╔════╝/██║  ███╗/██║   ██║/╚██████╔╝/╚═════╝)
const VANGUARD_ART = [
  ' ██╗   ██╗ █████╗ ███╗   ██╗ ██████╗ ██╗   ██╗ █████╗ ██████╗ ██████╗',
  ' ██║   ██║██╔══██╗████╗  ██║██╔════╝ ██║   ██║██╔══██╗██╔══██╗██╔══██╗',
  ' ██║   ██║███████║██╔██╗ ██║██║  ███╗██║   ██║███████║██████╔╝██║  ██║',
  ' ╚██╗ ██╔╝██╔══██║██║╚██╗██║██║   ██║██║   ██║██╔══██║██╔══██╗██║  ██║',
  '  ╚████╔╝ ██║  ██║██║ ╚████║╚██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝',
  '   ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝',
];

// ─── Separator line ────────────────────────────────────────────────
const SEPARATOR = '─'.repeat(50);

// ─── Pretty box banner ─────────────────────────────────────────────
const BOX_BANNER = [
  '╔══════════════════════════════════════════════════╗',
  '║            ◈  GENTLE-VANGUARD  ◈               ║',
  '║          Autonomous AI Development Stack         ║',
  '╚══════════════════════════════════════════════════╝',
];

export function printBanner(subtitle?: string, color = CYAN): void {
  const lines: string[] = [];

  // ASCII art
  for (let i = 0; i < GENTLE_ART.length; i++) {
    lines.push(`${color}${GENTLE_ART[i]}${RESET}`);
  }
  // Hyphen separator (a simple line of blocks)
  lines.push(`${color}  ═══════════════════════════════════════════════════${RESET}`);
  for (let i = 0; i < VANGUARD_ART.length; i++) {
    lines.push(`${color}${VANGUARD_ART[i]}${RESET}`);
  }

  // Subtitle if provided
  if (subtitle) {
    lines.push('');
    lines.push(`${DIM}${SEPARATOR}${RESET}`);
    lines.push(`${BLUE}  ${subtitle}${RESET}`);
  }

  lines.push(`${DIM}${SEPARATOR}${RESET}`);
  lines.push('');

  console.log(lines.join('\n'));
}

/** Simple box banner for quick use */
export function printBox(subtitle?: string, color = CYAN): void {
  const lines = BOX_BANNER.map((l) => `${color}${l}${RESET}`);
  if (subtitle) {
    const pad = 42 - subtitle.length;
    const left = Math.floor(pad / 2);
    const right = pad - left;
    lines.splice(2, 0, `${color}║${' '.repeat(left)}${subtitle}${' '.repeat(right)}║${RESET}`);
  }
  lines.push('');
  console.log(lines.join('\n'));
}

/** Just the divider line */
export function printDivider(color = DIM): void {
  console.log(`${color}${SEPARATOR}${RESET}`);
}

export default { printBanner, printBox, printDivider };
