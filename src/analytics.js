/**
 * analytics.js
 * Fetches last 7 days of visitor stats from Google Analytics 4 Data API
 * using a service account (no OAuth flow needed — works in CI/GitHub Actions).
 */

import crypto from 'crypto';

// ─── JWT creation for Google service account auth ─────────────────────────────
function createJWT(serviceAccount) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');

  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(serviceAccount.private_key, 'base64url');

  return `${header}.${payload}.${signature}`;
}

// ─── Exchange JWT for short-lived access token ────────────────────────────────
async function getAccessToken(serviceAccount) {
  const jwt = createJWT(serviceAccount);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await response.json();
  if (!data.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ─── Parse GA4 report rows into friendly objects ──────────────────────────────
function parseReport(gaResponse) {
  if (!gaResponse.rows || gaResponse.rows.length === 0) {
    return { dailyRows: [], totals: null };
  }

  const metricNames = gaResponse.metricHeaders.map(h => h.name);
  const dimNames    = gaResponse.dimensionHeaders.map(h => h.name);

  const dailyRows = gaResponse.rows.map(row => {
    const dims    = Object.fromEntries(row.dimensionValues.map((v, i) => [dimNames[i], v.value]));
    const metrics = Object.fromEntries(row.metricValues.map((v, i)  => [metricNames[i], v.value]));
    return { ...dims, ...metrics };
  });

  // Roll up totals across all days
  const totals = {
    sessions:               dailyRows.reduce((s, r) => s + parseInt(r.sessions  || 0), 0),
    activeUsers:            dailyRows.reduce((s, r) => s + parseInt(r.activeUsers || 0), 0),
    screenPageViews:        dailyRows.reduce((s, r) => s + parseInt(r.screenPageViews || 0), 0),
    newUsers:               dailyRows.reduce((s, r) => s + parseInt(r.newUsers || 0), 0),
    avgBounceRate:          (dailyRows.reduce((s, r) => s + parseFloat(r.bounceRate || 0), 0) / dailyRows.length * 100).toFixed(1),
    avgSessionDurationSecs: (dailyRows.reduce((s, r) => s + parseFloat(r.averageSessionDuration || 0), 0) / dailyRows.length).toFixed(0),
  };

  return { dailyRows, totals };
}

// ─── Main export: fetch GA4 stats for one property ───────────────────────────
export async function fetchAnalytics(propertyId, serviceAccountJson) {
  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    const token = await getAccessToken(serviceAccount);

    const response = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
          metrics: [
            { name: 'sessions' },
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
            { name: 'newUsers' },
            { name: 'bounceRate' },
            { name: 'averageSessionDuration' },
          ],
          dimensions: [{ name: 'date' }],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`GA4 API ${response.status}: ${err}`);
    }

    const raw = await response.json();
    const { dailyRows, totals } = parseReport(raw);

    console.log(`  ✓ GA4 (property ${propertyId}): ${totals?.sessions ?? 0} sessions last 7 days`);
    return { propertyId, totals, dailyRows, error: null };

  } catch (err) {
    console.warn(`  ⚠ GA4 fetch failed for property ${propertyId}: ${err.message}`);
    return { propertyId, totals: null, dailyRows: [], error: err.message };
  }
}
