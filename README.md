# MiMo Chain Bot

> Automated Xiaomi MiMo Open Platform registration via Google OAuth + Telegram admin bot
>
> Chain-loop: Google sign-in → create Xiaomi account → redeem invite code → API key → ultraspeed → capture ref code → repeat
>
> Telegram inline keyboard UI — control everything from your phone

---

## Features

| Feature | Detail |
|---|---|
| **Google OAuth sign-in** | Register via "Sign in with Google" — no captcha, no temp email |
| **Chain loop** | Auto-register accounts in chain — each new account uses previous ref code |
| **Email list** | Pre-configured Google accounts from `config/emails.txt` |
| **Auto-dedup** | Skips emails already registered (checks `chain-result.txt`) |
| **Random fingerprint** | Unique browser profile per account (UA, WebGL, canvas, locale, timezone, hardware) |
| **Human-like interaction** | Per-char typing, hover-before-click, random delays |
| **Multi-proxy** | Proxy pool with auto-rotation, health check, country-aware fingerprint |
| **Telegram bot** | Admin-only with inline keyboard, real-time progress, config editor |
| **Auto-clean chat** | Bot deletes previous messages for a clean UI |

---

## How It Works

```
For each account in config/emails.txt:
  │
  ├─ 1. Launch browser (random fingerprint)
  ├─ 2. Open referral link → Xiaomi sign-in page
  ├─ 3. Check terms checkbox → Click "Sign in with Google"
  ├─ 4. Google: enter email → Next → enter password → Next
  ├─ 5. Google: handle speedbump/consent pages → redirect to Xiaomi
  ├─ 6. Xiaomi "Create a Account" → checkbox → Next
  ├─ 7. Set random password → Complete
  ├─ 8. Redeem invite code (+$2 balance)
  ├─ 9. Create API key (sk-...)
  ├─ 10. Fill Ultraspeed application form
  ├─ 11. Capture referral code → chain to next account
  └─ 12. Save: email:password:refCode:apiKey:invitedBy
```

---

## Project Structure

