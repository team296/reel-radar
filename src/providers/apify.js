// ─────────────────────────────────────────────────────────────
// PROVIDER LAYER — Apify Instagram scraper.
//
// Two passes:
//   1. PROFILE pass  — gets follower counts (reels URLs don't carry them).
//   2. REELS pass    — gets recent reels + view counts.
// A pause between batches keeps Instagram from throttling us.
//
// NORMALIZED SHAPE per account:
//   { followerCount, reels: [{ shortcode, url, thumbnailUrl, views, caption, timestamp }] }
// ─────────────────────────────────────────────────────────────

import { config } from '../config.js';

const APIFY_BASE = 'https://api.apify.com/v2';
const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 10;
const PAUSE_MS = Number(process.env.PAUSE_MS) || 4000; // wait between batches

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    throw new Error(`Apify run failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── Defensive field readers ──
const firstDefined = (obj, keys) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
};
const readViews = (p) =>
  Number(firstDefined(p, ['videoPlayCount', 'videoViewCount', 'playCount', 'viewsCount', 'views']) || 0);
const readFollowers = (o) =>
  Number(firstDefined(o, ['followersCount', 'followers', 'followerCount']) || 0);
const readShortcode = (p) => firstDefined(p, ['shortCode', 'shortcode', 'code']) || '';
const readThumb = (p) => firstDefined(p, ['displayUrl', 'thumbnailUrl', 'imageUrl', 'thumbnail']) || '';
const readCaption = (p) => {
  const c = firstDefined(p, ['caption', 'text', 'title']);
  if (typeof c === 'string') return c;
  if (c && typeof c.text === 'string') return c.text;
  return '';
};
const readTimestamp = (p) =>
  firstDefined(p, ['timestamp', 'takenAt', 'takenAtTimestamp', 'time']) || null;
const readOwner = (p) => {
  const name =
    firstDefined(p, ['ownerUsername', 'username']) ||
    (p.owner && firstDefined(p.owner, ['username'])) ||
    (p.user && firstDefined(p.user, ['username'])) ||
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

// ── PASS 1: follower counts, from profile details ──
async function fetchFollowerCounts(handles) {
  const followers = new Map();
  for (let i = 0; i < handles.length; i += BATCH_SIZE) {
    const chunk = handles.slice(i, i + BATCH_SIZE);
    try {
      const items = await runActor({
        directUrls: chunk.map((h) => `https://www.instagram.com/${h}/`),
        resultsType: 'details',
        resultsLimit: 1,
      });
      if (Array.isArray(items)) {
        for (const it of items) {
          const name = readOwner(it);
          const f = readFollowers(it);
          if (name && f) followers.set(name, f);
        }
      }
    } catch (err) {
      console.log(`  profile batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err.message}`);
    }
    if (i + BATCH_SIZE < handles.length) await sleep(PAUSE_MS);
  }
  return followers;
}

// ── PASS 2: reels ──
async function fetchReelsFor(handles) {
  const byOwner = new Map();
  for (let i = 0; i < handles.length; i += BATCH_SIZE) {
    const chunk = handles.slice(i, i + BATCH_SIZE);
    let items;
    try {
      items = await runActor({
        directUrls: chunk.map((h) => `https://www.instagram.com/${h}/reels/`),
        resultsType: 'posts',
        resultsLimit: config.reelsPerAccount,
        addParentData: true,
      });
    } catch (err) {
      console.log(`  reels batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err.message}`);
      if (i + BATCH_SIZE < handles.length) await sleep(PAUSE_MS);
      continue;
    }
    if (Array.isArray(items)) {
      for (const it of items) {
        if (!readShortcode(it)) continue;
        const owner = readOwner(it);
        if (!owner) continue;
        if (!byOwner.has(owner)) byOwner.set(owner, []);
        byOwner.get(owner).push(toReel(it));
      }
    }
    if (i + BATCH_SIZE < handles.length) await sleep(PAUSE_MS);
  }
  return byOwner;
}

// ── Main ──
export async function fetchManyAccounts(handles) {
  const cleaned = handles.map(clean).filter(Boolean);

  console.log(`  pass 1/2: follower counts for ${cleaned.length} accounts...`);
  const followers = await fetchFollowerCounts(cleaned);
  console.log(`  got follower counts for ${followers.size}/${cleaned.length}.`);

  console.log(`  pass 2/2: reels...`);
  const reelsByOwner = await fetchReelsFor(cleaned);

  const missed = cleaned.filter((h) => !reelsByOwner.has(h.toLowerCase()));
  if (missed.length) {
    console.log(`  retrying ${missed.length} accounts that returned nothing...`);
    await sleep(PAUSE_MS);
    const retry = await fetchReelsFor(missed);
    for (const [k, v] of retry) reelsByOwner.set(k, v);
    const stillMissed = missed.filter((h) => !reelsByOwner.has(h.toLowerCase()));
    if (stillMissed.length) {
      console.log(`  no reels after retry (likely private/renamed/deleted): ${stillMissed.join(', ')}`);
    }
  }

  const result = new Map();
  for (const h of cleaned) {
    const key = h.toLowerCase();
    result.set(h, {
      followerCount: followers.get(key) || 0,
      reels: reelsByOwner.get(key) || [],
    });
  }
  return result;
}

export async function fetchAccountReels(handle) {
  const map = await fetchManyAccounts([handle]);
  return map.get(clean(handle)) || { followerCount: 0, reels: [] };
}
