/**
 * Xiaomi MiMo Registration — Core class.
 *
 * Menggabungkan MimoRegistration + getReferralCode (sebelumnya di extras.js).
 * Tidak pakai prototype extension lagi.
 */

import { chromium } from 'playwright';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';
import { generateFingerprint, buildInitScript, buildExtraHeaders } from '../browser/fingerprint.js';
import { humanFill, humanFillLocator, humanClick, humanType, humanDelay } from '../browser/human.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Common English words yg sering ke-match regex code uppercase.
const REF_BLACKLIST = new Set([
  'YOUR', 'CODE', 'INVITE', 'REFERRAL', 'ENTER', 'COPY', 'SHARE',
  'EARN', 'NULL', 'NONE', 'TRUE', 'FALSE', 'EMPTY',
]);

/**
 * Validate ref code — Xiaomi MiMo invite codes are always EXACTLY 6 chars
 * alphanumeric uppercase.
 */
function isValidRefCode(s) {
  if (!s) return false;
  const up = String(s).toUpperCase().trim();
  if (up.length !== 6) return false;
  if (REF_BLACKLIST.has(up)) return false;
  return /^[A-Z0-9]{6}$/.test(up);
}


function generateRandomPassword() {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const special = '@!#';
  const all = upper + lower + digits;
  let pwd = '';
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  pwd += special[Math.floor(Math.random() * special.length)];
  for (let i = 0; i < 8; i++) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }
  return pwd;
}


class MimoRegistration {
  constructor(config) {
    this.config = config;
    this.browser = null;
    this.page = null;
    this._mimoPassword = null;
  }
  async run(account) {
    try {
      console.log('═'.repeat(70));
      console.log('   Xiaomi MiMo Auto-Registration (Google OAuth)');
      console.log('═'.repeat(70));
      console.log();

      // Step 1: Launch browser with randomized fingerprint
      console.log('[Step 1/5] Launching browser...');
      const fp = generateFingerprint();
      this.fingerprint = fp;
      console.log(`  ↳ UA       : Chrome ${fp.chromeMajor} on Win64`);
      console.log(`  ↳ Viewport : ${fp.viewport.width}x${fp.viewport.height} (DPR ${fp.deviceScaleFactor})`);
      console.log(`  ↳ Locale   : ${fp.locale}  TZ: ${fp.timezone}`);

      this.browser = await chromium.launch({
        headless: this.config.browser.headless,
        channel: 'chrome',
        args: [
          `--window-size=${fp.viewport.width},${fp.viewport.height}`,
          '--disable-blink-features=AutomationControlled',
        ],
      });

      const context = await this.browser.newContext({
        userAgent: fp.userAgent,
        viewport: fp.viewport,
        deviceScaleFactor: fp.deviceScaleFactor,
        locale: fp.locale,
        timezoneId: fp.timezone,
        screen: { width: fp.screen.width, height: fp.screen.height },
        extraHTTPHeaders: buildExtraHeaders(fp),
      });

      await context.addInitScript({ content: buildInitScript(fp) });
      this.page = await context.newPage();

      const originalScreenshot = this.page.screenshot.bind(this.page);
      this.page.screenshot = async (options = {}) => {
        const isErrorScreenshot = options.path && options.path.includes('error');
        if (isErrorScreenshot || this.config.browser.screenshots === true) {
          return originalScreenshot(options);
        }
        return Buffer.alloc(0);
      };
      this.page.on('console', msg => {
        const txt = msg.text();
        if (txt.includes('error') || txt.includes('failed') || txt.includes('Success') || txt.includes('warn')) {
          console.log(`  [Browser Console] ${msg.type()}: ${txt.substring(0, 150)}`);
        }
      });
      this.page.on('pageerror', err => console.log(`  [Browser Error] ${err.message}`));
      console.log('✓ Browser launched');
      console.log();

      // Step 2: Navigate to registration page via referral link
      console.log('[Step 2/5] Opening referral link...');
      await this.page.goto(this.config.xiaomi.referralLink, {
        waitUntil: 'networkidle',
        timeout: this.config.browser.timeout
      });
      console.log('✓ Page loaded');
      console.log();

      // Step 3: Google Sign-In flow
      console.log('[Step 3/5] Google Sign-In...');
      await this.googleSignIn(account);
      console.log('✓ Google Sign-In completed');
      console.log();

      // Step 4: Xiaomi onboarding (post-Google-auth setup)
      console.log('[Step 4/5] Xiaomi onboarding...');
      await this.xiaomiOnboard();
      console.log('✓ Xiaomi onboarding completed');
      console.log();

      // Step 5: Post-registration actions
      console.log('[Step 5/5] Post-registration actions...');

      try {
        await this.redeemInviteCode();
      } catch (inviteErr) {
        console.log('  ! Failed to redeem invite code:', inviteErr.message);
      }

      let apiKey = null;
      try {
        apiKey = await this.createApiKey();
      } catch (keyErr) {
        console.log('  ! Failed to create API Key:', keyErr.message);
      }

      try {
        await this.fillUltraspeedForm(account.email);
      } catch (formErr) {
        console.log('  ! Failed Ultraspeed form:', formErr.message);
      }

      let refCode = null;
      try {
        refCode = await this.getReferralCode();
      } catch (refErr) {
        console.log('  ! Failed to get referral code:', refErr.message);
      }

      console.log('═'.repeat(70));
      console.log('✅ REGISTRATION SUCCESSFUL');
      console.log('═'.repeat(70));
      console.log(`Email: ${account.email}`);
      console.log(`Google Password: ${account.password}`);
      console.log(`MiMo Password: ${this._mimoPassword}`);
      console.log(`Ref Code: ${refCode || 'Not captured'}`);
      console.log(`API Key: ${apiKey || 'Not created'}`);
      console.log();

      return {
        email: account.email,
        password: account.password,
        mimoPassword: this._mimoPassword,
        refCode,
        apiKey
      };

    } catch (error) {
      console.error();
      console.error('═'.repeat(70));
      console.error('❌ REGISTRATION FAILED');
      console.error('═'.repeat(70));
      console.error(error.message);
      console.error();

      if (this.page) {
        try {
          const screenshotPath = join(__dirname, 'mimo-error.png');
          await this.page.screenshot({ path: screenshotPath, fullPage: true });
          console.error(`Screenshot saved: ${screenshotPath}`);
        } catch (e) {
          console.error('Could not save screenshot:', e.message);
        }
      }

      throw error;
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }
  }