```
chainbot/
├── src/
│   ├── clients/
│   │   ├── email-list.js   # Google account list reader (replaces tempmail)
│   │   ├── tempmail.js     # (legacy) Temporary email API client
│   │   └── captcha.js      # (legacy) 2Captcha solver
│   ├── core/
│   │   └── registration.js # Google OAuth + Xiaomi onboarding + post-registration
│   ├── browser/
│   │   ├── fingerprint.js  # Browser profile randomizer
│   │   ├── human.js        # Human-like interaction (typing, clicking)
│   │   └── proxy.js        # Proxy pool manager
│   ├── runner/
│   │   └── chain-runner.js # Event-based chain orchestrator
│   ├── bot/
│   │   ├── index.js        # Telegram bot entry point
│   │   ├── admin.js        # Admin whitelist middleware
│   │   ├── watermark.js    # Branding & integrity
│   │   ├── commands/       # Command handlers (chain, proxy, config, export)
│   │   └── ui/
│   │       └── keyboard.js # Inline keyboard builders
│   ├── config.js           # Config loader
│   └── index.js            # Barrel export
├── scripts/
│   ├── chain-loop.js       # CLI entry point
│   └── chain-loop-config.js
├── config/
│   ├── default.example.json # Config template
│   └── emails.txt          # Google account list (email:password)
├── output/                 # Results directory
│   ├── chain-result.txt    # Successful registrations
│   └── chain-fail.log      # Failed attempts
├── package.json
└── .gitignore
```

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **Chrome / Chromium** installed
- **Google accounts** (one per registration)
- **Telegram Bot Token** from [@BotFather](https://t.me/BotFather) (for bot mode)

### Installation

```bash
# 1. Clone repository
git clone https://github.com/andhikanurdyansyah/chainbot.git
cd chainbot

# 2. Install dependencies
npm install

# 3. Install Playwright browser
npx playwright install chrome
# Linux VPS only:
npx playwright install-deps

# 4. Create config
cp config/default.example.json config/default.json
```

### Configuration

Edit `config/default.json`:

```json
{
  "emailList": {
    "filePath": "config/emails.txt"
  },
  "xiaomi": {
    "referralLink": "https://platform.xiaomimimo.com/?ref=YOURCODE",
    "inviteCode": "YOURCODE",
    "betaApplication": "MiMo-V2.5-Pro-UltraSpeed"
  },
  "telegram": {
    "botToken": "YOUR_BOT_TOKEN",
    "adminIds": [YOUR_TELEGRAM_ID],
    "logChatId": null
  },
  "browser": {
    "headless": true,
    "timeout": 60000,
    "screenshots": false
  },
  "proxy": {
    "enabled": false,
    "rotatePerAccount": true,
    "defaultCountry": "US",
    "maxRetries": 3,
    "proxyList": []
  }
}
```

### Email List

Edit `config/emails.txt` — one Google account per line:

```
# format: email:password
yourname1@gmail.com:YourGooglePassword1
yourname2@gmail.com:YourGooglePassword2
```

**Auto-dedup**: Emails already in `output/chain-result.txt` are automatically skipped. No manual cleanup needed.

### Run

```bash
# Telegram Bot (recommended)
npm run bot

# CLI mode
npm run chain -- --count 5
npm run chain -- --count 3 --seed XXXXXX
npm test   # quick test with 1 account
```

---

## Telegram Bot Commands

| Command / Button | Action |
|---|---|
| `/start` | Main menu with status overview |
| `▶ Run Chain` | Select account count, start registration |
| `⏹ Stop` | Gracefully stop running chain |
| `🔌 Proxies` | View/add/delete proxy pool |
| `⚙ Config` | Edit referral code, API key, toggle proxy/headless |
| `📤 Export` | Download chain results as `.txt` |

### Live Progress

```
🚀 Chain Running
📌 Seed: XXXXXX
⏱ Elapsed: 2m 15s

████████░░░░░░░░
🔵 Processing..  ·  6/10
✅ 5 success  ·  ❌ 1 failed

📋 Latest:
✅ user1@gmail.com → USQWSH
✅ user2@gmail.com → UWCYHP
❌ user3@gmail.com → timeout
```

---

## Proxy Setup

Proxy format: `ip:port:username:password`

```json
"proxy": {
  "enabled": true,
  "defaultCountry": "SG",
  "proxyList": [
    "103.1.2.3:5000:user:pass",
    "104.1.2.3:5001:user:pass"
  ]
}
```

| `defaultCountry` | Locale | Timezone |
|---|---|---|
| `US` | en-US | America/Chicago |
| `SG` | en-SG | Asia/Singapore |
| `ID` | id-ID | Asia/Jakarta |
| `MY` | en-US | Asia/Kuala_Lumpur |
| `TH` | th-TH | Asia/Bangkok |
| `PH` | en-PH | Asia/Manila |
| `GB` | en-GB | Europe/London |

Proxy auto-rotate per account. Dead proxies (≥3 failures) are skipped and reset after 5 minutes.

---

## Output Format

`output/chain-result.txt`:
```
email:password:refCode:apiKey:invitedBy
user1@gmail.com:Pass1:K3M2P8:sk-aaa...bbb:T9K59J
user2@gmail.com:Pass2:LX8N2A:sk-ccc...ddd:K3M2P8
```

`output/chain-fail.log`:
```
[ISO timestamp] email | error message
```

---

## Performance

| Scenario | Per Account |
|---|---|
| No proxy (local IP) | ~2-4 minutes |
| Proxy Asia (SG/ID) | ~3-5 minutes |
| Proxy US | ~4-6 minutes |

Bottleneck: Google OAuth consent pages (variable load times).

---

## Troubleshooting

| Issue | Fix |
|---|---|
| **Google chrome-error** | Network failure during redirect — bot auto-retries with next account |
| **Speedbump stuck** | Google Workspace ToS page — bot handles automatically |
| **OAuth consent loading** | Page shows "Loading" — bot waits for content to render |
| **Account restricted** | IP flagged — switch proxy or wait hours |
| **Already registered** | Email auto-skipped (in chain-result.txt) |
| **Balance not credited** | Balance delayed by Xiaomi (≤5 min). Screenshot saved. |
| **Browser zombie** | Ctrl+C → auto-close. `pkill chrome` if stuck. |

---

## License

MIT

---

## Author

**andhikanurdyansyah** — [github.com/andhikanurdyansyah](https://github.com/andhikanurdyansyah)
