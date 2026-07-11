// ─────────────────────────────────────────────────────────────
// AIRTABLE LAYER — talks to the "Reel Radar" base over the REST API.
// Uses field NAMES (stable) rather than IDs for readability.
// ─────────────────────────────────────────────────────────────

import { config } from './config.js';

const API = 'https://api.airtable.com/v0';

function url(table, suffix = '') {
  return `${API}/${config.airtable.baseId}/${encodeURIComponent(table)}${suffix}`;
}

function headers() {
  return {
    Authorization: `Bearer ${config.airtable.token}`,
    'Content-Type': 'application/json',
  };
}

async function airtableFetch(fullUrl, options = {}) {
  const res = await fetch(fullUrl, { ...options, headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Pull every record from a table, following pagination.
async function listAll(table, params = {}) {
  const records = [];
  let offset;
  do {
    const qs = new URLSearchParams({ pageSize: '100', ...params });
    if (offset) qs.set('offset', offset);
    const data = await airtableFetch(url(table, `?${qs}`));
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

// Accounts marked Active, normalized for the pipeline.
export async function getActiveAccounts() {
  const records = await listAll(config.airtable.accountsTable, {
    filterByFormula: '{Active}=1',
  });
  return records.map((r) => ({
    id: r.id,
    handle: (r.fields.Handle || '').trim(),
    model: r.fields.Model || 'Unassigned',
  })).filter((a) => a.handle);
}

// Shortcodes already in the queue — so we never surface a reel twice.
export async function getExistingShortcodes() {
  const records = await listAll(config.airtable.queueTable, {
    fields: ['Shortcode'],
  });
  return new Set(records.map((r) => r.fields.Shortcode).filter(Boolean));
}

// Store the freshly scraped follower count + median back on the account row.
export async function updateAccountStats(recordId, followerCount, medianViews) {
  const today = new Date().toISOString().slice(0, 10);
  await airtableFetch(url(config.airtable.accountsTable), {
    method: 'PATCH',
    body: JSON.stringify({
      typecast: true,
      records: [
        {
          id: recordId,
          fields: {
            'Follower Count': followerCount || 0,
            'Median Views': medianViews || 0,
            'Last Scraped': today,
          },
        },
      ],
    }),
  });
}

// Write new outlier reels into the queue (batched, max 10 per request).
export async function writeReelRows(rows) {
  const today = new Date().toISOString().slice(0, 10);
  let written = 0;

  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10).map((r) => ({
      fields: {
        Shortcode: r.shortcode,
        'Reel URL': r.url,
        Thumbnail: r.thumbnailUrl ? [{ url: r.thumbnailUrl }] : undefined,
        'Source Handle': r.handle,
        Model: r.model,
        Views: r.views,
        'Follower Ratio': r.followerRatio,
        'Baseline Ratio': r.baselineRatio,
        'Posted Date': r.postedDate || undefined,
        'Surfaced Date': today,
        Caption: r.caption || '',
        Status: 'New',
      },
    }));

    await airtableFetch(url(config.airtable.queueTable), {
      method: 'POST',
      body: JSON.stringify({ typecast: true, records: batch }),
    });
    written += batch.length;
  }
  return written;
}
