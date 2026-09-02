const fetch = require('node-fetch');
const {
  APIFY_TOKEN,
  PROFILE_ACTOR,
  REELS_ACTOR,
  REELS_LIMIT,
  POLL_INTERVAL_MS,
  POLL_MAX_ATTEMPTS,
} = require('./config');

const BASE = 'https://api.apify.com/v2';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Start an actor, wait for it to finish, return its dataset items.
async function runActor(actor, input, label) {
  const runRes = await fetch(`${BASE}/acts/${actor}/runs?token=${APIFY_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!runRes.ok) {
    throw new Error(`${label}: could not start run (${runRes.status})`);
  }

  const runId = (await runRes.json()).data.id;

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const st = await fetch(`${BASE}/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    const status = (await st.json()).data.status;
    if (status === 'SUCCEEDED') break;
    if (status === 'FAILED' || status === 'ABORTED') {
      throw new Error(`${label}: run ${status}`);
    }
  }

  const itemsRes = await fetch(
    `${BASE}/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}&limit=1000`
  );
  const items = await itemsRes.json();
  return Array.isArray(items) ? items : [];
}

// Follower counts only. The grid post count from here is deliberately ignored:
// accounts that hide reels from the grid report 1, which is what broke the
// old numbers.
async function scrapeProfiles(usernames) {
  const items = await runActor(
    PROFILE_ACTOR,
    { usernames, resultsLimit: 1 },
    'profile'
  );

  const byUser = {};
  for (const raw of items) {
    const name = (raw.username || '').toLowerCase();
    if (!name) continue;
    byUser[name] = {
      followers: raw.followersCount || 0,
      following: raw.followsCount || 0,
      gridPosts: raw.postsCount || 0,
    };
  }
  return byUser;
}

// The reels tab itself — /username/reels/ — which is where the real posts and
// view counts live.
async function scrapeReels(usernames) {
  const items = await runActor(
    REELS_ACTOR,
    {
      directUrls: usernames.map(u => `https://www.instagram.com/${u}/reels/`),
      resultsType: 'posts',
      resultsLimit: REELS_LIMIT,
      addParentData: false,
    },
    'reels'
  );

  const byUser = {};
  for (const raw of items) {
    const name = (raw.ownerUsername || '').toLowerCase();
    if (!name) continue;
    if (!byUser[name]) byUser[name] = [];

    // Instagram returns views under either key depending on the post.
    const views = raw.videoPlayCount || raw.videoViewCount || 0;

    byUser[name].push({
      url: raw.url || (raw.shortCode ? `https://instagram.com/reel/${raw.shortCode}` : ''),
      shortCode: raw.shortCode || '',
      views,
      likes: raw.likesCount || 0,
      comments: raw.commentsCount || 0,
      caption: (raw.caption || '').slice(0, 200),
      postedAt: raw.timestamp || null,
    });
  }

  // Newest first
  for (const name of Object.keys(byUser)) {
    byUser[name].sort((a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0));
  }

  return byUser;
}

module.exports = { scrapeProfiles, scrapeReels, sleep };
