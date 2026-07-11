// ─────────────────────────────────────────────────────────────
// PROVIDER LAYER — Apify Instagram scraper.
//
// This is the ONLY file that knows about Apify. Everything upstream
// (outlier engine, Airtable writer) speaks the normalized shape below.
// To switch to a different scraper, you replace only this file.
//
// NORMALIZED SHAPE per account:
//   { followerCount, reels: [{ shortcode, url, thumbnailUrl, views, caption, timestamp }] }
// ─────────────────────────────────────────────────────────────

import { config } from '../config.js';

const APIFY_BASE = 'https://api.apify.com/v2';

// How many accounts to scrape in a single Apify run. Batching many accounts
// per run is what makes this fast. Kept modest so each run finishes well
// inside Apify's synchronous time limit.
const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 15;

// Runs the actor and returns dataset items directly.
async function runActor(input) {
  const url =
    `${APIFY_BASE}/acts/${config.apify.actorId}/run-sync-get-dataset-items` +
    `?token=${config.apify.token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify run failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ── Defensive field readers (actors label things differently) ──
const firstDefined = (obj, keys) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
};
const readViews = (post) =>
  Number(firstDefined(post, ['videoPlayCount', 'videoViewCount', 'playCount', 'viewsCount', 'views']) || 0);
const readFollowers = (obj) =>
  Number(firstDefined(obj, ['followersCount', 'followers', 'followerCount']) || 0);
const readShortcode = (post) => firstDefined(post, ['shortCode', 'shortcode', 'code']) || '';
const readThumb = (post) => firstDefined(post, ['displayUrl', 'thumbnailUrl', 'imageUrl', 'thumbnail']) || '';
const readCaption = (post) => {
  const c = firstDefined(post, ['caption', 'text', 'title']);
  if (typeof c === 'string') return c;
  if (c && typeof c.text === 'string') return c.text;
  return '';
};
const readTimestamp = (post) =>
  firstDefined(post, ['timestamp', 'takenAt', 'takenAtTimestamp', 'time']) || null;
const readOwner = (post) => {
  const name =
    firstDefined(post, ['ownerUsername']) ||
    (post.owner && firstDefined(post.owner, ['username'])) ||
    (post.user && firstDefined(post.user, ['username'])) ||
    '';
  return String(name).toLowerCase();
};

const clean = (h) => h.replace(/^@/, '').trim();
const toReel = (it) => ({
  shortcode: readShortcode(it),
  url: firstDefined(it, ['url']) || `https://www.instagram.com/reel/${readShortcode(it)}/`,
  thumbnailUrl: readThumb(it),
  views: readViews(it),
  caption: readCaption(it),
  timestamp: readTimestamp(it),
});

// ── FAST PATH — scrape many accounts across a few batched runs. ──
// Returns a Map: handle -> { followerCount, reels }.
export async function fetchManyAccounts(handles) {
  const cleaned = handles.map(clean).filter(Boolean);
  const byOwner = new Map();

  for (let i = 0; i < cleaned.length; i += BATCH_SIZE) {
    const chunk = cleaned.slice(i, i + BATCH_SIZE);
    const input = {
      directUrls: chunk.map((h) => `https://www.instagram.com/${h}/reels/`),
      resultsType: 'posts',
      resultsLimit: config.reelsPerAccount,
      addParentData: true,
    };

    let items;
    try {
      items = await runActor(input);
    } catch (err) {
      console.log(`  batch ${i / BATCH_SIZE + 1} failed: ${err.message}`);
      continue; // one bad batch shouldn't sink the whole run
    }
    if (!Array.isArray(items)) continue;

    for (const it of items) {
      if (!readShortcode(it)) continue;
      const owner = readOwner(it);
      if (!owner) continue;
      if (!byOwner.has(owner)) byOwner.set(owner, { followerCount: 0, reels: [] });
      const bucket = byOwner.get(owner);
      if (!bucket.followerCount) {
        const f = readFollowers(it.owner || it.user || it) || readFollowers(it);
        if (f) bucket.followerCount = f;
      }
      bucket.reels.push(toReel(it));
    }
  }

  // Map results back to every requested handle (empty if nothing came back).
  const result = new Map();
  for (const h of cleaned) {
    result.set(h, byOwner.get(h.toLowerCase()) || { followerCount: 0, reels: [] });
  }
  return result;
}

// ── Single-account version (kept for testing / fallback). ──
export async function fetchAccountReels(handle) {
  const map = await fetchManyAccounts([handle]);
  return map.get(clean(handle)) || { followerCount: 0, reels: [] };
}
