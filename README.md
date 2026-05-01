# Website Monitor Agent

A Claude-powered agent that audits your portfolio websites every Monday and emails you a health report.

## What it checks

| Check | Details |
|---|---|
| **Uptime** | HTTP 200 status code |
| **Response time** | Flags if > 2000ms |
| **SSL certificate** | Days until expiry, warns if < 30 days |
| **SEO meta tags** | title, description, og:title, canonical, viewport, H1 count |
| **Page size** | Total HTML payload in KB |

## Setup (one-time, ~10 minutes)

### 1. Fork / clone this repo into your GitHub account

### 2. Enable Gmail App Password
1. Go to your Google Account → Security → 2-Step Verification (enable if not already)
2. Go to **App passwords** → create one named "Website Monitor"
3. Copy the 16-character password (you'll need it in step 3)

### 3. Add GitHub Secrets
Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Claude API key from console.anthropic.com |
| `GMAIL_USER` | Your Gmail address (e.g. naveen@gmail.com) |
| `GMAIL_APP_PASSWORD` | The 16-char app password from step 2 |
| `REPORT_RECIPIENT` | Email to receive reports (can be same as GMAIL_USER) |

### 4. Trigger your first run
Go to **Actions → Weekly Website Monitor → Run workflow** to test immediately.

## Schedule
Runs every **Monday at 8:00 AM IST** (configured in `.github/workflows/website-monitor.yml`).  
Change the cron `'30 2 * * 1'` to any schedule you prefer (uses UTC).

## Adding more websites
Edit the `WEBSITES` array in `src/monitor.js`:

```js
const WEBSITES = [
  { name: 'My Site', url: 'https://example.com/' },
  // add more here
];
```

## Local testing
```bash
npm install
ANTHROPIC_API_KEY=sk-... GMAIL_USER=you@gmail.com GMAIL_APP_PASSWORD=xxxx REPORT_RECIPIENT=you@gmail.com node src/monitor.js
```
