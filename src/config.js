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
    // Tables are referenced by name — safe because names are stable.
    accountsTable: 'Inspiration Accounts',
    queueTable: 'Reel Queue',
  },

  // How many recent reels to pull per account per run.
  reelsPerAccount: num(process.env.REELS_PER_ACCOUNT, 20),

  // ── The outlier rules ──
  // A reel is flagged only if it clears the FLOOR *and* satisfies at least
  // one of the two ratio tests. Two ratios on purpose:
  //   • followerRatio catches small/mid accounts whose reel massively
  //     outperforms their audience size.
  //   • baselineRatio catches big accounts where 10x-followers is impossible,
  //     but a reel doing 8x *their own* median is a real breakout format.
  recencyDays: num(process.env.RECENCY_DAYS, 28),
  minViewsFloor: num(process.env.MIN_VIEWS_FLOOR, 25000),
  followerRatioMin: num(process.env.FOLLOWER_RATIO_MIN, 6),
  baselineRatioMin: num(process.env.BASELINE_RATIO_MIN, 5),
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