  async googleSignIn(account) {
    // Wait for Xiaomi sign-in page to fully load after referral redirect
    console.log('  Waiting for sign-in page to load...');
    let currentUrl = this.page.url();
    for (let i = 0; i < 15; i++) {
      await this.page.waitForTimeout(1500);
      const newUrl = this.page.url();
      if (newUrl === currentUrl && newUrl.includes('account.xiaomi.com')) break;
      if (newUrl !== currentUrl) {
        console.log(`  ↳ Redirect: ${newUrl.substring(0, 80)}...`);
        currentUrl = newUrl;
      }
    }
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    console.log(`  ✓ Page stable: ${this.page.url().substring(0, 80)}...`);

    // Accept cookies if present
    try {
      const cookieBtn = this.page.locator('button:has-text("Accept cookies"), button:has-text("Accept All")').first();
      if (await cookieBtn.count() > 0 && await cookieBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cookieBtn.click({ timeout: 4000 });
        console.log('  ✓ Accepted cookies');
        await this.page.waitForTimeout(2000);
      }
    } catch (e) {}

    // Step 1: Check "I've read and agreed..." checkbox on sign-in page
    console.log('  Checking terms agreement checkbox...');
    const checkedTerms = await this.page.evaluate(() => {
      // Try Ant Design checkbox wrapper first
      const wrappers = Array.from(document.querySelectorAll('.ant-checkbox-wrapper'));
      for (const w of wrappers) {
        const txt = (w.textContent || '').toLowerCase();
        if (txt.includes('agreed') || txt.includes('user agreement') || txt.includes('privacy policy')) {
          w.click();
          const input = w.querySelector('.ant-checkbox-input, input[type="checkbox"]');
          return input ? input.checked : true;
        }
      }
      // Fallback: any checkbox near terms text
      const allLabels = Array.from(document.querySelectorAll('label, span, div'));
      for (const label of allLabels) {
        const txt = (label.textContent || '').toLowerCase();
        if (txt.includes('agreed') && txt.includes('xiaomi')) {
          const cb = label.querySelector('input[type="checkbox"]') || label.previousElementSibling;
          if (cb && cb.type === 'checkbox') { cb.click(); return cb.checked; }
          // Maybe the wrapper itself is clickable
          label.click();
          return true;
        }
      }
      // Last resort: first visible checkbox
      const cb = document.querySelector('input[type="checkbox"]');
      if (cb && cb.offsetHeight > 0) { cb.click(); return cb.checked; }
      return false;
    });
    console.log(`  ✓ Terms checkbox: ${checkedTerms ? 'checked' : 'attempted'}`);
    await humanDelay(300, 600);

    // Step 2: Click "Sign in with Google"
    console.log('  Clicking "Sign in with Google"...');
    let authPage = null;
    const googleSelectors = [
      'button:has-text("Sign in with Google")',
      'a:has-text("Sign in with Google")',
      '[class*="google"]',
      'button:has-text("Google")',
    ];

    let googleClicked = false;
    for (const sel of googleSelectors) {
      try {
        const el = this.page.locator(sel).first();
        if (await el.count() > 0 && await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          // Try popup first, then fallback to same-page redirect
          try {
            const [popup] = await Promise.all([
              this.page.waitForEvent('popup', { timeout: 8000 }),
              el.click({ timeout: 5000 }),
            ]);
            authPage = popup;
            console.log('  ✓ Google sign-in opened in popup');
          } catch (popupErr) {
            // No popup — redirect happened on same page
            authPage = this.page;
            console.log('  ✓ Google sign-in redirected (same page)');
          }
          googleClicked = true;
          break;
        }
      } catch (e) {}
    }

    if (!googleClicked) {
      // DOM eval fallback
      const clicked = await this.page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('button, a, div, span'));
        const target = all.find(el => {
          const txt = (el.textContent || '').toLowerCase();
          return txt.includes('sign in with google') && el.offsetHeight > 0;
        });
        if (target) { target.click(); return true; }
        return false;
      });
      if (clicked) {
        console.log('  ✓ Clicked Google button (DOM eval)');
        await this.page.waitForTimeout(3000);
        // Check if a popup opened
        try {
          const pages = this.page.context().pages();
          authPage = pages.length > 1 ? pages[pages.length - 1] : this.page;
        } catch (e) {
          authPage = this.page;
        }
      } else {
        throw new Error('"Sign in with Google" button not found');
      }
    }

    if (!authPage) authPage = this.page;

    // Step 3: Google Sign-In — enter email
    console.log('  Waiting for Google sign-in page...');
    await authPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const emailInput = await authPage.waitForSelector(
      'input[type="email"], input[id="identifierId"]',
      { timeout: 15000 }
    ).catch(() => null);

    if (emailInput) {
      console.log('  Entering Google email...');
      await emailInput.fill(account.email);
      await humanDelay(200, 500);

      // Click Next
      const identifierNext = await authPage.$('#identifierNext');
      if (identifierNext) {
        await identifierNext.click();
      } else {
        await authPage.keyboard.press('Enter');
      }
      console.log('  ✓ Email submitted');
      await authPage.waitForTimeout(3000);
    } else {
      console.log('  ! Google email input not found — might be account chooser');
      // Handle "Choose an account" screen if already signed in
      try {
        const accountChoice = authPage.locator(`text="${account.email}"`).first();
        if (await accountChoice.count() > 0) {
          await accountChoice.click();
          console.log('  ✓ Selected existing Google account');
          await authPage.waitForTimeout(3000);
        }
      } catch (e) {}
    }

    // Step 4: Google — enter password
    // Google has TWO password fields: input[name="hiddenPassword"] (hidden)
    // and input[name="Passwd"] (visible). We must target the visible one.
    console.log('  Entering Google password...');
    try {
      const pwdInput = await authPage.waitForSelector(
        'input[name="Passwd"]:not([aria-hidden="true"]), input[type="password"]:not([aria-hidden="true"])',
        { state: 'visible', timeout: 10000 }
      );
      await pwdInput.fill(account.password);
      await humanDelay(200, 500);

      const passwordNext = await authPage.$('#passwordNext');
      if (passwordNext) {
        await passwordNext.click();
      } else {
        await authPage.keyboard.press('Enter');
      }
      console.log('  ✓ Password submitted');
    } catch (pwdErr) {
      console.log(`  ! Password input error: ${pwdErr.message}`);
    }
    await authPage.waitForTimeout(3000);

    // Step 5: Handle ALL Google intermediate pages until back on Xiaomi
    // Pages we might hit after password:
    //   - "I Understand" (security prompt)
    //   - "Confirm recovery email" 
    //   - Workspace Terms of Service speedbump
    //   - OAuth consent page ("Sign in to [app] with Google")
    console.log('  Handling Google intermediate pages...');

    const isXiaomiUrl = (url) => {
      try {
        const host = new URL(url).hostname;
        return host.includes('xiaomi.com') || host.includes('xiaomimimo.com');
      } catch { return false; }
    };

    const isGoogleUrl = (url) => {
      try {
        const host = new URL(url).hostname;
        return host.includes('google.com') || host.includes('googleapis.com');
      } catch { return false; }
    };

    // Use the actual page (not popup, since Google uses same-page redirect)
    const activePage = authPage !== this.page ? authPage : this.page;

    for (let attempt = 0; attempt < 20; attempt++) {
      let currentUrl;
      try { currentUrl = activePage.url(); } catch { break; }

      // If URL is on Xiaomi's domain, we're done
      if (isXiaomiUrl(currentUrl)) {
        console.log('  ✓ Redirected to Xiaomi');
        break;
      }

      // If Chrome error page, try navigating to Xiaomi directly
      if (currentUrl.startsWith('chrome-error')) {
        console.log('  ! Chrome error — trying direct navigation to Xiaomi...');
        try {
          await this.page.goto('https://platform.xiaomimimo.com/console/balance', {
            waitUntil: 'networkidle', timeout: 30000,
          });
          if (isXiaomiUrl(this.page.url())) {
            console.log('  ✓ Navigated to Xiaomi directly');
            break;
          }
        } catch (e) {
          console.log(`  ! Direct navigation failed: ${e.message}`);
        }
        break;
      }

      console.log(`  [Google page ${attempt + 1}] ${currentUrl.substring(0, 80)}...`);

      // If on OAuth consent page, wait for content to finish loading
      if (currentUrl.includes('signin/oauth') || currentUrl.includes('consent')) {
        console.log('  OAuth consent page — waiting for content to load...');
        try {
          await activePage.waitForFunction(() => {
            const text = document.body.innerText || '';
            const hasAction = text.includes('Lanjutkan') || text.includes('Continue') ||
                              text.includes('Allow') || text.includes('Cancel') ||
                              text.includes('Batal') || text.includes('I understand');
            const isLoading = text.includes('Memuat') && !hasAction;
            return !isLoading;
          }, { timeout: 20000 });
          console.log('  ✓ Consent page content loaded');
          await activePage.waitForTimeout(1500);
        } catch (e) {
          console.log('  ! Consent page still loading after timeout');
        }
      }

      let clickedSomething = false;

      // Step A: check for checkbox that needs ticking (speedbump/consent pages)
      try {
        const hasUncheckedBox = await activePage.evaluate(() => {
          const cbs = document.querySelectorAll('input[type="checkbox"]');
          for (const cb of cbs) {
            if (!cb.checked && cb.offsetHeight > 0) {
              const label = cb.closest('label') || cb.parentElement;
              if (label) { label.click(); } else { cb.click(); }
              return true;
            }
          }
          return false;
        });
        if (hasUncheckedBox) {
          console.log('  ✓ Checked checkbox on Google page');
          await activePage.waitForTimeout(1500);
        }
      } catch (e) {
        console.log(`  ! Checkbox eval error: ${e.message?.substring(0, 60)}`);
      }

      // Step B: Try clicking action buttons via Playwright selectors
      const actionSelectors = [
        'button:has-text("I Understand")',
        'button:has-text("I understand")',
        'button:has-text("I Understand and Wish to Continue")',
        'button:has-text("I understand and wish to continue")',
        'button:has-text("Continue")',
        'button:has-text("Allow")',
        'button:has-text("Accept")',
        'button:has-text("Skip")',
        'button:has-text("Confirm")',
        'button:has-text("Next")',
        'button:has-text("Agree")',
        'a:has-text("Skip")',
        '#continue',
        'input[type="submit"][value="Continue"]',
      ];

      for (const sel of actionSelectors) {
        if (clickedSomething) break;
        try {
          const btn = await activePage.$(sel);
          if (btn && await btn.isVisible().catch(() => false)) {
            await btn.click().catch(() => {});
            const btnText = await btn.evaluate(el => (el.textContent || el.value || '').trim()).catch(() => sel);
            console.log(`  ✓ Clicked: "${btnText.substring(0, 40)}"`);
            clickedSomething = true;
            await activePage.waitForTimeout(3000);
          }
        } catch (e) {}
      }

      // Step C: DOM eval fallback — broader search including Google Material classes
      if (!clickedSomething) {
        try {
          const domClicked = await activePage.evaluate(() => {
            const btns = Array.from(document.querySelectorAll(
              'button, input[type="submit"], a[role="button"], [role="button"], div[jsaction]'
            ));
            const actionTexts = [
              'continue', 'next', 'allow', 'agree', 'accept', 'lanjutkan',
              'confirm', 'i understand', 'skip', 'submit', 'done',
            ];
            const primary = btns.find(b => {
              const cls = (b.className || '').toLowerCase();
              const txt = (b.textContent || b.value || '').trim().toLowerCase();
              return (cls.includes('VfPpkd') || cls.includes('primary') ||
                      actionTexts.some(t => txt === t || txt.startsWith(t))) &&
                     b.offsetHeight > 0 && b.offsetWidth > 0;
            });
            if (primary) { primary.click(); return (primary.textContent || '').trim() || 'button'; }

            // Broader: any visible element with short action text
            const anyClickable = btns.find(b => {
              const txt = (b.textContent || b.value || '').trim().toLowerCase();
              return txt.length > 0 && txt.length < 40 &&
                     actionTexts.some(t => txt.includes(t)) &&
                     b.offsetHeight > 0;
            });
            if (anyClickable) { anyClickable.click(); return (anyClickable.textContent || '').trim(); }
            return null;
          });

          if (domClicked) {
            console.log(`  ✓ Clicked (DOM): "${domClicked.substring(0, 40)}"`);
            clickedSomething = true;
            await activePage.waitForTimeout(3000);
          }
        } catch (e) {
          console.log(`  ! DOM eval error (navigation?): ${e.message?.substring(0, 60)}`);
          // Context destroyed = navigation happened, which is good
          await activePage.waitForTimeout(3000);
          continue;
        }
      }

      if (!clickedSomething) {
        console.log('  No action button found, waiting...');
        await activePage.waitForTimeout(3000);
      }

      await activePage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // If popup mode, wait for popup to close
    if (authPage !== this.page) {
      console.log('  Waiting for Google popup to close...');
      try {
        await authPage.waitForEvent('close', { timeout: 30000 });
        console.log('  ✓ Google popup closed');
      } catch (e) {
        console.log('  ! Popup did not close automatically, continuing...');
      }
    }

    // Final wait: ensure we're on Xiaomi's domain
    console.log('  Waiting for Xiaomi page to load...');
    for (let i = 0; i < 20; i++) {
      let url;
      try { url = this.page.url(); } catch { break; }
      if (isXiaomiUrl(url)) break;
      if (url.startsWith('chrome-error')) {
        console.log('  ! Chrome error in final wait — trying direct navigation...');
        try {
          await this.page.goto('https://platform.xiaomimimo.com/console/balance', {
            waitUntil: 'networkidle', timeout: 30000,
          });
        } catch (e) {}
        break;
      }
      await this.page.waitForTimeout(2000);
    }

    let finalUrl;
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      finalUrl = this.page.url();
    } catch { finalUrl = 'unknown'; }
    console.log(`  ✓ Back on: ${finalUrl.substring(0, 80)}...`);

    if (!isXiaomiUrl(finalUrl)) {
      throw new Error(`Google sign-in did not redirect to Xiaomi. Still on: ${finalUrl.substring(0, 100)}`);
    }
  }

  async xiaomiOnboard() {
    console.log('  Starting Xiaomi onboarding...');
    const currentUrl = this.page.url();
    console.log(`  Current URL: ${currentUrl.substring(0, 80)}...`);

    // If already on platform console (e.g. account already registered), skip
    if (currentUrl.includes('platform.xiaomimimo.com') && !currentUrl.includes('login')) {
      console.log('  ✓ Already on platform — skipping onboarding');
      return;
    }

    // If on SNS login page, wait for it to become interactive
    if (currentUrl.includes('sns/login')) {
      console.log('  SNS login page — waiting for content...');
      await this.page.waitForTimeout(3000);
    }

    // Dump page structure for debugging
    const pageInfo = await this.page.evaluate(() => ({
      title: document.title,
      text: (document.body.innerText || '').substring(0, 300),
      buttons: Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(b => b.offsetHeight > 0)
        .map(b => (b.textContent || b.value || '').trim().substring(0, 40)),
      inputs: Array.from(document.querySelectorAll('input, textarea'))
        .filter(i => i.offsetHeight > 0)
        .map(i => ({ type: i.type, name: i.name, placeholder: i.placeholder })),
    })).catch(() => ({}));
    console.log(`  [Debug] Title: ${pageInfo.title}`);
    console.log(`  [Debug] Buttons: ${JSON.stringify(pageInfo.buttons)}`);
    console.log(`  [Debug] Text: ${(pageInfo.text || '').replace(/\n/g, ' | ').substring(0, 150)}`);

    // === STEP 1: Handle "Create a Xiaomi Account" page ===
    // This page shows: checkbox for terms + "Next" button
    // Checkbox is native <input type="checkbox"> with label as sibling text

    const pageText = (pageInfo.text || '').toLowerCase();
    const isCreateAccount = pageText.includes('create') && pageText.includes('xiaomi account');

    if (isCreateAccount) {
      console.log('  "Create a Xiaomi Account" page detected');

      // Click the terms checkbox (native checkbox, label text is separate)
      const checkboxClicked = await this.page.evaluate(() => {
        // Find checkbox near "agreed" / "user agreement" text
        const cbs = document.querySelectorAll('input[type="checkbox"]');
        for (const cb of cbs) {
          if (cb.offsetHeight > 0) {
            // Check parent/sibling text
            const parent = cb.closest('label, div, span');
            const nearbyText = (parent?.textContent || cb.parentElement?.textContent || '').toLowerCase();
            if (nearbyText.includes('agreed') || nearbyText.includes('xiaomi') ||
                nearbyText.includes('privacy') || nearbyText.includes('terms') ||
                cbs.length === 1) { // If only one checkbox, it's the terms one
              if (!cb.checked) {
                cb.click();
              }
              return cb.checked;
            }
          }
        }
        return false;
      }).catch(() => false);
      console.log(`  ✓ Terms checkbox: ${checkboxClicked ? 'checked' : 'attempted'}`);
      await humanDelay(300, 600);

      // Click "Next" button
      const nextClicked = await this.page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const next = btns.find(b => {
          const txt = (b.textContent || '').trim().toLowerCase();
          return (txt === 'next' || txt === 'lanjutkan' || txt === 'continue') && b.offsetHeight > 0;
        });
        if (next) { next.click(); return true; }
        return false;
      }).catch(() => false);
      console.log(`  ✓ Next button: ${nextClicked ? 'clicked' : 'not found'}`);
      await this.page.waitForTimeout(5000);
    }

    // === STEP 2: Handle password setup page (appears after "Next") ===

    const afterNextUrl = this.page.url();
    console.log(`  After Next: ${afterNextUrl.substring(0, 80)}...`);

    // Check for password fields (wrapped in try/catch for navigation safety)
    let visiblePwdFields = [];
    try {
      const pwdFields = await this.page.$$('input[type="password"]:not([aria-hidden="true"])');
      for (const f of pwdFields) {
        if (await f.isVisible().catch(() => false)) visiblePwdFields.push(f);
      }
    } catch (e) {
      console.log(`  ! Password field detection error: ${e.message?.substring(0, 60)}`);
      // Navigation likely happened, check if we're on the platform
      const navUrl = this.page.url();
      if (navUrl.includes('platform.xiaomimimo.com') && !navUrl.includes('login')) {
        console.log('  ✓ Redirected to platform during onboarding');
        return;
      }
    }

    if (visiblePwdFields.length >= 2) {
      console.log('  Password setup page detected');
      this._mimoPassword = generateRandomPassword();
      console.log(`  Generated MiMo password: ${this._mimoPassword}`);

      await humanFill(this.page, visiblePwdFields[0], this._mimoPassword);
      console.log('  ✓ Filled password');

      await humanDelay(200, 400);
      await humanFill(this.page, visiblePwdFields[1], this._mimoPassword);
      console.log('  ✓ Filled confirm password');

      await humanDelay(300, 600);

      // Click Next/Continue/Create Account
      const pwdSubmitText = await this.page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => {
          const txt = (b.textContent || '').trim().toLowerCase();
          return (txt === 'next' || txt === 'continue' || txt === 'lanjutkan' ||
                  txt === 'create account' || txt === 'create' || txt === 'set password' ||
                  txt === 'confirm' || txt === 'submit' || txt === 'complete') && b.offsetHeight > 0;
        });
        if (btn) { btn.click(); return btn.textContent?.trim(); }
        return null;
      }).catch(() => null);
      console.log(`  ✓ Submitted password (button: "${pwdSubmitText}")`);

      // Wait for page to change after password submission
      const pwdPageUrl = this.page.url();
      for (let i = 0; i < 15; i++) {
        await this.page.waitForTimeout(2000);
        const newUrl = this.page.url();
        if (newUrl !== pwdPageUrl) {
          console.log(`  ✓ Page changed to: ${newUrl.substring(0, 80)}...`);
          break;
        }
        // If still on same page, try clicking submit again
        if (i === 3 || i === 7) {
          console.log(`  ! Still on password page, retrying submit...`);
          // Dump current buttons for debug
          const btns = await this.page.evaluate(() => {
            return Array.from(document.querySelectorAll('button'))
              .filter(b => b.offsetHeight > 0)
              .map(b => (b.textContent || '').trim().substring(0, 30));
          }).catch(() => []);
          console.log(`  [Debug] Buttons: ${JSON.stringify(btns)}`);
          // Try clicking any visible button again
          await this.page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const primary = btns.find(b => {
              const txt = (b.textContent || '').trim().toLowerCase();
              const cls = (b.className || '').toLowerCase();
              return (cls.includes('primary') || txt === 'next' || txt === 'continue' ||
                      txt === 'create' || txt === 'confirm' || txt === 'complete') && b.offsetHeight > 0;
            });
            if (primary) primary.click();
          }).catch(() => {});
        }
      }
    } else if (visiblePwdFields.length === 1) {
      // Single password field — might be confirm-only or the main field
      console.log('  Single password field detected');
      this._mimoPassword = generateRandomPassword();
      console.log(`  Generated MiMo password: ${this._mimoPassword}`);
      await humanFill(this.page, visiblePwdFields[0], this._mimoPassword);
      console.log('  ✓ Filled password');
      await humanDelay(300, 600);
      await this.page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => (b.textContent || '').trim().toLowerCase() === 'next' && b.offsetHeight > 0);
        if (btn) btn.click();
      });
      await this.page.waitForTimeout(5000);
    } else {
      // Check if there are password fields by placeholder (Indonesian: "kata sandi")
      const altPwdField = await this.page.$('input[placeholder*="password" i], input[placeholder*="kata sandi" i]');
      if (altPwdField && await altPwdField.isVisible().catch(() => false)) {
        this._mimoPassword = generateRandomPassword();
        await humanFill(this.page, altPwdField, this._mimoPassword);
        console.log('  ✓ Filled password (by placeholder)');
        await this.page.waitForTimeout(3000);
      }
    }

    // === STEP 3: Handle any remaining checkboxes/modals ===
    // "Open Platform Agreement", "Privacy Policy", etc.

    await this.page.waitForTimeout(2000);

    // Try clicking any unchecked checkboxes
    const remainingCheckboxes = await this.page.evaluate(() => {
      const cbs = document.querySelectorAll('input[type="checkbox"], .ant-checkbox-input');
      const clicked = [];
      for (const cb of cbs) {
        if (!cb.checked && cb.offsetHeight > 0) {
          cb.click();
          clicked.push((cb.parentElement?.textContent || '').substring(0, 50));
        }
      }
      // Also try Ant Design wrappers
      const wrappers = document.querySelectorAll('.ant-checkbox-wrapper');
      for (const w of wrappers) {
        const input = w.querySelector('input[type="checkbox"]');
        if (input && !input.checked && w.offsetHeight > 0) {
          w.click();
          clicked.push(w.textContent?.substring(0, 50));
        }
      }
      return clicked;
    }).catch(() => []);
    if (remainingCheckboxes.length > 0) {
      console.log(`  ✓ Clicked checkboxes: ${JSON.stringify(remainingCheckboxes)}`);
    }

    // Click any remaining Next/Confirm/Continue buttons
    await humanDelay(300, 600);
    const actionClicked = await this.page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const action = btns.find(b => {
        const txt = (b.textContent || '').trim().toLowerCase();
        return (txt === 'next' || txt === 'confirm' || txt === 'continue' ||
                txt === 'lanjutkan' || txt === 'konfirmasi' || txt === 'submit' ||
                txt === 'got it' || txt === 'setuju') && b.offsetHeight > 0;
      });
      if (action) { action.click(); return action.textContent?.trim(); }
      return null;
    }).catch(() => null);
    if (actionClicked) {
      console.log(`  ✓ Clicked: "${actionClicked}"`);
    }

    // Wait and handle any final modals
    await this.page.waitForTimeout(5000);
    await this.handleTermsModal().catch(() => {});
    await this.waitForOverlaysGone();
    await this.handleOAuthRedirect().catch(() => {});

    console.log('  ✓ Xiaomi onboarding completed');
    console.log(`  Final URL: ${this.page.url().substring(0, 80)}...`);
  }

  async clickConsoleMenu() {
    // Setelah signup, user biasanya landed di halaman referral atau dashboard.
    // Daripada page.goto langsung ke /console/balance (kelihatan otomatis),
    // klik link/menu "Console" beneran biar pola navigasinya mirip manusia.
    console.log('  Looking for Console menu...');

    // Coba beberapa selector — text=, role=link, atau tombol berlabel Console
    const candidates = [
      'a:has-text("Console")',
      'button:has-text("Console")',
      '[role="link"]:has-text("Console")',
      'header a:has-text("Console"), nav a:has-text("Console")',
    ];

    for (const selector of candidates) {
      try {
        const el = this.page.locator(selector).first();
        const count = await el.count();
        if (count === 0) continue;

        await el.waitFor({ state: 'visible', timeout: 3000 });
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await humanDelay(200, 400);
        await el.hover({ timeout: 2500 }).catch(() => {});
        await humanDelay(150, 300);

        // Klik native — biar cookies/session-nya kebawa via SPA navigation
        await el.click({ timeout: 5000 });
        console.log(`  ✓ Clicked Console menu (selector: ${selector})`);

        // Tunggu URL berubah ke /console/* atau networkidle
        await this.page.waitForURL(/\/console/, { timeout: 10000 }).catch(() => {});
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await humanDelay(800, 1500);

        const url = this.page.url();
        console.log(`  ✓ Now on: ${url}`);
        return true;
      } catch (e) {
        // selector berikutnya
      }
    }

    // Fallback DOM eval: cari elemen apa pun yang teksnya "Console" dan clickable
    const clicked = await this.page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('a, button, [role="link"], [role="button"]'));
      const target = all.find(el => {
        const txt = (el.textContent || '').trim();
        return txt === 'Console' && el.offsetHeight > 0 && el.offsetWidth > 0;
      });
      if (target) {
        target.scrollIntoView({ block: 'center' });
        target.click();
        return true;
      }
      return false;
    });

    if (clicked) {
      console.log('  ✓ Clicked Console menu via DOM eval fallback');
      await this.page.waitForURL(/\/console/, { timeout: 10000 }).catch(() => {});
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await humanDelay(800, 1500);
      return true;
    }

    console.log('  ! Console menu not found — caller will fallback to direct URL');
    return false;
  }

  async readBalance() {
    // Baca TOTAL balance dari halaman /console/balance.
    //
    // Layout halaman Xiaomi MiMo:
    //   [Balance card]                [Alert card]
    //     $ 2.72                        $ -
    //     Cash Balance: $0.00           Balance Alerts Off
    //     Bonus Balance: $2.72
    //
    //   [Recharge section]
    //     $50  $100  $200  ...     ← preset buttons, bukan saldo!
    //
    // Yang dibutuhkan: angka di bawah label "Balance" (TOTAL = Cash + Bonus).
    // Akun baru: Cash $0.00 + Bonus $0.72/$2.72.
    //
    // Strategi:
    //   1. Cari "Balance\n$ X.XX" — total balance di card utama
    //   2. Sum Cash Balance + Bonus Balance kalau keduanya ketemu
    //   3. Fallback: angka $X.XX terkecil di halaman (saldo akun baru < $5)
    try {
      const value = await this.page.evaluate(() => {
        const text = document.body.innerText || '';

        // 1. "Balance" word-boundary, diikuti newline + "$ X.XX"
        //    Hindari "Cash Balance" / "Bonus Balance" / "Token Balance" /
        //    "Alert Threshold". Pakai negative lookbehind via leading marker.
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          // Match exactly "Balance" (kasus apa pun), bukan "Cash/Bonus/Token Balance"
          if (/^balance$/i.test(line)) {
            // Ambil angka $X.XX di baris berikut atau dalam 2 baris
            for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
              const m = lines[j].match(/\$\s*([0-9]+\.[0-9]{2})/);
              if (m) return parseFloat(m[1]);
            }
          }
        }

        // 2. Sum Cash + Bonus
        const cash = text.match(/cash\s+balance\s*[:\s]\s*\$\s*([0-9]+\.[0-9]{2})/i);
        const bonus = text.match(/bonus\s+balance\s*[:\s]\s*\$\s*([0-9]+\.[0-9]{2})/i);
        if (cash && bonus) {
          return parseFloat(cash[1]) + parseFloat(bonus[1]);
        }
        if (bonus) return parseFloat(bonus[1]);
        if (cash) return parseFloat(cash[1]);

        // 3. Fallback: angka $X.XX terkecil < $50 (saldo akun normal < $5,
        //    Recharge preset $50/$100/$200 dst pasti lebih besar)
        const allWithDecimal = [...text.matchAll(/\$\s*([0-9]+\.[0-9]{2})/g)]
          .map(m => parseFloat(m[1]))
          .filter(n => !isNaN(n) && n > 0 && n < 50);
        if (allWithDecimal.length > 0) {
          return Math.min(...allWithDecimal);
        }

        return null;
      });
      return typeof value === 'number' && !isNaN(value) ? value : null;
    } catch (e) {
      return null;
    }
  }

  async waitForOverlaysGone(timeout = 6000) {
    // Tunggu Ant Design modal-mask/wrap beneran hilang.
    // Setelah Confirm, mask masih bisa ke-render ~300-500ms dan ngeblock klik.
    try {
      await this.page.waitForFunction(() => {
        const masks = Array.from(document.querySelectorAll(
          '.ant-modal-mask, .ant-modal-wrap, .ant-modal-root .ant-modal-mask'
        ));
        return masks.every(m => {
          const style = window.getComputedStyle(m);
          if (style.display === 'none' || style.visibility === 'hidden') return true;
          if (m.offsetHeight === 0 || m.offsetWidth === 0) return true;
          // Mask yg fade-out (opacity ~0) juga sudah aman
          const op = parseFloat(style.opacity || '1');
          return op < 0.05;
        });
      }, { timeout });
      console.log('  ✓ Overlays gone');
    } catch (e) {
      console.log('  ! Some overlays still visible after timeout — continuing anyway');
    }
  }

  async handleTermsModal() {
    // Modal Terms & Agreements muncul sekali per session — bisa di balance,
    // api-keys, atau ultraspeed page tergantung mana yang dibuka pertama.
    // Method ini idempotent: kalau modal nggak ada, langsung return.
    //
    // Catatan: Ant Design ngehidden `.ant-checkbox-input` (display:none).
    // Klik input langsung pakai force=true ngeset value tapi nggak nge-trigger
    // React onChange — akibatnya tombol Confirm tetap disabled.
    // Solusi: klik wrapper visible (`.ant-checkbox` / `.ant-checkbox-wrapper`),
    // lalu tunggu Confirm benar-benar enabled.
    try {
      const termsModalOpen = await this.page.evaluate(() => {
        const wraps = Array.from(document.querySelectorAll('.ant-modal-wrap'));
        return wraps.some(wrap => {
          const style = wrap.style.display;
          if (style === 'none' || wrap.offsetHeight === 0) return false;
          const hasCheckbox = wrap.querySelector('.ant-checkbox-input, input[type="checkbox"]');
          const text = (wrap.innerText || '').toLowerCase();
          return !!hasCheckbox && (text.includes('agree') || text.includes('terms') || text.includes('agreement'));
        });
      });

      if (!termsModalOpen) {
        console.log('  No Terms & Agreements modal open');
        return false;
      }

      console.log('  Terms & Agreements modal detected (open), handling...');

      // 1) Klik wrapper checkbox yang visible — bukan input hidden
      // Coba urutan: .ant-checkbox-wrapper > .ant-checkbox > label terkait
      const checkboxClicked = await this.page.evaluate(() => {
        const modal = Array.from(document.querySelectorAll('.ant-modal-wrap'))
          .find(w => w.offsetHeight > 0 && w.style.display !== 'none');
        if (!modal) return { ok: false, reason: 'modal disappeared' };

        // Prioritas: wrapper visible
        const wrapper =
          modal.querySelector('.ant-checkbox-wrapper') ||
          modal.querySelector('.ant-checkbox') ||
          modal.querySelector('label.ant-checkbox-wrapper');

        if (!wrapper) return { ok: false, reason: 'no checkbox wrapper found' };

        // Klik native — biar Ant Design React onChange ke-trigger
        wrapper.click();

        // Cek sekarang checkbox-nya checked atau belum
        const input = modal.querySelector('.ant-checkbox-input, input[type="checkbox"]');
        return {
          ok: true,
          checked: input ? input.checked : null,
          wrapperClass: wrapper.className,
        };
      });

      console.log(`  Checkbox click result: ${JSON.stringify(checkboxClicked)}`);

      if (!checkboxClicked.ok) {
        // Fallback: klik via Playwright dengan force
        await this.page.click('.ant-modal-wrap .ant-checkbox-wrapper, .ant-modal-wrap .ant-checkbox', { force: true }).catch(() => {});
        console.log('  ✓ Clicked Terms checkbox (fallback Playwright)');
      }

      // Beri waktu Ant Design update state + enable tombol Confirm
      await this.page.waitForTimeout(800);

      // 2) Tunggu Confirm jadi enabled (max 5 detik)
      const confirmReady = await this.page.waitForFunction(() => {
        const modal = Array.from(document.querySelectorAll('.ant-modal-wrap'))
          .find(w => w.offsetHeight > 0 && w.style.display !== 'none');
        if (!modal) return false;
        const btns = Array.from(modal.querySelectorAll('.ant-modal-footer button, button'));
        const confirm = btns.find(b => /confirm|agree|continue|ok/i.test(b.textContent || ''));
        if (!confirm) return false;
        const disabled = confirm.disabled || confirm.classList.contains('ant-btn-disabled') || confirm.getAttribute('disabled') !== null;
        return !disabled;
      }, { timeout: 5000 }).catch(() => null);

      if (!confirmReady) {
        console.log('  ! Confirm button stayed disabled after checkbox click');
        // Coba klik checkbox lagi (kadang butuh dua kali)
        await this.page.click('.ant-modal-wrap .ant-checkbox-wrapper, .ant-modal-wrap .ant-checkbox', { force: true }).catch(() => {});
        await this.page.waitForTimeout(1500);
      }

      // 3) Klik Confirm
      const confirmBtn = await this.page.$('.ant-modal-wrap .ant-modal-footer .ant-btn-primary:not([disabled]):not(.ant-btn-disabled), .ant-modal-wrap button:has-text("Confirm"):not([disabled])');
      if (confirmBtn) {
        await confirmBtn.click({ force: true });
        console.log('  ✓ Clicked Terms & Agreements Confirm button');
      } else {
        // Fallback: cari tombol primary apa pun di modal
        const fallback = await this.page.$('.ant-modal-wrap .ant-btn-primary');
        if (fallback) {
          await fallback.click({ force: true });
          console.log('  ✓ Clicked Confirm (fallback ant-btn-primary)');
        } else {
          console.log('  ! Confirm button not found in Terms modal');
        }
      }

      // 4) Verifikasi modal beneran tertutup (max 5 detik)
      const closed = await this.page.waitForFunction(() => {
        const wraps = Array.from(document.querySelectorAll('.ant-modal-wrap'));
        return !wraps.some(w => {
          if (w.style.display === 'none' || w.offsetHeight === 0) return false;
          const text = (w.innerText || '').toLowerCase();
          return text.includes('agree') || text.includes('terms');
        });
      }, { timeout: 5000 }).catch(() => null);

      if (closed) {
        console.log('  ✓ Terms modal closed');
      } else {
        console.log('  ! Terms modal still visible after Confirm click');
        await this.page.screenshot({ path: 'screenshot-terms-stuck.png' }).catch(() => {});
      }

      await this.page.waitForTimeout(800);
      return true;
    } catch (e) {
      console.log('  ! Failed to handle Terms & Agreements modal:', e.message);
      return false;
    }
  }

  async handleOAuthRedirect() {
    let currentUrl = this.page.url();
    if (currentUrl.includes('account.xiaomi.com') || currentUrl.includes('login') || currentUrl.includes('auth')) {
      console.log('  Redirected to authorization page, logging in...');
      
      // Wait a moment for page/modals to load
      await this.page.waitForTimeout(2000);
      
      // Check if "Attention" agreement modal is present and click Agree
      const agreeBtn = await this.page.$('.miui-modal-wrap button:has-text("Agree"), button:has-text("Agree"), .miui-modal-wrap .btn-primary');
      if (agreeBtn) {
        console.log('  Found Xiaomi Account Agreement modal ("Attention") during OAuth redirect, clicking Agree...');
        await agreeBtn.click({ force: true });
        await this.page.waitForTimeout(3000);
      }
      
      // Wait for authorize button
      const authBtn = await this.page.waitForSelector('button:has-text("Agree"), button:has-text("Authorize"), button:has-text("Sign in"), #accept, .btn-primary', { timeout: 10000 }).catch(() => null);
      if (authBtn) {
        await authBtn.click();
        console.log('  ✓ Clicked authorize button');
        await this.page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
        await this.page.waitForTimeout(5000);
        await this.page.screenshot({ path: 'screenshot-after-auth.png', fullPage: true });
        console.log('  ✓ Captured screenshot-after-auth.png');
      }
    }
  }

  async selectDropdownOption(labelText, searchText, exact = false) {
    console.log(`  Selecting dropdown option for "${labelText}" matching "${searchText}"...`);
    try {
      const formItem = this.page.locator('.ant-form-item').filter({ hasText: new RegExp(`^${labelText}`) });
      if (await formItem.count() === 0) {
        console.log(`  ! Form item for label "${labelText}" not found`);
        return false;
      }
      
      let selector = formItem.first().locator('.ant-select-selector');
      if (await selector.count() === 0) {
        // Try fallback selectors for custom/nested dropdown components like FancyPhoneInput
        selector = formItem.first().locator('.ant-dropdown-trigger, [class*="callingCodeTrigger"], .ant-select, .ant-select-selection, [class*="select"]');
      }
      
      if (await selector.count() === 0) {
        console.log(`  ! Selector for label "${labelText}" not found. Listing all elements in form item:`);
        const elementInfo = await formItem.first().evaluate((el) => {
          return Array.from(el.querySelectorAll('*')).map(child => ({
            tag: child.tagName,
            class: child.className,
            text: child.textContent ? child.textContent.trim().substring(0, 30) : ''
          }));
        });
        console.log(JSON.stringify(elementInfo, null, 2));
        return false;
      }
      
      console.log(`  Clicking select trigger for "${labelText}"...`);
      await selector.first().click({ force: true });
      await this.page.waitForTimeout(1500);
      
      const clicked = await this.page.evaluate((args) => {
        const { search, isExact } = args;
        const dropdowns = Array.from(document.querySelectorAll('.ant-select-dropdown, .ant-dropdown, [class*="dropdown"], [class*="Dropdown"], [role="listbox"], [role="menu"]')).filter(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
        });
        
        if (dropdowns.length === 0) return { success: false, reason: 'No visible dropdown container found' };
        
        const dropdown = dropdowns[dropdowns.length - 1];
        const options = Array.from(dropdown.querySelectorAll('.ant-select-item-option, [role="option"], [role="menuitem"], li, a, span, div')).filter(el => {
          // Filter to only leaf-like or text-containing interactive elements
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && el.offsetHeight > 0;
        });
        
        // Try to match specific classes first to avoid matching parent wrappers containing all text
        let target = null;
        
        // 1. Try to find dedicated option classes first
        const specificOptions = Array.from(dropdown.querySelectorAll('.ant-select-item-option, .ant-dropdown-menu-item, [role="option"], [role="menuitem"], li'));
        target = specificOptions.find(opt => {
          const txt = (opt.textContent || '').trim();
          const title = opt.getAttribute('title') || '';
          const dataValue = opt.getAttribute('data-value') || '';
          if (isExact) {
            return txt === search || title === search || dataValue === search;
          } else {
            return txt.includes(search) || title.includes(search) || dataValue.includes(search);
          }
        });
        
        // 2. Fallback to leaf text elements (spans, divs, links) if dedicated options are not found
        if (!target) {
          const generalEls = Array.from(dropdown.querySelectorAll('span, div, a')).filter(el => {
            const style = window.getComputedStyle(el);
            // Ensure element is visible and contains text
            if (style.display === 'none' || el.offsetHeight === 0) return false;
            
            // Only look at elements that don't have block-level child elements containing text to target leaf nodes
            const childTextElements = Array.from(el.children).filter(child => {
              const childStyle = window.getComputedStyle(child);
              return childStyle.display !== 'none' && child.offsetHeight > 0 && child.textContent.trim().length > 0;
            });
            return childTextElements.length === 0;
          });
          
          target = generalEls.find(opt => {
            const txt = (opt.textContent || '').trim();
            if (isExact) {
              return txt === search;
            } else {
              return txt.includes(search);
            }
          });
        }
        
        if (target) {
          target.click();
          return { success: true, text: target.textContent ? target.textContent.trim() : '' };
        }
        
        return { success: false, reason: `Option matching "${search}" not found among ${options.length} options` };
      }, { search: searchText, isExact: exact });
      
      if (clicked.success) {
        console.log(`  ✓ Selected option: ${clicked.text}`);
        await this.page.waitForTimeout(1000);
        return true;
      } else {
        console.log(`  ! Selection failed: ${clicked.reason}`);
        
        // Custom handling for phone calling code dropdown which uses ant-dropdown
        if (labelText === 'Phone number') {
          console.log('  Trying fallback click for phone number dropdown options...');
          const opt = await this.page.$(`.ant-dropdown-menu-item:has-text("${searchText}"), .ant-dropdown-menu [title*="${searchText}"], .ant-dropdown :has-text("${searchText}")`);
          if (opt) {
            await opt.click({ force: true });
            console.log(`  ✓ Selected option via fallback class click for "${searchText}"`);
            await this.page.waitForTimeout(1000);
            return true;
          }
        }
        
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
        return false;
      }
    } catch (e) {
      console.log(`  ! Error selecting dropdown for "${labelText}": ${e.message}`);
      return false;
    }
  }

  async redeemInviteCode() {
    console.log('[Step 7.6] Redeeming invite code...');

    // Read invite code from config (with fallback to parsing referral link)
    const refCodeMatch = this.config.xiaomi.referralLink.match(/[?&]ref=([A-Z0-9]+)/i);
    const inviteCode = this.config.xiaomi.inviteCode
      || (refCodeMatch ? refCodeMatch[1] : 'HWPMXZ');
    console.log(`  Invite code to redeem: ${inviteCode}`);

    // 1. Klik menu "Console" dulu — biar navigasi-nya mirip user beneran
    //    (bukan langsung page.goto ke /console/balance dari URL referral).
    const consoleClicked = await this.clickConsoleMenu();

    // 2. Setelah klik Console, kemungkinan landed di /console (overview) atau
    //    /console/balance. Cek URL — kalau bukan balance, navigasi ke sana
    //    via in-app link kalau ada, atau goto sebagai fallback.
    let url = this.page.url();
    if (!url.includes('/console/balance')) {
      console.log(`  Not on balance page yet (current: ${url}), navigating...`);

      // Coba klik link "Balance" di sidebar console dulu
      const balanceClicked = await this.page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, [role="link"], li, [role="menuitem"]'));
        const target = links.find(el => {
          const txt = (el.textContent || '').trim();
          return /^Balance$/i.test(txt) && el.offsetHeight > 0;
        });
        if (target) {
          target.scrollIntoView({ block: 'center' });
          target.click();
          return true;
        }
        return false;
      });

      if (balanceClicked) {
        console.log('  ✓ Clicked Balance link in console sidebar');
        await this.page.waitForURL(/\/console\/balance/, { timeout: 8000 }).catch(() => {});
        await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      } else {
        // Fallback terakhir: goto langsung
        console.log('  ! Balance link not found, falling back to direct goto...');
        await this.page.goto('https://platform.xiaomimimo.com/console/balance', {
          waitUntil: 'networkidle',
          timeout: this.config.browser.timeout,
        });
      }
    }
    await this.page.waitForTimeout(2500);

    await this.handleOAuthRedirect();
    await this.page.waitForTimeout(2000);

    // Close cookies modal if overlaying (do it before clicking to avoid click interception!)
    console.log('  Checking for cookies banner...');
    const acceptCookiesBtn = await this.page.waitForSelector('button:has-text("Accept All"), button:has-text("Accept"), button:has-text("Allow All")', { timeout: 4000 }).catch(() => null);
    if (acceptCookiesBtn) {
      await acceptCookiesBtn.click({ force: true }).catch(() => {});
      console.log('  ✓ Accepted cookies banner');
      await this.page.waitForTimeout(2000);
    }

    // Halaman pertama yang dibuka di console — Terms modal kemungkinan muncul di sini
    await this.handleTermsModal();

    // Tunggu sampai semua modal-mask/wrap beneran hilang dari layar.
    // Ant Design naruh display:none setelah animasi, tapi mask-nya kadang
    // nyangkut ~300-500ms dan nge-intercept klik berikutnya.
    await this.waitForOverlaysGone();

    // Take a screenshot to inspect the balance page
    await this.page.screenshot({ path: 'screenshot-balance.png', fullPage: false });
    console.log('  ✓ Captured screenshot-balance.png');

    // Snapshot balance SEBELUM redeem (untuk verifikasi nanti).
    // Format halaman biasanya: "Balance: $0.72" atau "Cash Balance $0.72"
    const balanceBefore = await this.readBalance();
    console.log(`  💰 Balance before redeem: $${balanceBefore !== null ? balanceBefore.toFixed(2) : 'unknown'}`);

    // Click "Enter invite code +$2" button/link
    console.log('  Checking for "Enter invite code" button...');

    // Cek dulu apakah link-nya emang ada — kalau akun udah pernah redeem,
    // link ini hilang dan diganti dengan tampilan saldo. Treat sebagai sukses.
    const linkExists = await this.page.evaluate(() => {
      return document.body.innerText.includes('Enter invite code');
    }).catch(() => false);

    if (!linkExists) {
      console.log('  ℹ "Enter invite code" link not found — account likely already redeemed.');
      // Cek apakah ada angka saldo > 0 sebagai konfirmasi
      const balanceText = await this.page.evaluate(() => {
        const matches = document.body.innerText.match(/\$\s*[\d.]+/g);
        return matches ? matches.slice(0, 3).join(', ') : 'unknown';
      }).catch(() => 'unknown');
      console.log(`  Balance hint: ${balanceText}`);
      return; // exit method, bukan error
    }

    let clicked = false;
    try {
      const el = this.page.locator('text=Enter invite code').first();
      await el.waitFor({ state: 'visible', timeout: 8000 });
      // Scroll ke link biar pasti dalam viewport (penting di viewport kecil 1280x720)
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await humanDelay(200, 400);
      // Hover dulu — biar event-nya mirip user beneran, BUKAN force:true
      // (force:true di selector text= sering klik elemen wrapper, bukan link click handler-nya)
      try {
        await el.hover({ timeout: 3000 });
        await humanDelay(150, 300);
        await el.click({ timeout: 5000 });
        clicked = true;
        console.log('  ✓ Clicked "Enter invite code" via hover+click');
      } catch (clickErr) {
        console.log(`  ! Native click failed (${clickErr.message.split('\n')[0]}), trying force click...`);
        await el.click({ force: true });
        clicked = true;
        console.log('  ✓ Clicked "Enter invite code" via force click');
      }
    } catch (err) {
      console.log('  Playwright locator click failed/timed out, trying backwards-eval leaf click...');
      clicked = await this.page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('*'));
        // Search backwards to get leaf elements first
        for (let i = elements.length - 1; i >= 0; i--) {
          const el = elements[i];
          const text = (el.textContent || '').trim();
          if (text.includes('Enter invite code') && el.offsetHeight > 0) {
            const tagName = el.tagName.toLowerCase();
            if (['span', 'a', 'button', 'div'].includes(tagName) && el.children.length <= 1) {
              el.scrollIntoView({ block: 'center' });
              el.click();
              return true;
            }
          }
        }
        return false;
      });
      if (clicked) console.log('  ✓ Clicked "Enter invite code" via DOM eval fallback');
    }

    if (clicked) {
      console.log('  ✓ Entered invite code link clicked successfully');
      
      // Wait for modal container (.ant-modal) to be visible to ensure it's open
      console.log('  Waiting for redeem modal container (.ant-modal) to open...');
      const modal = await this.page.waitForSelector('.ant-modal, .ant-modal-wrap', { timeout: 10000 }).catch(() => null);
      if (!modal) {
        throw new Error('Redeem invite code modal did not open in time');
      }
      await this.page.waitForTimeout(1500);

      // Capture screenshot of the modal
      await this.page.screenshot({ path: 'screenshot-invite-modal.png' });
      console.log('  ✓ Captured screenshot-invite-modal.png');

      // Fill in the invite code - find input elements specifically inside the modal
      console.log('  Filling invite code...');
      
      // Select input elements inside the modal, excluding checkboxes
      const modalInputs = await this.page.$$('.ant-modal input:not([type="checkbox"]), .ant-modal-wrap input:not([type="checkbox"])');
      const visibleInputs = [];
      for (const input of modalInputs) {
        const isVisible = await input.isVisible().catch(() => false);
        if (isVisible) {
          visibleInputs.push(input);
        }
      }

      console.log(`  Found ${visibleInputs.length} visible inputs in modal`);

      if (visibleInputs.length >= 6) {
        console.log(`  Detected ${visibleInputs.length} invite code inputs, filling...`);

        // Clear all first
        for (const input of visibleInputs) {
          await input.fill('');
        }

        // Focus the first box dengan jeda manusia
        await humanDelay(150, 350);
        await visibleInputs[0].click({ force: true });
        await visibleInputs[0].focus();
        await humanDelay(120, 280);

        for (let i = 0; i < 6; i++) {
          // Get the index of the currently focused input box
          const activeIndex = await this.page.evaluate((elements) => {
            return elements.indexOf(document.activeElement);
          }, visibleInputs);

          if (activeIndex === i) {
            console.log(`  [Type] Box ${i} is active, typing "${inviteCode[i]}"`);
            await this.page.keyboard.type(inviteCode[i], { delay: 60 + Math.floor(Math.random() * 120) });
          } else {
            console.log(`  [Focus & Type] Box ${i} not active (active idx: ${activeIndex}), forcing focus`);
            await visibleInputs[i].click({ force: true });
            await visibleInputs[i].focus();
            await humanDelay(80, 180);
            await this.page.keyboard.press('Backspace');
            await this.page.keyboard.type(inviteCode[i], { delay: 60 + Math.floor(Math.random() * 120) });
          }
          // Jeda antar box biar mirip orang ngetik kode satu-satu
          await humanDelay(180, 380);
        }
      } else if (visibleInputs.length > 0) {
        console.log('  Filling invite code in single input...');
        await humanFill(this.page, visibleInputs[0], inviteCode);
      } else {
        console.log('  No inputs found in modal, trying to type invite code...');
        await humanType(this.page, inviteCode);
      }

      await this.page.waitForTimeout(1000);
      await this.page.screenshot({ path: 'screenshot-invite-filled.png' });
      console.log('  ✓ Captured screenshot-invite-filled.png');

      // Click the Redeem button
      console.log('  Clicking Redeem button...');
      const redeemBtn = await this.page.$('.ant-modal button:has-text("Redeem"), .ant-modal button:has-text("Redeem & get"), button:has-text("Redeem & get $2 credits")');
      let clickedRedeem = false;
      if (redeemBtn) {
        await redeemBtn.click({ force: true });
        clickedRedeem = true;
        console.log('  ✓ Clicked Redeem button');
      } else {
        clickedRedeem = await this.page.evaluate(() => {
          const modalEl = document.querySelector('.ant-modal');
          if (!modalEl) return false;
          const btns = Array.from(modalEl.querySelectorAll('button'));
          const targetBtn = btns.find(b => b.textContent.includes('Redeem') || b.textContent.includes('get $2'));
          if (targetBtn) {
            targetBtn.click();
            return true;
          }
          return false;
        });
        if (clickedRedeem) {
          console.log('  ✓ Clicked Redeem button (evaluate)');
        }
      }

      if (clickedRedeem) {
        await this.page.waitForTimeout(4000);
        await this.page.screenshot({ path: 'screenshot-invite-redeemed.png' });
        console.log('  ✓ Captured screenshot-invite-redeemed.png');

        // Cek notifikasi risk control / restriction setelah submit redeem.
        // Xiaomi nampilin pesan kira-kira:
        //   "Your account has risk control restrictions. Please contact customer service."
        // Kalau muncul, throw error khusus biar chain-loop bisa stop.
        const restrictionMsg = await this.page.evaluate(() => {
          const text = document.body.innerText || '';
          const patterns = [
            /risk\s*control\s*restriction/i,
            /account\s+has\s+risk\s+control/i,
            /contact\s+customer\s+service/i,
            /account\s+(is\s+)?restricted/i,
          ];
          for (const re of patterns) {
            const m = text.match(new RegExp('([^\\n]{0,200}' + re.source + '[^\\n]{0,200})', re.flags));
            if (m) return m[1].trim();
          }
          return null;
        }).catch(() => null);

        if (restrictionMsg) {
          console.log('  ❌ ACCOUNT RESTRICTED:');
          console.log(`     ${restrictionMsg}`);
          try {
            await this.page.screenshot({
              path: `error-restriction-${Date.now()}.png`,
              fullPage: true,
            });
          } catch (e) {}
          const err = new Error(`ACCOUNT_RESTRICTED: ${restrictionMsg}`);
          err.code = 'ACCOUNT_RESTRICTED';
          err.restrictionMsg = restrictionMsg;
          throw err;
        }

        // Verifikasi balance bertambah ~$2 setelah redeem.
        // Tutup modal redeem dulu (tombol X / Esc), lalu RELOAD halaman biar
        // widget balance di header re-fetch (tanpa reload, balance widget
        // sering masih nampilin nilai cached lama).
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.page.waitForTimeout(800);

        // Klik tombol close modal kalau Esc gak nutup
        try {
          await this.page.evaluate(() => {
            const closes = Array.from(document.querySelectorAll('.ant-modal-close, .ant-modal button[aria-label="Close"]'));
            for (const c of closes) {
              if (c.offsetHeight > 0) { c.click(); return; }
            }
          });
        } catch (e) {}
        await this.page.waitForTimeout(800);

        // Reload halaman biar fetch balance terbaru
        console.log('  Reloading balance page to refresh balance widget...');
        try {
          await this.page.reload({ waitUntil: 'networkidle', timeout: this.config.browser.timeout });
        } catch (e) {
          console.log(`  ! Reload error (lanjut): ${e.message}`);
        }
        await this.page.waitForTimeout(2000);
        await this.handleTermsModal().catch(() => {});
        await this.waitForOverlaysGone();

        // Re-read balance, beberapa kali kalau pertama masih cached
        let balanceAfter = null;
        for (let attempt = 1; attempt <= 4; attempt++) {
          balanceAfter = await this.readBalance();
          if (balanceAfter !== null && balanceBefore !== null && balanceAfter > balanceBefore) {
            break;
          }
          if (attempt < 4) {
            console.log(`  Balance attempt ${attempt}: $${balanceAfter !== null ? balanceAfter.toFixed(2) : '?'} — retry in 2s...`);
            await this.page.waitForTimeout(2000);
          }
        }
        console.log(`  💰 Balance after redeem : $${balanceAfter !== null ? balanceAfter.toFixed(2) : 'unknown'}`);

        if (balanceBefore !== null && balanceAfter !== null) {
          const delta = balanceAfter - balanceBefore;
          if (delta >= 1.5) {
            console.log(`  ✅ Balance verified: +$${delta.toFixed(2)} (expected ~+$2.00)`);
          } else if (delta > 0) {
            console.log(`  ⚠ Balance increased only +$${delta.toFixed(2)} (expected ~+$2.00) — partial credit?`);
          } else {
            console.log(`  ❌ Balance did NOT increase (before=$${balanceBefore.toFixed(2)}, after=$${balanceAfter.toFixed(2)})`);
            const err = new Error(`BALANCE_NOT_CREDITED: $${balanceBefore.toFixed(2)} → $${balanceAfter.toFixed(2)}`);
            err.code = 'BALANCE_NOT_CREDITED';
            err.balanceBefore = balanceBefore;
            err.balanceAfter = balanceAfter;
            try {
              await this.page.screenshot({
                path: `error-balance-${Date.now()}.png`,
                fullPage: true,
              });
            } catch (e) {}
            throw err;
          }
        } else {
          console.log('  ⚠ Could not parse balance, skipping verification');
        }
      } else {
        console.log('  ! Redeem button not found in modal');
      }
    } else {
      console.log('  ! "Enter invite code" button not found on balance page (might have already been redeemed).');
    }
  }

  async createApiKey() {
    console.log('[Step 7.7] Creating API Key...');

    // Navigate to API Keys page
    console.log('  Navigating to API Keys page...');
    await this.page.goto('https://platform.xiaomimimo.com/console/api-keys', {
      waitUntil: 'networkidle',
      timeout: this.config.browser.timeout
    });
    await this.page.waitForTimeout(4000);

    await this.handleOAuthRedirect();
    await this.page.waitForTimeout(2000);

    // Terms modal mungkin muncul di sini kalau halaman ini yang pertama dibuka
    await this.handleTermsModal();
    await this.waitForOverlaysGone();

    // Take screenshot of API Keys page
    await this.page.screenshot({ path: 'screenshot-apikeys-page.png' });
    console.log('  ✓ Captured screenshot-apikeys-page.png');

    // Cek dulu apakah akun sudah punya API key — kalau ada baris sk-... di tabel,
    // ambil yang pertama dan return (gak perlu bikin baru).
    const existingKey = await this.page.evaluate(() => {
      const text = document.body.innerText;
      // Format yang ditampilkan biasanya "sk-xxx...yyyy" (masked) atau full
      const match = text.match(/sk-[a-zA-Z0-9_\-]{6,}(?:\.{3}[a-zA-Z0-9_\-]{3,})?/);
      return match ? match[0] : null;
    }).catch(() => null);

    if (existingKey) {
      console.log(`  ℹ Account already has API key: ${existingKey}`);
      return existingKey;
    }

    // Click "Create API Key" button
    console.log('  Clicking "Create API Key" button...');
    const createBtn = await this.page.$('button:has-text("Create API Key"), .ant-btn:has-text("Create API Key")');
    if (createBtn) {
      await createBtn.click({ force: true });
    } else {
      const evalClicked = await this.page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Create API Key'));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      if (!evalClicked) {
        throw new Error('Create API Key button not found');
      }
    }
    
    await this.page.waitForTimeout(2000);
    await this.page.screenshot({ path: 'screenshot-create-apikey-modal.png' });
    console.log('  ✓ Captured screenshot-create-apikey-modal.png');

    // Fill API Key Name input field
    console.log('  Filling API Key Name...');
    const nameInput = await this.page.waitForSelector('.ant-modal input[placeholder="Please enter"], .ant-modal-body input', { timeout: 5000 }).catch(() => null);
    if (nameInput) {
      await humanFill(this.page, nameInput, 'mykey');
    } else {
      await humanType(this.page, 'mykey');
    }
    await humanDelay(250, 500);

    // Click Confirm button
    console.log('  Clicking Confirm button...');
    const confirmBtn = await this.page.$('.ant-modal-footer button.ant-btn-primary, .ant-modal button:has-text("Confirm")');
    if (confirmBtn) {
      await confirmBtn.click({ force: true });
    } else {
      await this.page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('.ant-modal button')).find(b => b.textContent.includes('Confirm'));
        if (btn) btn.click();
      });
    }

    await this.page.waitForTimeout(4000);
    await this.page.screenshot({ path: 'screenshot-apikey-created.png' });
    console.log('  ✓ Captured screenshot-apikey-created.png');

    // Extract the API key from the modal
    console.log('  Extracting API Key...');
    const apiKey = await this.page.evaluate(() => {
      const modals = Array.from(document.querySelectorAll('.ant-modal-wrap, .ant-modal, .ant-notification, .ant-message'));
      for (const modal of modals) {
        const text = modal.innerText;
        const match = text.match(/sk-[a-zA-Z0-9_\-]+/);
        if (match) return match[0];
        
        const input = modal.querySelector('input, textarea');
        if (input && input.value && input.value.startsWith('sk-')) {
          return input.value;
        }
      }
      
      const bodyText = document.body.innerText;
      const bodyMatch = bodyText.match(/sk-[a-zA-Z0-9_\-]+/);
      return bodyMatch ? bodyMatch[0] : null;
    });

    if (apiKey) {
      console.log(`  ✓ Extracted API Key: ${apiKey}`);
    } else {
      console.log('  ! Failed to extract API Key from screen');
    }

    // Close success modal if there is one
    const closeBtn = await this.page.$('.ant-modal-footer button, .ant-modal-wrap button:has-text("OK"), .ant-modal-wrap button:has-text("Close"), .ant-modal-wrap button:has-text("Confirm")');
    if (closeBtn) {
      await closeBtn.click().catch(() => {});
      await this.page.waitForTimeout(2000);
    } else {
      await this.page.keyboard.press('Escape').catch(() => {});
    }

    return apiKey;
  }

  async fillUltraspeedForm(email) {
    console.log('[Step 7.5] Navigating to Ultraspeed form page...');
    
    // Navigate to form page
    await this.page.goto('https://platform.xiaomimimo.com/ultraspeed', {
      waitUntil: 'networkidle',
      timeout: this.config.browser.timeout
    });
    console.log('✓ Form page loaded');
    await this.page.waitForTimeout(5000);

    // Debugging: take screenshot and print URL/Title
    console.log(`  Current page URL: ${this.page.url()}`);
    console.log(`  Current page Title: ${await this.page.title()}`);
    await this.page.screenshot({ path: 'screenshot-1-loaded.png', fullPage: true });
    console.log('  ✓ Captured screenshot-1-loaded.png');

    // Print any modal texts if present
    const modalTexts = await this.page.evaluate(() => {
      const modals = Array.from(document.querySelectorAll('.ant-modal, [class*="modal"], [class*="dialog"]'));
      return modals.map(m => m.innerText).filter(Boolean);
    });
    if (modalTexts.length > 0) {
      console.log('  [Debug] Modals/Dialogs detected on page:');
      modalTexts.forEach((text, i) => console.log(`    Modal ${i + 1}:\n${text}\n---`));
    }

    // Check if redirected to login/authorization page
    await this.handleOAuthRedirect();

    // Accept cookies if present (with waiting for selector)
    const acceptCookiesBtn = await this.page.waitForSelector('button:has-text("Accept All"), button:has-text("Accept")', { timeout: 4000 }).catch(() => null);
    if (acceptCookiesBtn) {
      await acceptCookiesBtn.click({ force: true }).catch(() => {});
      console.log('  ✓ Accepted cookies');
      await this.page.waitForTimeout(2000);
    }

    // Handle Terms & Agreements modal if present
    await this.handleTermsModal();
    await this.waitForOverlaysGone();

    // Generate random name and phone number
    const firstNames = ['Adit', 'Bintang', 'Rian', 'Bayu', 'Dedi', 'Dimas', 'Eko', 'Fajar', 'Gilang', 'Heri', 'Agus', 'Budi', 'Rudi', 'Hendro'];
    const lastNames = ['Nugraha', 'Wira', 'Saputra', 'Pratama', 'Hidayat', 'Kurniawan', 'Santoso', 'Wijaya', 'Susilo', 'Setiawan'];
    const randomName = `${firstNames[Math.floor(Math.random() * firstNames.length)]} Susilo ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
    
    const randomPhone = '812' + Math.floor(10000000 + Math.random() * 90000000); // 812xxxxxxxx
    
    console.log(`  Name to fill: ${randomName}`);
    console.log(`  Phone number to fill: +62${randomPhone}`);

    // Helper: fill field by label text using .ant-form-item filter (precise)
    // MODE CEPAT: pakai locator.fill() langsung, gak typing per-char
    const fillByLabel = async (labelText, value, inputSelector = 'input') => {
      try {
        const formItem = this.page.locator('.ant-form-item').filter({ hasText: new RegExp(`^${labelText}`) });
        const count = await formItem.count();
        if (count > 0) {
          const input = formItem.first().locator(inputSelector);
          if (await input.count() > 0) {
            await input.first().fill(value);
            console.log(`  ✓ Filled "${labelText}" via form-item filter (fast)`);
            await this.page.waitForTimeout(150);
            return true;
          }
        }
      } catch (e) {}
      return false;
    };

    // Wait for form to fully load
    await this.page.waitForSelector('.ant-form-item', { timeout: 10000 });
    await this.page.waitForTimeout(1000);

    // Get all visible inputs in order as fallback
    const allInputs = await this.page.$$('input[placeholder="Please enter"]:visible, input[placeholder*="enter" i]');
    console.log(`  Found ${allInputs.length} "Please enter" inputs on page`);

    // Fill "Your name" (input index 0)
    const nameFilled = await fillByLabel('Your name', randomName);
    if (!nameFilled) {
      const inputs = await this.page.$$('input[placeholder="Please enter"]');
      if (inputs[0]) { await inputs[0].fill(randomName); console.log('  ✓ Filled Name (fast fallback)'); await this.page.waitForTimeout(150); }
    }

    // Select Phone Prefix "+62" and fill Phone number
    try {
      await this.selectDropdownOption('Phone number', '+62', false);
      const phoneFormItem = this.page.locator('.ant-form-item').filter({ hasText: /^Phone number/ });
      const phoneInput = phoneFormItem.first().locator('input[placeholder="Please enter"]');
      if (await phoneInput.count() > 0) {
        await phoneInput.first().fill(randomPhone);
        console.log('  ✓ Filled Phone (fast)');
        await this.page.waitForTimeout(150);
      }
    } catch (e) {
      console.log('  ! Phone fill error:', e.message);
      const inputs = await this.page.$$('input[placeholder="Please enter"]');
      if (inputs[1]) { await inputs[1].fill(randomPhone); console.log('  ✓ Filled Phone (fast fallback)'); await this.page.waitForTimeout(150); }
    }

    // Fill "Email" (input index 2)
    const emailFilled = await fillByLabel('Email', email);
    if (!emailFilled) {
      const inputs = await this.page.$$('input[placeholder="Please enter"]');
      if (inputs[2]) { await inputs[2].fill(email); console.log('  ✓ Filled Email (fast fallback)'); await this.page.waitForTimeout(150); }
    }

    // Fill "Company name" (input index 3)
    const companyFilled = await fillByLabel('Company name', 'SignalStack');
    if (!companyFilled) {
      const inputs = await this.page.$$('input[placeholder="Please enter"]');
      if (inputs[3]) { await inputs[3].fill('SignalStack'); console.log('  ✓ Filled Company (fast fallback)'); await this.page.waitForTimeout(150); }
    }

    // Select "Industry" dropdown → exact match "Finance"
    try {
      await this.selectDropdownOption('Industry', 'Finance', true);
    } catch (e) {
      console.log('  ! Industry dropdown error:', e.message);
    }

    // Select "Your use case" dropdown → "Latency-critical tasks..."
    try {
      await this.selectDropdownOption('Your use case', 'Latency-critical', false);
    } catch (e) {
      console.log('  ! Use case dropdown error:', e.message);
    }

    // Fill "Anything else you'd like to share" textarea — MODE CEPAT
    const shareText = `Building automated trading systems that need to process market data and execute decisions in milliseconds. We use LLMs for risk assessment, sentiment analysis on news feeds, and generating trade rationale in real time. The challenge is that traditional models add too much latency to the decision loop. Exploring MiMo UltraSpeed to see if inference can happen fast enough to actually be part of the execution path rather than a post-hoc analysis tool. Running about 40k calls daily across different strategy pipelines.`;
    try {
      const textarea = this.page.locator('textarea').first();
      if (await textarea.count() > 0) {
        await textarea.fill(shareText);
        console.log('  ✓ Filled share textarea (fast)');
      }
    } catch (e) {
      console.log('  ! Textarea fill error:', e.message);
    }

    // Screenshot before submit
    await this.page.waitForTimeout(1000);
    await this.page.screenshot({ path: 'screenshot-3-before-submit.png', fullPage: true });
    console.log('  ✓ Captured screenshot-3-before-submit.png');

    // Submit Application
    console.log('  Submitting application...');
    try {
      // Find the button using both Playwright locator and page.evaluate fallback
      const clickedResult = await this.page.evaluate(() => {
        // Find all elements that look like buttons or are styled as buttons
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"], .ant-btn, input[type="submit"]'));
        const submitBtn = allButtons.find(btn => {
          const txt = (btn.textContent || '').trim();
          return txt.includes('Submit') || txt.includes('Submit Application') || txt.includes('Application');
        });
        
        if (submitBtn) {
          // Check if disabled
          const isDisabled = submitBtn.disabled || submitBtn.getAttribute('disabled') !== null || submitBtn.classList.contains('ant-btn-disabled');
          
          // Scroll into view
          submitBtn.scrollIntoView({ block: 'center', inline: 'nearest' });
          
          // Click it natively
          submitBtn.click();
          return { success: true, text: submitBtn.textContent.trim(), disabled: isDisabled };
        }
        return { success: false, reason: 'No submit button found in DOM' };
      });
      
      console.log(`  ✓ Submit button click result: ${JSON.stringify(clickedResult)}`);
      
      // Wait for "Before you submit" modal to appear and click "Got it"
      console.log('  Waiting for "Before you submit" confirmation modal...');
      const gotItBtn = await this.page.waitForSelector('.ant-modal-wrap button:has-text("Got it"), button:has-text("Got it")', { timeout: 6000 }).catch(() => null);
      if (gotItBtn) {
        console.log('  ✓ Found "Got it" confirmation button, clicking...');
        await gotItBtn.click({ force: true });
        console.log('  ✓ Clicked "Got it" confirmation button');
        
        // Wait a few seconds for actual form submission to process
        await this.page.waitForTimeout(6000);
      } else {
        console.log('  ! "Got it" confirmation button not found (might have submitted directly or failed)');
      }
      
      // Print page text snapshot to check if it succeeded
      const postSubmitText = await this.page.evaluate(() => document.body.innerText);
      console.log('  [Post-Submit Text Snapshot (first 400 chars)]:\n', postSubmitText.substring(0, 400).replace(/\n/g, ' | '));
      
      await this.page.screenshot({ path: 'screenshot-4-after-submit.png', fullPage: true });
      console.log('  ✓ Captured screenshot-4-after-submit.png');
    } catch (e) {
      console.log('  ! Submit button error:', e.message);
    }
  }

  /**
   * Ambil kode referal milik akun yang sedang login.
   * Strategi:
   *   1. Scan semua link/href yang ada ?ref=XXXXXX
   *   2. Cari teks "Invite code: XXXXXX" di body
   *   3. Klik tombol "Refer & earn" / "Invite friends" → modal → scan + clipboard
   */
  async getReferralCode() {
    // Navigate ke balance page (kalau belum di sana)
    const currentUrl = this.page.url();
    if (!currentUrl.includes('/console/balance')) {
      try { await this.clickConsoleMenu(); } catch (e) {}

      if (!this.page.url().includes('/console/balance')) {
        await this.page.goto('https://platform.xiaomimimo.com/console/balance', {
          waitUntil: 'networkidle',
          timeout: this.config.browser.timeout,
        });
      }
      await this.handleOAuthRedirect();
      await humanDelay(1500, 2500);
      await this.handleTermsModal();
      await this.waitForOverlaysGone();
    }

    // Strategi 1: scan ?ref= di link/anchor/data-clipboard
    console.log('  Scanning for ?ref= links...');
    let refCode = await this.page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a, [data-href], [data-clipboard-text]'));
      for (const a of anchors) {
        const href = a.href || a.getAttribute('data-href') || a.getAttribute('data-clipboard-text') || '';
        const m = href.match(/[?&]ref=([A-Z0-9]{6})\b/i);
        if (m) return m[1].toUpperCase();
      }
      const inputs = Array.from(document.querySelectorAll('input[readonly], textarea[readonly]'));
      for (const inp of inputs) {
        const v = inp.value || '';
        const m = v.match(/[?&]ref=([A-Z0-9]{6})\b/i);
        if (m) return m[1].toUpperCase();
      }
      return null;
    });
    if (isValidRefCode(refCode)) return refCode;
    if (refCode) console.log('  ! Strategi 1 hasil "${refCode}" ditolak (blacklist/invalid)');
    refCode = null;

    // Strategi 2: regex teks plain — 3 pattern, hasil divalidasi
    console.log('  Scanning page text for ref code patterns...');
    refCode = await this.page.evaluate(() => {
      const text = document.body.innerText;
      const m1 = text.match(/[?&]ref=([A-Z0-9]{6})\b/i);
      if (m1) return m1[1].toUpperCase();
      const m2 = text.match(/(?:invite\s+code|referral\s+code|your\s+code)[\s:\n]+([A-Z0-9]{6})\b/i);
      if (m2) return m2[1].toUpperCase();
      const m3 = text.match(/\bcode\s*:\s*([A-Z0-9]{6})\b/i);
      if (m3) return m3[1].toUpperCase();
      return null;
    });
    if (isValidRefCode(refCode)) return refCode;
    if (refCode) console.log('  ! Strategi 2 hasil "${refCode}" ditolak (blacklist/invalid)');
    refCode = null;

    // Strategi 3: klik Refer & earn / Invite → modal → scan + clipboard
    console.log('  Trying to click Refer & earn / Invite button...');
    const opened = await this.page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      const target = all.find(el => {
        const txt = (el.textContent || '').trim();
        return /^(Refer\s*&\s*earn|Refer\s*and\s*earn|Invite( friends)?|Share|Refer( friends)?)$/i.test(txt) && el.offsetHeight > 0;
      });
      if (target) {
        target.scrollIntoView({ block: 'center' });
        target.click();
        return true;
      }
      return false;
    });

    if (opened) {
      console.log('  ✓ Clicked Refer & earn / Invite button, waiting for modal...');
      await this.page.waitForFunction(() => {
        const modals = Array.from(document.querySelectorAll('.ant-modal, .ant-modal-content, .ant-modal-wrap, [role="dialog"]'));
        return modals.some(m => {
          if (m.offsetHeight === 0 || m.style.display === 'none') return false;
          const t = (m.innerText || '').toLowerCase();
          return t.includes('invite code') || t.includes('invite builder') || t.includes('refer & earn');
        });
      }, { timeout: 8000 }).catch(() => {});
      await humanDelay(800, 1400);

      try {
        await this.page.evaluate(async () => {
          try { await navigator.clipboard.writeText(''); } catch (e) {}
        });
      } catch (e) {}

      for (let attempt = 1; attempt <= 3 && !refCode; attempt++) {
        const candidate = await this.page.evaluate(() => {
          const modal = Array.from(document.querySelectorAll('.ant-modal, .ant-modal-content, .ant-modal-wrap, [role="dialog"]'))
            .find(m => m.offsetHeight > 0 && (m.style.display !== 'none'));
          const scope = modal || document.body;

          const els = Array.from(scope.querySelectorAll('a, [data-clipboard-text], [data-href], input, textarea, span, div'));
          for (const el of els) {
            const sources = [
              el.href, el.value, el.getAttribute('data-clipboard-text'),
              el.getAttribute('data-href'), el.getAttribute('data-link'),
              el.textContent,
            ];
            for (const s of sources) {
              if (!s) continue;
              const m = s.match(/[?&]ref=([A-Z0-9]{6})\b/i);
              if (m) return m[1].toUpperCase();
            }
          }
          const text = scope.innerText || '';
          const m1 = text.match(/[?&]ref=([A-Z0-9]{6})\b/i);
          if (m1) return m1[1].toUpperCase();
          const m2 = text.match(/(?:invite\s+code|referral\s+code|your\s+code)[\s:\n]+([A-Z0-9]{6})\b/i);
          if (m2) return m2[1].toUpperCase();
          const m3 = text.match(/\bcode\s*:\s*([A-Z0-9]{6})\b/i);
          if (m3) return m3[1].toUpperCase();
          return null;
        });
        if (isValidRefCode(candidate)) {
          refCode = candidate;
          break;
        }
        if (candidate) {
          console.log('  ! Modal attempt ${attempt} hasil "${candidate}" ditolak (blacklist)');
        }
        if (attempt < 3) {
          console.log('  Modal scan attempt ${attempt} empty, retry in 1.5s...');
          await humanDelay(1200, 1800);
        }
      }

      if (!refCode) {
        console.log('  ! Ref code not in modal text, trying Copy button + clipboard...');
        try {
          const ctx = this.page.context();
          await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});

          const copyBtnText = await this.page.evaluate(() => {
            const modals = Array.from(document.querySelectorAll('.ant-modal, .ant-modal-content, [role="dialog"]'))
              .filter(m => m.offsetHeight > 0);
            const referModal = modals.find(m => {
              const t = (m.innerText || '').toLowerCase();
              return t.includes('invite code') || t.includes('invite builder') || t.includes('refer & earn');
            }) || modals[modals.length - 1];
            if (!referModal) return null;

            const btns = Array.from(referModal.querySelectorAll('button, a, [role="button"], [data-clipboard-text]'));
            const copy = btns.find(b => /^(copy|copy link|salin)/i.test((b.textContent || '').trim()));
            if (!copy) return null;
            return {
              clipText: copy.getAttribute('data-clipboard-text'),
              link: copy.getAttribute('data-link') || copy.getAttribute('data-href'),
              value: copy.value,
            };
          });

          if (copyBtnText) {
            console.log('  Copy button attrs: ${JSON.stringify(copyBtnText)}');
            for (const v of Object.values(copyBtnText)) {
              if (!v) continue;
              const s = String(v);
              const m = s.match(/[?&]ref=([A-Z0-9]{6})\b/i);
              if (m && isValidRefCode(m[1])) { refCode = m[1].toUpperCase(); break; }
              const trimmed = s.trim().toUpperCase();
              if (isValidRefCode(trimmed)) { refCode = trimmed; break; }
            }
          }

          if (!refCode) {
            await this.page.bringToFront().catch(() => {});
            await this.page.evaluate(() => {
              const modal = Array.from(document.querySelectorAll('.ant-modal, .ant-modal-content, .ant-modal-wrap, [role="dialog"]'))
                .find(m => m.offsetHeight > 0);
              if (!modal) return false;
              const btns = Array.from(modal.querySelectorAll('button, a, [role="button"]'));
              const copy = btns.find(b => /^(copy|copy link|salin)/i.test((b.textContent || '').trim()));
              if (copy) { copy.click(); return true; }
              return false;
            });
            await humanDelay(900, 1400);

            const clipboardText = await this.page.evaluate(async () => {
              try { window.focus(); } catch (e) {}
              try {
                return await navigator.clipboard.readText();
              } catch (e) {
                return '';
              }
            });
            if (clipboardText) {
              console.log('  Clipboard: ${clipboardText.substring(0, 100)}');
              const m1 = clipboardText.match(/[?&]ref=([A-Z0-9]{6})\b/i);
              if (m1 && isValidRefCode(m1[1])) {
                refCode = m1[1].toUpperCase();
              } else {
                const trimmed = clipboardText.trim().toUpperCase();
                if (isValidRefCode(trimmed)) {
                  refCode = trimmed;
                } else {
                  const m2 = clipboardText.match(/\b([A-Z0-9]{6})\b/i);
                  if (m2 && isValidRefCode(m2[1])) refCode = m2[1].toUpperCase();
                }
              }
            } else {
              console.log('  ! Clipboard empty (page may have lost focus)');
            }
          }
        } catch (clipErr) {
          console.log('  ! Clipboard read error: ${clipErr.message}');
        }
      }

      if (!refCode) {
        console.log('  ! All strategies failed — dumping debug artifacts');
        try {
          const ts = Date.now();
          await this.page.screenshot({
            path: 'error-refcode-${ts}.png',
            fullPage: false,
          });
          const modalHtml = await this.page.evaluate(() => {
            const modal = Array.from(document.querySelectorAll('.ant-modal, .ant-modal-content, [role="dialog"]'))
              .find(m => m.offsetHeight > 0);
            return modal ? modal.outerHTML.substring(0, 2000) : 'NO_MODAL';
          });
          console.log('  Modal HTML (preview): ${modalHtml.substring(0, 500)}');
        } catch (e) {}
      }

      await this.page.keyboard.press('Escape').catch(() => {});
    }

    return refCode;
  }
}

export { MimoRegistration, isValidRefCode };
