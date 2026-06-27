#!/usr/bin/env node
/**
 * MiMo Chain Bot — Telegram admin bot.
 *
 * Run:
 *   node src/bot/index.js
 *
 * Manage Xiaomi MiMo automation via Telegram inline keyboard UI.
 * Admin-only: hanya user ID yang di-whitelist di config yang bisa akses.
 */

import { Telegraf } from 'telegraf';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ProxyManager } from '../browser/proxy.js';
import { ChainRunner } from '../runner/chain-runner.js';
import { EmailList } from '../clients/email-list.js';
import { adminOnly } from './admin.js';
import {
  startCommand, chainCommand, chainStartAction, stopCommand, stopConfirmAction, setRunner,
} from './commands/chain.js';
import {
  proxyMenuCommand, proxyListAction, proxyAddAction, proxyDelMenuAction, proxyDelAction,
  handleProxyText, setProxyManager,
} from './commands/proxy.js';
import {
  configShowCommand, configEditRefAction, configEditApiKeyAction,
  configToggleProxyAction, configToggleHeadlessAction, handleConfigText, setConfig,
} from './commands/config.js';
import { exportCommand, setOutputDir } from './commands/export.js';
import { mainMenu } from './ui/keyboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---- Load config -------------------------------------------------------

const configPath = process.env.HERMES_BOT_MIMO_CONFIG
  || join(__dirname, '..', '..', 'config', 'default.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

function saveConfig() {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

// ---- Init services -----------------------------------------------------

const outputDir = process.env.HERMES_BOT_MIMO_CWD || join(__dirname, '..', '..', 'output');

// ---- Email List -------------------------------------------------------

const emailListPath = config.emailList?.filePath
  ? join(__dirname, '..', '..', config.emailList.filePath)
  : join(__dirname, '..', '..', 'config', 'emails.txt');

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

const runner = new ChainRunner(config, proxyManager, outputDir, emailList);

// Set global references di command modules
setRunner(runner);
setProxyManager(proxyManager, configPath);
setConfig(config, configPath);
setOutputDir(outputDir);

// ---- Bot setup ---------------------------------------------------------

const token = config.telegram?.botToken;
if (!token || token === 'YOUR_BOT_TOKEN') {
  console.error('❌ Bot token not configured. Set telegram.botToken in config/default.json');
  process.exit(1);
}

const bot = new Telegraf(token);

// Admin middleware
bot.use(adminOnly(config));

// ---- Commands ----------------------------------------------------------

bot.command('start', startCommand);
bot.command('chain', chainCommand);
bot.command('stop', stopCommand);
bot.command('proxies', proxyMenuCommand);
bot.command('export', exportCommand);
bot.command('config', configShowCommand);

// ---- Inline actions: Chain ---------------------------------------------

bot.action(/^chain_menu$/, chainCommand);
bot.action(/^chain_(\d+)$/, chainStartAction);
bot.action(/^stop_btn$/, stopCommand);
bot.action(/^stop_confirm$/, stopConfirmAction);

// ---- Inline actions: Proxy ---------------------------------------------

bot.action(/^proxy_menu$/, proxyMenuCommand);
bot.action(/^proxy_list$/, proxyListAction);
bot.action(/^proxy_page_(\d+)$/, proxyListAction);
bot.action(/^proxy_add$/, proxyAddAction);
bot.action(/^proxy_del_menu$/, proxyDelMenuAction);
bot.action(/^proxy_del_(\d+)$/, (ctx) => proxyDelAction(ctx, config));

// ---- Inline actions: Config --------------------------------------------

bot.action(/^config_menu$/, configShowCommand);
bot.action(/^config_edit_ref$/, configEditRefAction);
bot.action(/^config_edit_apikey$/, configEditApiKeyAction);
bot.action(/^config_toggle_proxy$/, (ctx) => configToggleProxyAction(ctx, proxyManager));
bot.action(/^config_toggle_headless$/, configToggleHeadlessAction);

// ---- Inline actions: Export --------------------------------------------

bot.action(/^export_btn$/, exportCommand);

// ---- Inline actions: Navigation ----------------------------------------

bot.action('menu', startCommand);
bot.action('proxy_nop', (ctx) => ctx.answerCbQuery());  // informational buttons

// ---- Text message handler (proxy add + config edit) --------------------

bot.on('text', async (ctx, next) => {
  // Check if editing config
  const configHandled = await handleConfigText(ctx);
  if (configHandled) return;

  // Check if adding proxy
  if (proxyManager._waitingForProxy === ctx.chat.id) {
    delete proxyManager._waitingForProxy;
    await handleProxyText(ctx, config);
    return;
  }

  // Fallback
  return next();
});

// ---- Launch ------------------------------------------------------------

bot.launch().then(() => {
  console.log('🤖 MiMo Chain Bot started');
  console.log(`   Config  : ${configPath}`);
  console.log(`   Output  : ${outputDir}`);
  console.log(`   Proxies : ${proxyManager ? proxyManager.count + ' in pool' : 'disabled'}`);
  console.log(`   Admins  : ${(config.telegram?.adminIds || []).join(', ')}`);
});

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('\nShutting down...');
  if (runner.running) runner.stop();
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  if (runner.running) runner.stop();
  bot.stop('SIGTERM');
});
