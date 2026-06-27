/**
 * ChainRunner — reusable chain loop runner tanpa process.exit().
 * Emits events untuk integrasi bot Telegram / UI lainnya.
 *
 * Events:
 *   'start'    → { count, seedRef }
 *   'progress' → { idx, total, ok, email, refCode, apiKey, error }
 *   'done'     → { okCount, failCount, results[] }
 *   'stopped'  → { okCount, failCount, atIteration }
 *   'log'      → string (console replacement)
 */

import { EventEmitter } from 'events';
import { chromium } from 'playwright';
import { appendFileSync, existsSync } from 'fs';
import { join } from 'path';
import { MimoRegistration } from '../core/registration.js';
import { generateFingerprint, buildInitScript, buildExtraHeaders } from '../browser/fingerprint.js';
import { EmailList } from '../clients/email-list.js';

const PROXY_ERROR_PATTERN = /ERR_TUNNEL|ERR_PROXY|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang|timeout|NS_ERROR/i;

class ChainRunner extends EventEmitter {
  constructor(config, proxyManager, outputDir, emailList) {
    super();
    this.config = config;
    this.proxyManager = proxyManager;
    this.emailList = emailList;
    this.outputDir = outputDir || join(import.meta.dirname || '.', '..', '..', 'output');
    this.outputFile = join(this.outputDir, 'chain-result.txt');
    this.failLog = join(this.outputDir, 'chain-fail.log');
    this._aborted = false;
    this._running = false;
  }

  get running() { return this._running; }

  stop() {
    this._aborted = true;
    this.emit('log', '⏹ Stop requested — finishing current iteration...');
  }

  async start({ count, seedRef }) {
    if (this._running) {
      this.emit('log', '⚠ Chain is already running');
      return;
    }

    // Limit count to available emails
    if (this.emailList) {
      const available = this.emailList.remaining;
      if (available <= 0) {
        this.emit('log', '❌ No emails remaining in list');
        return;
      }
      if (count > available) {
        this.emit('log', `⚠ Requested ${count} but only ${available} emails remaining. Limiting.`);
        count = available;
      }
    }

    this._aborted = false;
    this._running = true;

    const results = [];
    let currentRef = seedRef;
    let okCount = 0, failCount = 0;

    this.emit('start', { count, seedRef });

    for (let i = 0; i < count && !this._aborted; i++) {
      const result = await this._runIteration(i, count, currentRef);

      if (result.ok) {
        okCount++;
        results.push(result);
        if (result.refCode) {
          currentRef = result.refCode;
        } else {
          this.emit('log', `⚠ Stopping — iteration ${i + 1} succeeded but no refCode captured`);
          break;
        }
      } else {
        failCount++;
        results.push(result);
        if (result.restricted) {
          this.emit('log', `⛔ Chain stopped: ${result.stopReason}`);
          break;
        }
        this.emit('log', `↻ Iteration failed, retrying with same seed ${currentRef}`);
      }

      if (i < count - 1 && !this._aborted) {
        const wait = 8000 + Math.floor(Math.random() * 6000);
        await new Promise(r => setTimeout(r, wait));
      }
    }

    this._running = false;

    if (this._aborted) {
      this.emit('stopped', { okCount, failCount, results });
    } else {
      this.emit('done', { okCount, failCount, results });
    }
  }

