/**
 * Website Monitor Agent
 * Checks website health metrics + Google Analytics visitor stats,
 * generates an AI report via Claude (Gemini fallback),
 * and emails it weekly via Gmail SMTP.
 */

import https from 'https';
import http from 'http';
import tls from 'tls';
import { URL } from 'url';
import nodemailer from 'nodemailer';
import { fetchAnalytics } from './analytics.js';

// ─── Configuration ───────────────────────────────────────────────────────────
const WEBSITES = [
  {
    name: 'Naveen Narahari – Netlify',
    url: 'https://naraharinaveen.netlify.app/',
    gaPropertyId: process.env.GA_PROPERTY_NETLIFY,
  },
  {
    name: 'Naveen Narahari – GitHub Pages',
    url: 'https://naveennarahari.github.io/MyProfessionalPortfolio/',
    gaPropertyId: process.env.GA_PROPERTY_GITHUB,
  },
];

const ANTHROPIC_API_KEY       = process.env.ANTHROPIC_API_KEY;
const GEMINI_API_KEY          = process.env.GEMINI_API_KEY;
const GA_SERVICE_ACCOUNT_JSON = process.env.GA_SERVICE_ACCOUNT_JSON;
const GMAIL_USER              = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD      = process.env.GMAIL_APP_PASSWORD;
const REPORT_RECIPIENT        = process.env.REPORT_RECIPIENT || GMAIL_USER;

// ─── Utility: HTTP/HTTPS fetch with timing ───────────────────────────────────
function fetchPage(rawUrl) {
  return new Promise((resolve) => {
    const start = Date.now();
    const parsed = new URL(rawUrl);
    const lib = parsed.protocol === 'https:' ? https : http;

    const req = lib.get(rawUrl, { timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        resolve({ ok: true, status: res.statusCode, responseTimeMs: Date.now() - start, headers: res.headers, body });
      });
    });

    req.on('error',   (err) => resolve({ ok: false, error: err.message, responseTimeMs: Date.now() - start }));
    req.on('timeout', ()    => { req.destroy(); resolve({ ok: false, error: 'Timeout (10s)', responseTimeMs: 10000 }); });
  });
}

// ─── SSL Certificate check ───────────────────────────────────────────────────
function checkSSL(hostname) {
  return new Promise((resolve) => {
    try {
      const socket = tls.connect({ host: hostname, port: 443, servername: hostname, rejectUnauthorized: false }, () => {
        const cert = socket.getPeerCertificate();
        socket.destroy();
        if (!cert || !cert.valid_to) return resolve({ valid: false, error: 'No certificate returned' });
        const expiry   = new Date(cert.valid_to);
        const daysLeft = Math.round((expiry - Date.now()) / (1000 * 60 * 60 * 24));
        resolve({ valid: true, expiry: expiry.toDateString(), daysLeft, issuer: cert.issuer?.O || 'Unknown' });
      });
      socket.on('error', (err) => resolve({ valid: false, error: err.message }));
    } catch (err) {
      resolve({ valid: false, error: err.message });
    }
  });
}

// ─── Extract SEO meta tags from raw HTML ─────────────────────────────────────
function extractMeta(html) {
  const get = (pattern) => { const m = html.match(pattern); return m ? m[1].trim() : null; };
  return {
    title:       get(/<title[^>]*>([^<]+)<\/title>/i),
    description: get(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i),
    ogTitle:     get(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i),
    canonical:   get(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i),
    viewport:    html.includes('viewport') ? 'Present' : 'Missing',
    h1Count:     (html.match(/<h1[\s>]/gi) || []).length,
  };
}

// ─── Collect health metrics + analytics for one site ─────────────────────────
async function auditSite(site) {
  console.log(`\nAuditing: ${site.url}`);
  const parsed = new URL(site.url);

  const [page, ssl, analytics] = await Promise.all([
    fetchPage(site.url),
    checkSSL(parsed.hostname),
    site.gaPropertyId && GA_SERVICE_ACCOUNT_JSON
      ? fetchAnalytics(site.gaPropertyId, GA_SERVICE_ACCOUNT_JSON)
      : Promise.resolve(null),
  ]);

  const result = {
    name:          site.name,
    url:           site.url,
    timestamp:     new Date().toISOString(),
    uptime:        page.ok && page.status === 200,
    statusCode:    page.status || null,
    responseTimeMs:page.responseTimeMs,
    ssl,
    seo:           page.ok && page.body ? extractMeta(page.body) : null,
    contentSize:   page.ok && page.body ? `${(Buffer.byteLength(page.body, 'utf8') / 1024).toFixed(1)} KB` : null,
    error:         page.error || null,
    analytics: analytics
      ? { available: !analytics.error, error: analytics.error, totals: analytics.totals, dailyRows: analytics.dailyRows }
      : { available: false, reason: 'GA property ID or service account not configured' },
  };

  console.log(`  ✓ Status: ${result.statusCode} | RT: ${result.responseTimeMs}ms | SSL: ${ssl.daysLeft ?? 'N/A'}d left`);
  return result;
}

