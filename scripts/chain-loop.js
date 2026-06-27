#!/usr/bin/env node

import { ChainRunner } from '../src/runner/chain-runner.js';
import { config, count, seedRef, proxyManager, emailList } from './chain-loop-config.js';
import {
  banner, config_summary, sectionStart, step, sectionEnd,
  summary, error, elapsed, C,
} from './cli-renderer.js';

const startTime = Date.now();
const runner = new ChainRunner(config, proxyManager, undefined, emailList);

// --- Show banner BEFORE suppressing console.log ---

banner('2.1.0');
config_summary({
  count,
  seedRef,
  emailCount: emailList.remaining,
  headless: config.browser.headless,
  proxyEnabled: !!proxyManager,
  proxyCount: proxyManager?.count || 0,
});

console.log(`${C.gray}  ${'─'.repeat(56)}${C.reset}`);
console.log();

// --- Intercept registration logs → show clean steps ---

const _origLog = console.log;
const _origError = console.error;
const _logBuffer = [];
let _accountIdx = 0;
let _accountEmail = '';

function onLog(msg) {
  const m = msg || '';
  _logBuffer.push(m);

  // Capture email
  const em = m.match(/Email:\s*(\S+@\S+)/);
  if (em) _accountEmail = em[1];

  // Detect step starts from registration.js method logs
  if (m.includes('Waiting for sign-in page') && !m._seen) {
    sectionStart(_accountIdx, count, _accountEmail || `Account #${_accountIdx + 1}`);
    step('Browser', 'ok');
    step('Google Sign-In', 'spin');
  }
  else if (m.includes('Password submitted') || m.includes('Navigated to Xiaomi directly')) {
    step('Google Sign-In', 'ok');
  }
  else if (m.includes('Starting Xiaomi onboarding')) {
    step('Xiaomi Onboard', 'spin');
  }
  else if (m.includes('onboarding completed') || m.includes('Already on platform')) {
    step('Xiaomi Onboard', 'ok');
  }
  else if (m.includes('Redeeming invite code') || m.includes('[Step 7.6]')) {
    step('Redeem invite', 'spin');
  }
  else if (m.includes('Balance verified')) {
    step('Redeem invite', 'ok', m.match(/\+\$[\d.]+/)?.[0] || '');
  }
  else if (m.includes('Balance did NOT')) {
    step('Redeem invite', 'fail', 'not credited');
  }
  else if (m.includes('Creating API Key') || m.includes('[Step 7.7]')) {
    step('API Key', 'spin');
  }
  else if (m.includes('Extracted API Key')) {
    step('API Key', 'ok');
  }
  else if (m.includes('Failed to create API Key')) {
    step('API Key', 'fail');
  }
  else if (m.includes('Navigating to Ultraspeed') || m.includes('[Step 7.5]')) {
    step('Ultraspeed', 'spin');
  }
  else if (m.includes('After Submit Text') || (m.includes('Ultraspeed') && m.includes('submitted'))) {
    step('Ultraspeed', 'ok');
  }
  else if (m.includes('Failed Ultraspeed')) {
    step('Ultraspeed', 'fail');
  }
  else if (m.includes('Scanning for') && m.includes('ref')) {
    step('Referral Code', 'spin');
  }
  else if (m.includes('REGISTRATION SUCCESSFUL')) {
    step('Complete', 'ok');
  }
  else if (m.includes('REGISTRATION FAILED')) {
    step('Complete', 'fail');
  }
  else if (m.includes('ACCOUNT_RESTRICTED')) {
    _origLog();
    _origLog(`    ${C.red}⛔ Account restricted${C.reset}`);
  }
}

console.log = (...args) => onLog(args.join(' '));
console.error = (...args) => _logBuffer.push(args.join(' '));

// --- ChainRunner events ---

runner.on('progress', (r) => {
  _accountEmail = r.email || _accountEmail;
  if (r.ok) {
    sectionEnd(true, r.refCode, r.apiKey);
  } else {
    step('Result', 'fail', r.error?.substring(0, 50));
    sectionEnd(false);
  }
  _accountIdx++;
  _accountEmail = '';
});

runner.on('log', (msg) => {
  if (msg.includes('Stopping') || msg.includes('stopped')) {
    _origLog(`\n  ${C.yellow}⏹ ${msg}${C.reset}`);
  }
});

runner.on('done', ({ okCount, failCount, results }) => {
  console.log = _origLog;
  console.error = _origError;
  summary({ okCount, failCount, total: count, startTime, results });
  process.exit(okCount > 0 ? 0 : 1);
});

runner.on('stopped', ({ okCount, failCount, results }) => {
  console.log = _origLog;
  console.error = _origError;
  _origLog(`\n  ${C.yellow}⏹ Chain stopped by user${C.reset}\n`);
  summary({ okCount, failCount, total: count, startTime, results });
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log = _origLog;
  console.error = _origError;
  _origLog(`\n  ${C.yellow}⏹ Stopping...${C.reset}`);
  runner.stop();
});
process.on('SIGTERM', () => runner.stop());

runner.start({ count, seedRef }).catch(err => {
  console.log = _origLog;
  console.error = _origError;
  error(`Fatal: ${err.message}`);
  process.exit(1);
});
