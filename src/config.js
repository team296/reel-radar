// ─────────────────────────────────────────────────────────────
// Central config. Everything tunable lives here or in .env.
// ─────────────────────────────────────────────────────────────

const num = (v, fallback) => (v === undefined || v === '' ? fallback : Number(v));

export const config = {
  apify: {
    token: process.env.APIFY_TOKEN,
    actorId: process.env.APIFY_ACTOR_ID || 'apify~instagram-scraper',
  },
  airtable: {
    token: process.env.AIRTABLE_TOKEN,
    baseId: process.env.AIRTABLE_BASE_ID || 'appCyze40Y6jR4u1H',
    accountsTable: 'Inspiration Accounts',
    queueTable: 'Reel Queue',
  },

  reelsPerAccount: num(process.env.REELS_PER_ACCOUNT, 20),

  // ── The outlier rules ── (10x on both tests)
  recencyDays: num(process.env.RECENCY_DAYS, 28),
  minViewsFloor: num(process.env.MIN_VIEWS_FLOOR, 25000),
  followerRatioMin: num(process.env.FOLLOWER_RATIO_MIN, 10),
  baselineRatioMin: num(process.env.BASELINE_RATIO_MIN, 10),
};

export function assertConfig() {
  const missing = [];
  if (!config.apify.token) missing.push('APIFY_TOKEN');
  if (!config.airtable.token) missing.push('AIRTABLE_TOKEN');
  if (!config.airtable.baseId) missing.push('AIRTABLE_BASE_ID');
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}
