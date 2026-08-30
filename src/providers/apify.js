const fetch = require('node-fetch');
const { APIFY_TOKEN, APIFY_ACTOR, POLL_INTERVAL_MS, POLL_MAX_ATTEMPTS } = require('./config');

const BASE = 'https://api.apify.com/v2';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function scrapeProfiles(usernames) {
  console.log(`  → Apify: scraping ${usernames.join(', ')}`);

  const runRes = await fetch(
    `${BASE}/acts/${APIFY_ACTOR}/runs?token=${APIFY_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernames,
        resultsLimit: 12,
      }),
    }
  );

  if (!runRes.ok) {
    const err = await runRes.text();
    throw new Error(`Apify run start failed: ${err}`);
  }

  const runData = await runRes.json();
  const runId = runData.data.id;

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const statusRes = await fetch(`${BASE}/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    const statusData = await statusRes.json();
    const status = statusData.data.status;

    if (status === 'SUCCEEDED') break;
    if (status === 'FAILED' || status === 'ABORTED') {
      throw new Error(`Apify run ${runId} ${status}`);
    }
    console.log(`    polling... ${status} (${(i + 1) * POLL_INTERVAL_MS / 1000}s)`);
  }

  const itemsRes = await fetch(
    `${BASE}/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}&limit=50`
  );
  const items = await itemsRes.json();
  return items;
}

function parseProfile(raw) {
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;

  const latestPosts = raw.latestPosts || [];

  const recentPosts = latestPosts.filter(p => {
    const ts = p.timestamp ? new Date(p.timestamp).getTime() : 0;
    return ts > cutoff;
  });

  const flaggedPosts = latestPosts
    .filter(p => {
      const ts = p.timestamp ? new Date(p.timestamp).getTime() : 0;
      return ts > cutoff && (p.videoViewCount || 0) >= 10000;
    })
    .map(p => ({
      url: p.url || `https://instagram.com/p/${p.shortCode}`,
      views: p.videoViewCount || 0,
      likes: p.likesCount || 0,
      comments: p.commentsCount || 0,
      caption: (p.caption || '').slice(0, 200),
      postedAt: p.timestamp || null,
    }));

  return {
    username: raw.username,
    followers: raw.followersCount || 0,
    following: raw.followsCount || 0,
    postsTotal: raw.postsCount || 0,
    postsLast24h: recentPosts.length,
    flaggedPosts,
    biography: raw.biography || '',
    verified: raw.isVerified || false,
  };
}

module.exports = { scrapeProfiles, parseProfile };
