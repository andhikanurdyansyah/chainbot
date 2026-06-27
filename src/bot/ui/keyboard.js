/**
 * Inline keyboard builders untuk Telegram bot.
 * Semua tombol dikumpulin disini biar gampang maintain.
 */

import { Markup } from 'telegraf';

// ---- Main Menu -------------------------------------------------------

function mainMenu(proxyStatus, proxyEnabled = true) {
  const proxyIcon = proxyEnabled ? '🟢' : '🔴';
  const proxyText = proxyStatus
    ? `${proxyIcon} Proxies: ${proxyStatus.healthy}/${proxyStatus.total}`
    : `${proxyIcon} Proxy ${proxyEnabled ? 'ON' : 'OFF'}`;
  return Markup.inlineKeyboard([
    [Markup.button.callback('▶ Run Chain', 'chain_menu'), Markup.button.callback('⏹ Stop', 'stop_btn')],
    [Markup.button.callback(proxyText, 'proxy_menu'), Markup.button.callback('⚙ Config', 'config_menu')],
    [Markup.button.callback('📤 Export', 'export_btn')],
  ]);
}

// ---- Chain Run: pilih count ------------------------------------------

function chainCountMenu(seedRef) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('1', 'chain_1'),
      Markup.button.callback('3', 'chain_3'),
      Markup.button.callback('5', 'chain_5'),
      Markup.button.callback('10', 'chain_10'),
    ],
    [
      Markup.button.callback('20', 'chain_20'),
      Markup.button.callback('50', 'chain_50'),
    ],
    [Markup.button.callback('🔙 Back', 'menu')],
  ]);
}

function stopConfirmMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⚠ Yes, Stop Chain', 'stop_confirm')],
    [Markup.button.callback('🔙 Cancel', 'menu')],
  ]);
}

// ---- Proxy Management ------------------------------------------------

function proxyMenu(proxyManager) {
  const s = proxyManager ? proxyManager.status() : { total: 0, healthy: 0, dead: 0 };
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Add Proxy', 'proxy_add'), Markup.button.callback('➖ Delete Proxy', 'proxy_del_menu')],
    [Markup.button.callback('📋 List All', 'proxy_list')],
    [Markup.button.callback('🔙 Back', 'menu')],
  ]);
}

function proxyListKeyboard(proxyManager, page = 0) {
  if (!proxyManager) return Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'proxy_menu')]]);

  const perPage = 8;
  const proxies = proxyManager.proxies;
  const total = proxies.length;
  const start = page * perPage;
  const end = Math.min(start + perPage, total);
  const buttons = [];

  for (let i = start; i < end; i++) {
    const p = proxies[i];
    const status = p.failures >= 3 ? '🔴' : '🟢';
    const ip = p.config?.server?.replace('http://', '').split(':')[0] || '?';
    buttons.push([Markup.button.callback(`${status} ${ip}`, `proxy_nop`)]);  // info only
  }

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('◀ Prev', `proxy_page_${page - 1}`));
  if (end < total) nav.push(Markup.button.callback('Next ▶', `proxy_page_${page + 1}`));
  if (nav.length) buttons.push(nav);

  buttons.push([Markup.button.callback('🔙 Back', 'proxy_menu')]);
  return Markup.inlineKeyboard(buttons);
}

function proxyAddPrompt() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔙 Cancel', 'proxy_menu')],
  ]);
}

function proxyDeleteList(proxyManager) {
  if (!proxyManager) return Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'proxy_menu')]]);

  const buttons = proxyManager.proxies.slice(0, 10).map((p, i) => {
    const ip = p.config?.server?.replace('http://', '').split(':')[0] || `#${i}`;
    const status = p.failures >= 3 ? '🔴' : '🟢';
    return [Markup.button.callback(`${status} ${ip}`, `proxy_del_${i}`)];
  });

  buttons.push([Markup.button.callback('🔙 Back', 'proxy_menu')]);
  return Markup.inlineKeyboard(buttons);
}

// ---- Config Editor ---------------------------------------------------

function configMenu(config) {
  const x = config.xiaomi;
  const proxyEnabled = config.proxy?.enabled !== false;
  const headless = config.browser?.headless !== false;
  return Markup.inlineKeyboard([
    [Markup.button.callback(`✏ Ref: ${x.inviteCode}`, 'config_edit_ref')],
    [Markup.button.callback(`✏ API Key: ...${(config.captcha?.apiKey || '').slice(-4)}`, 'config_edit_apikey')],
    [
      Markup.button.callback(`${proxyEnabled ? '🟢' : '🔴'} Proxy: ${proxyEnabled ? 'ON' : 'OFF'}`, 'config_toggle_proxy'),
      Markup.button.callback(`${headless ? '🟢' : '🔴'} Headless: ${headless ? 'ON' : 'OFF'}`, 'config_toggle_headless'),
    ],
    [Markup.button.callback('🔙 Back', 'menu')],
  ]);
}

function configBack() {
  return Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'config_menu')]]);
}

// ---- General ---------------------------------------------------------

function backOnly(target = 'menu') {
  return Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', target)]]);
}

export {
  mainMenu,
  chainCountMenu,
  stopConfirmMenu,
  proxyMenu,
  proxyListKeyboard,
  proxyAddPrompt,
  proxyDeleteList,
  configMenu,
  configBack,
  backOnly,
};
