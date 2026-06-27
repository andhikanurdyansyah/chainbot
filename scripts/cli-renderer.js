/**
 * Premium CLI Renderer — beautiful terminal output.
 * No external dependencies. ANSI escape codes only.
 *
 * Captures original console.log at import time so output works
 * even when the caller overrides console.log for log interception.
 */

const _log = console.log;

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  under: '\x1b[4m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m',
  bgCyan: '\x1b[46m',
};

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const BAR_FILL = '█';
const BAR_EMPTY = '░';
const BAR_LEN = 20;

let _spinnerIdx = 0;
let _spinnerTimer = null;
let _spinnerLine = '';
let _startTime = 0;
let _accountStartTime = 0;

function hideCursor() { process.stdout.write('\x1b[?25l'); }
function showCursor() { process.stdout.write('\x1b[?25h'); }
function clearLine() { process.stdout.write('\r\x1b[K'); }

function elapsed(startMs) {
  const s = Math.floor((Date.now() - startMs) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function boxLine(text, width = 58) {
  const pad = Math.max(0, width - text.length);
  return `║  ${text}${' '.repeat(pad)}║`;
}

function line(width = 62, ch = '─') {
  return ch.repeat(width);
}

// --- Public API ---

function banner(version) {
  const w = 58;
  _log();
  _log(`${C.cyan}╭${'─'.repeat(w)}╮${C.reset}`);
  _log(`${C.cyan}│${C.reset}${C.bold}${C.white}  ⚡ MiMo Chain Bot${C.reset} ${C.dim}v${version}${C.reset}${' '.repeat(w - 22 - version.length)}${C.cyan}│${C.reset}`);
  _log(`${C.cyan}│${C.reset}  ${C.dim}Google OAuth Auto-Registration${C.reset}${' '.repeat(w - 32)}${C.cyan}│${C.reset}`);
  _log(`${C.cyan}╰${'─'.repeat(w)}╯${C.reset}`);
  _log();
}

function config_summary({ count, seedRef, emailCount, headless, proxyEnabled, proxyCount }) {
  const items = [
    ['Accounts', `${emailCount} loaded`],
    ['Chain count', `${count}`],
    ['Seed ref', `${C.cyan}${seedRef}${C.reset}`],
    ['Headless', headless ? `${C.green}on${C.reset}` : `${C.yellow}off${C.reset}`],
    ['Proxy', proxyEnabled ? `${C.green}on${C.reset} (${proxyCount})` : `${C.dim}off${C.reset}`],
  ];
  _log(`  ${C.bold}Config${C.reset}`);
  for (let i = 0; i < items.length; i++) {
    const [k, v] = items[i];
    const prefix = i === items.length - 1 ? '  └─' : '  ├─';
    _log(`${C.gray}${prefix}${C.reset} ${k.padEnd(14)}${v}`);
  }
  _log();
}

function sectionStart(idx, total, email) {
  _accountStartTime = Date.now();
  const tag = `[${idx + 1}/${total}]`;
  _log(`${C.bold}${C.white}  ▸ ${tag}${C.reset}  ${C.cyan}${email}${C.reset}`);
  _log();
}

function step(name, status, detail = '') {
  const statusColor = status === 'ok' ? C.green : status === 'fail' ? C.red : C.yellow;
  const icon = status === 'ok' ? '✓' : status === 'fail' ? '✗' : '◌';
  const dots = '.'.repeat(Math.max(1, 22 - name.length));
  const detailStr = detail ? ` ${C.dim}${detail}${C.reset}` : '';
  _log(`    ${C.gray}${name}${C.reset} ${C.dim}${dots}${C.reset} ${statusColor}${icon}${C.reset}${detailStr}`);
}

function sectionEnd(ok, refCode, apiKey) {
  const dur = elapsed(_accountStartTime);
  if (ok) {
    const parts = [];
    if (refCode) parts.push(`${C.cyan}ref:${refCode}${C.reset}`);
    if (apiKey) parts.push(`${C.dim}key:${apiKey.substring(0, 12)}...${C.reset}`);
    _log();
    _log(`    ${C.green}${C.bold}✓${C.reset} ${C.green}Done${C.reset} ${C.dim}${dur}${C.reset}  ${parts.join('  ')}`);
  } else {
    _log();
    _log(`    ${C.red}${C.bold}✗${C.reset} ${C.red}Failed${C.reset} ${C.dim}${dur}${C.reset}`);
  }
  _log();
  _log(`  ${C.gray}${line(56, '·')}${C.reset}`);
  _log();
}

function progressBar(current, total) {
  const filled = Math.round((current / total) * BAR_LEN);
  const empty = BAR_LEN - filled;
  const pct = Math.round((current / total) * 100);
  return `${C.green}${BAR_FILL.repeat(filled)}${C.gray}${BAR_EMPTY.repeat(empty)}${C.reset} ${C.bold}${String(pct).padStart(3)}%${C.reset}`;
}

function summary({ okCount, failCount, total, startTime, results }) {
  const dur = elapsed(startTime);
  const w = 58;

  _log(`${C.cyan}╭${'─'.repeat(w)}╮${C.reset}`);
  _log(`${C.cyan}│${C.reset}${C.bold}${C.white}  📊 Summary${C.reset}${' '.repeat(w - 13)}${C.cyan}│${C.reset}`);
  _log(`${C.cyan}├${'─'.repeat(w)}┤${C.reset}`);

  const rows = [
    ['Total', `${total}`, C.white],
    ['Success', `${okCount}`, C.green],
    ['Failed', `${failCount}`, failCount > 0 ? C.red : C.dim],
    ['Duration', dur, C.cyan],
  ];
  for (const [k, v, c] of rows) {
    const line = `  ${k.padEnd(14)}${c}${C.bold}${v}${C.reset}`;
    const pad = Math.max(0, w - 2 - k.length - 14 - v.length - 10);
    _log(`${C.cyan}│${C.reset}${line}${' '.repeat(Math.max(1, pad))}${C.cyan}│${C.reset}`);
  }

  // Show result refs
  const refs = (results || []).filter(r => r.ok && r.refCode).map(r => r.refCode);
  if (refs.length > 0) {
    _log(`${C.cyan}├${'─'.repeat(w)}┤${C.reset}`);
    const refLine = `  Chain refs      ${C.cyan}${refs.join(' → ')}${C.reset}`;
    const rp = Math.max(0, w - refLine.length + (C.cyan.length + C.reset.length) * 2 + 10);
    _log(`${C.cyan}│${C.reset}${refLine}${' '.repeat(Math.max(1, rp))}${C.cyan}│${C.reset}`);
  }

  _log(`${C.cyan}╰${'─'.repeat(w)}╯${C.reset}`);
  _log();
  _log(`  ${C.dim}Results saved to ${C.under}output/chain-result.txt${C.reset}`);
  _log();
}

function success(msg) { _log(`\n  ${C.green}${C.bold}✅ ${msg}${C.reset}\n`); }
function error(msg) { _log(`\n  ${C.red}${C.bold}❌ ${msg}${C.reset}\n`); }
function info(msg) { _log(`  ${C.dim}${msg}${C.reset}`); }
function divider() { _log(`\n  ${C.gray}${line(56, '─')}${C.reset}\n`); }

function startSpinner(text) {
  hideCursor();
  _spinnerIdx = 0;
  _spinnerTimer = setInterval(() => {
    clearLine();
    process.stdout.write(`  ${C.cyan}${SPINNER[_spinnerIdx % SPINNER.length]}${C.reset} ${text}`);
    _spinnerIdx++;
  }, 80);
}

function stopSpinner(finalText = '') {
  if (_spinnerTimer) {
    clearInterval(_spinnerTimer);
    _spinnerTimer = null;
  }
  clearLine();
  if (finalText) _log(`  ${finalText}`);
  showCursor();
}

export {
  C,
  banner,
  config_summary,
  sectionStart,
  step,
  sectionEnd,
  progressBar,
  summary,
  success,
  error,
  info,
  divider,
  startSpinner,
  stopSpinner,
  elapsed,
};
