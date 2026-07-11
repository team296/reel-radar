// ─────────────────────────────────────────────────────────────
// PROVIDER LAYER — Apify Instagram scraper.
//
// This is the ONLY file that knows about Apify. Everything upstream
// (outlier engine, Airtable writer) speaks the normalized shape below.
// To switch to a different scraper (RapidAPI, HikerAPI, whatever),
// you replace only this file — keep the same export + return shape.
//
// NORMALIZED RETURN SHAPE (the contract):
//   {
//     followerCount: number,          // account's current followers (0 if unknown)
//     reels: [
//       {
//         shortcode: string,
//         url: string,
//         thumbnailUrl: string,
//         views: number,
//         caption: string,
//         timestamp: string|Date,     // when the reel was posted
//       },
//       ...
//     ]
//   }
// ─────────────────────────────────────────────────────────────

import { config } from './config.js';

const APIFY_BASE = 'https://api.apify.com/v2';

// Runs the actor and returns dataset items directly (run-sync-get-dataset-items).
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

// ── Defensive field readers ────────────────────────────────────
// Different actors label the same thing differently. Rather than break
// when an actor tweaks a field name, we try the common aliases.
// On the FIRST real run, check the logs against a known reel to confirm
// views are being read correctly, and trim these lists if you like.
const firstDefined = (obj, keys) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
};

const readViews = (post) =>
  Number(
    firstDefined(post, [
      'videoPlayCount',
      'videoViewCount',
      'playCount',
      'viewsCount',
      'views',
    ]) || 0
  );

const readFollowers = (obj) =>
  Number(firstDefined(obj, ['followersCount', 'followers', 'followerCount']) || 0);

const readShortcode = (post) =>
  firstDefined(post, ['shortCode', 'shortcode', 'code']) || '';

const readThumb = (post) =>
  firstDefined(post, ['displayUrl', 'thumbnailUrl', 'imageUrl', 'thumbnail']) || '';

const readCaption = (post) => {
  const c = firstDefined(post, ['caption', 'text', 'title']);
  if (typeof c === 'string') return c;
  if (c && typeof c.text === 'string') return c.text;
  return '';
};

const readTimestamp = (post) =>
  firstDefined(post, ['timestamp', 'takenAt', 'takenAtTimestamp', 'time']) || null;

// ── Main export ────────────────────────────────────────────────
export async function fetchAccountReels(handle) {
  // apify/instagram-scraper: "details" on a profile URL returns the profile
  // object (with followersCount) plus latestPosts. We ask for posts on the
  // /reels/ URL to get reel play counts reliably, and read followers from
  // the owner data when present, falling back to a details pass if not.
  const cleanHandle = handle.replace(/^@/, '').trim();

  const input = {
    directUrls: [`https://www.instagram.com/${cleanHandle}/reels/`],
    resultsType: 'posts',
    resultsLimit: config.reelsPerAccount,
    addParentData: true, // asks the actor to attach owner/profile data to posts
  };

  const items = await runActor(input);

  if (!Array.isArray(items) || items.length === 0) {
    return { followerCount: 0, reels: [] };
  }

  // Follower count may ride along on the post's owner data.
  let followerCount = 0;
  for (const it of items) {
    const owner = it.owner || it.user || it;
    const f = readFollowers(owner) || readFollowers(it);
    if (f) {
      followerCount = f;
      break;
    }
  }

  const reels = items
    .filter((it) => readShortcode(it))
    .map((it) => ({
      shortcode: readShortcode(it),
      url:
        firstDefined(it, ['url']) ||
        `https://www.instagram.com/reel/${readShortcode(it)}/`,
      thumbnailUrl: readThumb(it),
      views: readViews(it),
      caption: readCaption(it),
      timestamp: readTimestamp(it),
    }));

  return { followerCount, reels };
}
