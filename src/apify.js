const fetch = require('node-fetch');
const { APIFY_TOKEN, APIFY_ACTOR, POLL_INTERVAL_MS, POLL_MAX_ATTEMPTS, VIEWS_FLAG_THRESHOLD } = require('./config');

const BASE = 'https://api.apify.com/v2';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function scrapeProfiles(usernames) {
  console.log(`  -> Apify: scraping ${usernames.join(', ')}`);

  const runRes = await fetch(
    `${BASE}/acts/${APIFY_ACTOR}/runs?token=${APIFY_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernames,
        resultsLimit: 30,
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
    `${BASE}/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}&limit=100`
  );
  const items = await itemsRes.json();
  return items;
}

function parseProfile(raw) {
  const latestPosts = raw.latestPosts || [];

  // Total post count on the account (reliable, straight from the profile)
  const postsTotal = raw.postsCount || 0;

  // Total views across every post Apify returned for this account
  const totalViews = latestPosts.reduce(
    (sum, p) => sum + (p.videoViewCount || p.videoPlayCount || 0),
    0
  );

  // Posts that crossed the view threshold
  const flaggedPosts = latestPosts
    .filter(p => (p.videoViewCount || p.videoPlayCount || 0) >= VIEWS_FLAG_THRESHOLD)
    .map(p => ({
      url: p.url || `https://instagram.com/p/${p.shortCode}`,
      views: p.videoViewCount || p.videoPlayCount || 0,
      likes: p.likesCount || 0,
      comments: p.commentsCount || 0,
      caption: (p.caption || '').slice(0, 200),
      postedAt: p.timestamp || null,
    }));

  return {
    username: raw.username || '',
    followers: raw.followersCount || 0,
    following: raw.followsCount || 0,
    postsTotal,
    totalViews,
    postsScraped: latestPosts.length,
    flaggedPosts,
  };
}

module.exports = { scrapeProfiles, parseProfile };
