/**
 * analytics.js
 * Fetches last 7 days of visitor stats from GoatCounter REST API.
 * GoatCounter is free for personal use — no payment required.
 * https://www.goatcounter.com
 */

// ─── Format a date as YYYY-MM-DD ─────────────────────────────────────────────
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// ─── Fetch total pageview stats for last 7 days ───────────────────────────────
async function fetchTotals(siteCode, apiToken) {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);

  const url = `https://${siteCode}.goatcounter.com/api/v0/stats/total?start=${formatDate(start)}&end=${formatDate(end)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
  });

  if (!res.ok) throw new Error(`GoatCounter totals error ${res.status}: ${await res.text()}`);
  return res.json(); // { total, total_unique }
}

// ─── Fetch daily breakdown for sparkline/table ────────────────────────────────
async function fetchDaily(siteCode, apiToken) {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);

  const url = `https://${siteCode}.goatcounter.com/api/v0/stats/hits?start=${formatDate(start)}&end=${formatDate(end)}&daily=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
  });

  if (!res.ok) throw new Error(`GoatCounter hits error ${res.status}: ${await res.text()}`);
  const data = await res.json();

  // Flatten into [{date, pageviews, visitors}]
  return (data.hits || []).map(h => ({
    date:      h.day,
    pageviews: h.count,
    visitors:  h.count_unique,
  }));
}

// ─── Fetch top pages for last 7 days ─────────────────────────────────────────
async function fetchTopPages(siteCode, apiToken) {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);

  const url = `https://${siteCode}.goatcounter.com/api/v0/stats/pages?start=${formatDate(start)}&end=${formatDate(end)}&limit=5`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
  });

  if (!res.ok) throw new Error(`GoatCounter pages error ${res.status}: ${await res.text()}`);
  const data = await res.json();

  return (data.pages || []).map(p => ({
    path:      p.path,
    pageviews: p.count,
    visitors:  p.count_unique,
  }));
}

// ─── Fetch top referrers ──────────────────────────────────────────────────────
async function fetchReferrers(siteCode, apiToken) {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);

  const url = `https://${siteCode}.goatcounter.com/api/v0/stats/refs?start=${formatDate(start)}&end=${formatDate(end)}&limit=5`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
  });

  if (!res.ok) throw new Error(`GoatCounter refs error ${res.status}: ${await res.text()}`);
  const data = await res.json();

  return (data.refs || []).map(r => ({
    referrer:  r.ref || '(direct)',
    pageviews: r.count,
    visitors:  r.count_unique,
  }));
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function fetchAnalytics(siteCode, apiToken) {
  try {
    const [totals, dailyRows, topPages, referrers] = await Promise.all([
      fetchTotals(siteCode, apiToken),
      fetchDaily(siteCode, apiToken),
      fetchTopPages(siteCode, apiToken),
      fetchReferrers(siteCode, apiToken),
    ]);

    console.log(`  ✓ GoatCounter (${siteCode}): ${totals.total} pageviews, ${totals.total_unique} visitors last 7 days`);

    return {
      available: true,
      error: null,
      totals: {
        pageviews: totals.total,
        uniqueVisitors: totals.total_unique,
      },
      dailyRows,
      topPages,
      referrers,
    };
  } catch (err) {
    console.warn(`  ⚠ GoatCounter fetch failed for ${siteCode}: ${err.message}`);
    return {
      available: false,
      error: err.message,
      totals: null,
      dailyRows: [],
      topPages: [],
      referrers: [],
    };
  }
}
