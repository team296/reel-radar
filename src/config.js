module.exports = {
  APIFY_TOKEN: process.env.APIFY_TOKEN,
  AIRTABLE_TOKEN: process.env.AIRTABLE_TOKEN,

  // Reel Radar base
  AIRTABLE_BASE_ID: 'appCyze40Y6jR4u1H',

  // Account list lives in the posting table, in these two views
  POSTING_TABLE_NAME: 'posting',
  SOURCE_VIEWS: ['iphone farm', 'iremote'],

  SNAPSHOTS_TABLE_NAME: 'Daily Snapshots',
  FLAGGED_POSTS_TABLE_NAME: 'Flagged Posts',

  // Two actors: profile for follower counts, and the dedicated reel scraper
  // which reads the reels tab itself - works for accounts that hide reels
  // from their grid, which the general scraper missed.
  PROFILE_ACTOR: 'apify~instagram-profile-scraper',
  REELS_ACTOR: 'apify~instagram-reel-scraper',

  // How many recent reels to pull PER ACCOUNT each run. Apify bills roughly
  // $0.0024 per reel returned, so this is the main cost dial:
  // 99 accounts at 10 reels is about $2.60 a run once accounts are mature.
  // At 6 posts a day, 10 covers a full day with margin. Raising it just
  // re-buys reels already stored in Airtable, every day.
  REELS_LIMIT: 10,

  // Batching. Smaller batches + longer pauses = fewer empty results.
  BATCH_SIZE: 4,
  BATCH_PAUSE_MS: 6000,
  POLL_INTERVAL_MS: 3000,
  POLL_MAX_ATTEMPTS: 60,

  // Accounts that come back empty get one more go at the end of the run.
  RETRY_EMPTY: true,
  RETRY_PAUSE_MS: 15000,

  // A reel gets written to Flagged Posts only if it hits this many views
  // AND was posted within FLAG_WINDOW_HOURS. Both conditions must be true.
  VIEWS_FLAG_THRESHOLD: 10000,
  FLAG_WINDOW_HOURS: 24,
};