// ─── Shared prompt builder ────────────────────────────────────────────────────
function buildPrompt(auditResults, poweredBy) {
  return `You are a professional website monitoring agent reporting to Naveen Narahari, 
an Engineering Manager and portfolio owner. Analyse the following website audit data collected 
this week and produce a concise, actionable HTML email report.

AUDIT DATA:
${JSON.stringify(auditResults, null, 2)}

Your report must:
1. Use a clean, professional HTML email layout with inline CSS (no external stylesheets)
2. Start with an executive summary — overall health status (🟢 Healthy / 🟡 Warning / 🔴 Critical)
3. For each site include TWO sections:
   A. HEALTH METRICS — uptime, response time (flag if >2000ms), SSL days remaining (warn if <30), SEO tags
   B. VISITOR ANALYTICS (last 7 days) — if analytics.available is true, show:
      • Total sessions, active users, page views, new users in a small summary table
      • Avg bounce rate and avg session duration (convert seconds to mm:ss format)
      • A simple day-by-day mini table showing date | sessions | users
      If analytics.available is false, show a brief setup note
4. Include a "Recommendations" section with 2-3 specific, actionable improvements
   considering both health and traffic data
5. Colour scheme: #1a1a2e header, #16213e body, white cards with subtle borders
   Use light green (#e8f5e9) background for visitor stats cards
6. Keep it concise — this is a weekly digest, not a deep audit
7. Sign off as "Website Monitor Agent — Powered by ${poweredBy}"

Return ONLY the HTML content starting with <div — no markdown, no code fences, no explanations.`;
}

// ─── Claude API ───────────────────────────────────────────────────────────────
async function generateReportClaude(auditResults) {
  console.log('\n[AI] Attempting Claude API...');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, messages: [{ role: 'user', content: buildPrompt(auditResults, 'Claude') }] }),
  });
  if (!response.ok) throw new Error(`Claude API error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  console.log('  ✓ Claude responded successfully');
  return data.content[0].text;
}

// ─── Gemini API (fallback) ────────────────────────────────────────────────────
async function generateReportGemini(auditResults) {
  console.log('[AI] Falling back to Gemini API...');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: buildPrompt(auditResults, 'Gemini') }] }], generationConfig: { maxOutputTokens: 4000, temperature: 0.4 } }),
  });
  if (!response.ok) throw new Error(`Gemini API error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');
  console.log('  ✓ Gemini responded successfully');
  return text;
}

// ─── Orchestrator: Claude first, Gemini fallback ──────────────────────────────
async function generateReport(auditResults) {
  if (ANTHROPIC_API_KEY) {
    try { return await generateReportClaude(auditResults); }
    catch (err) { console.warn(`  ⚠ Claude failed: ${err.message}\n  → Switching to Gemini...`); }
  } else {
    console.log('[AI] ANTHROPIC_API_KEY not set — using Gemini directly.');
  }
  if (!GEMINI_API_KEY) throw new Error('Neither ANTHROPIC_API_KEY nor GEMINI_API_KEY configured.');
  return generateReportGemini(auditResults);
}

// ─── Send email via Gmail SMTP ────────────────────────────────────────────────
async function sendEmail(htmlReport, auditResults) {
  console.log('\nSending email via Gmail...');
  const allUp   = auditResults.every((r) => r.uptime);
  const status  = allUp ? '🟢 All Systems Healthy' : '🔴 Issues Detected';
  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
  const info = await transporter.sendMail({
    from: `"Website Monitor" <${GMAIL_USER}>`, to: REPORT_RECIPIENT,
    subject: `[Weekly Monitor] ${status} — ${dateStr}`, html: htmlReport,
  });
  console.log(`  ✓ Email sent: ${info.messageId}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Website Monitor Agent Starting ===');
  console.log(`Run time: ${new Date().toISOString()}\n`);
  try {
    const auditResults = await Promise.all(WEBSITES.map(auditSite));
    const htmlReport   = await generateReport(auditResults);
    await sendEmail(htmlReport, auditResults);
    console.log('\n=== Monitor run completed successfully ===');
  } catch (err) {
    console.error('\n[ERROR]', err.message);
    process.exit(1);
  }
}

main();