  async _runIteration(idx, total, currentRef) {
    // Get next account from email list
    if (!this.emailList || this.emailList.remaining <= 0) {
      return { ok: false, idx, total, email: null, error: 'No emails remaining' };
    }
    const account = this.emailList.getNext();

    const iterConfig = JSON.parse(JSON.stringify(this.config));
    iterConfig.xiaomi.inviteCode = currentRef;
    iterConfig.xiaomi.referralLink =
      `https://platform.xiaomimimo.com/?ref=${encodeURIComponent(currentRef)}`;

    const reg = new MimoRegistration(iterConfig);
    let refCode = null, apiKey = null;
    let currentProxy = null;

    try {
      const fp = generateFingerprint();
      reg.fingerprint = fp;

      currentProxy = null;
      if (this.proxyManager && this.proxyManager.count > 0) {
        currentProxy = this.proxyManager.getNext();
        if (currentProxy) {
          const hint = this.proxyManager.getFingerprintHint(this.config.proxy?.defaultCountry || 'US');
          fp.locale = hint.locale;
          fp.timezone = hint.timezone;
        }
      }

      reg.browser = await chromium.launch({
        headless: iterConfig.browser.headless,
        channel: 'chrome',
        args: [
          `--window-size=${fp.viewport.width},${fp.viewport.height}`,
          '--disable-blink-features=AutomationControlled',
        ],
      });

      const ctxOpts = {
        userAgent: fp.userAgent, viewport: fp.viewport,
        deviceScaleFactor: fp.deviceScaleFactor,
        locale: fp.locale, timezoneId: fp.timezone,
        screen: { width: fp.screen.width, height: fp.screen.height },
        extraHTTPHeaders: buildExtraHeaders(fp),
      };
      if (currentProxy) ctxOpts.proxy = currentProxy;

      const ctx = await reg.browser.newContext(ctxOpts);
      await ctx.addInitScript({ content: buildInitScript(fp) });
      reg.page = await ctx.newPage();

      const origScreenshot = reg.page.screenshot.bind(reg.page);
      reg.page.screenshot = async (opts = {}) => {
        const isError = opts.path && opts.path.includes('error');
        if (isError || iterConfig.browser.screenshots === true) return origScreenshot(opts);
        return Buffer.alloc(0);
      };

      // Navigate to referral link
      await reg.page.goto(iterConfig.xiaomi.referralLink, {
        waitUntil: 'networkidle', timeout: iterConfig.browser.timeout,
      });

      // Google sign-in + Xiaomi onboarding
      await reg.googleSignIn(account);
      await reg.xiaomiOnboard();

      // Post-registration — ACCOUNT_RESTRICTED / BALANCE_NOT_CREDITED are
      // non-blocking: log warning and continue to API key, ultraspeed, etc.
      try { await reg.redeemInviteCode(); } catch (e) {
        if (e.code === 'ACCOUNT_RESTRICTED' || e.code === 'BALANCE_NOT_CREDITED') {
          this.emit('log', `⚠ ${e.code}: ${e.message?.substring(0, 80)} — skipping redeem, continuing...`);
        }
      }

      try { apiKey = await reg.createApiKey(); } catch (e) {}
      try { await reg.fillUltraspeedForm(account.email); } catch (e) {}

      try {
        const captured = await reg.getReferralCode();
        if (captured && captured.toUpperCase() === currentRef.toUpperCase()) {
          refCode = null;
        } else {
          refCode = captured;
        }
      } catch (e) {}

      this._saveResult({ email: account.email, password: account.password, refCode, apiKey, invitedBy: currentRef });

      const result = { ok: true, idx, total, email: account.email, refCode, apiKey };
      this.emit('progress', result);
      return result;

    } catch (err) {
      if (currentProxy && this.proxyManager && PROXY_ERROR_PATTERN.test(err.message)) {
        this.proxyManager.reportFailure(currentProxy);
      }

      this._logFailed(account.email, err.message);

      const result = {
        ok: false, idx, total, email: account.email, error: err.message,
        restricted: err.code === 'ACCOUNT_RESTRICTED' || err.code === 'BALANCE_NOT_CREDITED',
        stopReason: err.code,
      };
      this.emit('progress', result);
      return result;
    } finally {
      if (reg.browser) await reg.browser.close().catch(() => {});
    }
  }

  _saveResult(row) {
    const line = [row.email, row.password, row.refCode || '', row.apiKey || '', row.invitedBy || ''].join(':') + '\n';
    if (!existsSync(this.outputFile)) {
      appendFileSync(this.outputFile, '# Chain loop results. Format: email:password:refCode:apiKey:invitedBy\n', 'utf8');
    }
    appendFileSync(this.outputFile, line, 'utf8');
  }

  _logFailed(email, error) {
    const line = `[${new Date().toISOString()}] ${email || 'unknown'}  | ${error}\n`;
    appendFileSync(this.failLog, line, 'utf8');
  }
}

export { ChainRunner };
