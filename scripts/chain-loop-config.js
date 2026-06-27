#!/usr/bin/env node
/**
 * Chain loop config: CLI args parsing + file I/O helpers.
 *
 * Cara pakai:
 *   node scripts/chain-loop.js --count 5
 *   node scripts/chain-loop.js --count 3 --seed HWPMXZ
 *   node scripts/chain-loop.js --count 10 --output chain.txt
 *
 * Output (chain-result.txt) format:
 *   email:password:refCode:apiKey:invitedBy
 */

import { readFileSync, appendFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ProxyManager } from '../src/browser/proxy.js';
import { EmailList } from '../src/clients/email-list.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Output dir bisa di-override via env var
const outputDir = process.env.HERMES_BOT_MIMO_CWD || join(__dirname, '..', 'output');

// Config path juga bisa di-override
const configPath = process.env.HERMES_BOT_MIMO_CONFIG || join(__dirname, '..', 'config', 'default.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

// ---- CLI args ---------------------------------------------------------

const args = process.argv.slice(2);

const countIdx = args.indexOf('--count');
const count = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) : 1;

const seedIdx = args.indexOf('--seed');
const seedRef = seedIdx !== -1 ? args[seedIdx + 1] : config.xiaomi.inviteCode;

const outputIdx = args.indexOf('--output');
const outputFile = outputIdx !== -1
  ? join(outputDir, args[outputIdx + 1])
  : join(outputDir, 'chain-result.txt');

const failLog = join(outputDir, 'chain-fail.log');

// ---- Email List -------------------------------------------------------

const emailListPath = config.emailList?.filePath
  ? join(__dirname, '..', config.emailList.filePath)
  : join(__dirname, '..', 'config', 'emails.txt');

const resultFilePath = join(outputDir, 'chain-result.txt');
const emailList = new EmailList(emailListPath, resultFilePath);

// ---- Proxy Manager ----------------------------------------------------

const proxyConfig = config.proxy || { enabled: false };
const proxyManager = proxyConfig.enabled && proxyConfig.proxyList?.length > 0
  ? new ProxyManager(proxyConfig.proxyList, {
      rotatePerAccount: proxyConfig.rotatePerAccount !== false,
      defaultCountry: proxyConfig.defaultCountry || 'US',
      maxRetries: proxyConfig.maxRetries ?? 3,
    })
  : null;

// ---- File helpers -----------------------------------------------------

function saveResult(row) {
  if (!existsSync(outputFile)) {
    appendFileSync(
      outputFile,
      '# Chain loop results. Format: email:password:refCode:apiKey:invitedBy\n',
      'utf8'
    );
  }
  const line = [
    row.email,
    row.password,
    row.refCode || '',
    row.apiKey || '',
    row.invitedBy || '',
  ].join(':') + '\n';
  appendFileSync(outputFile, line, 'utf8');
}

function logFail(email, error) {
  const line = `[${new Date().toISOString()}] ${email || 'unknown'}  | ${error}\n`;
  appendFileSync(failLog, line, 'utf8');
}

export { config, saveResult, logFail, count, seedRef, outputFile, failLog, proxyManager, emailList };
