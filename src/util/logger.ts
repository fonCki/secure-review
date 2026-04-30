import { setSpinnerQuiet } from './spinner.js';

const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
} as const;

let quiet = false;
let verbose = false;

export function setQuiet(v: boolean): void {
  quiet = v;
  setSpinnerQuiet(v);
}
export function setVerbose(v: boolean): void {
  verbose = v;
}

export const log = {
  info(msg: string): void {
    if (quiet) return;
    console.log(`${COLORS.cyan}ℹ${COLORS.reset} ${msg}`);
  },
  success(msg: string): void {
    if (quiet) return;
    console.log(`${COLORS.green}✔${COLORS.reset} ${msg}`);
  },
  warn(msg: string): void {
    console.warn(`${COLORS.yellow}⚠${COLORS.reset} ${msg}`);
  },
  error(msg: string): void {
    console.error(`${COLORS.red}✘${COLORS.reset} ${msg}`);
  },
  debug(msg: string): void {
    if (!verbose) return;
    console.log(`${COLORS.gray}· ${msg}${COLORS.reset}`);
  },
  header(msg: string): void {
    if (quiet) return;
    console.log(`\n${COLORS.bold}${COLORS.magenta}━━ ${msg} ━━${COLORS.reset}`);
  },
};
