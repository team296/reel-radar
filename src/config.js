module.exports = {
  APIFY_TOKEN: process.env.APIFY_TOKEN,
  AIRTABLE_TOKEN: process.env.AIRTABLE_TOKEN,

  // Reel Radar base — same one you already use
  AIRTABLE_BASE_ID: 'appCyze40Y6jR4u1H',

  // The posting table inside Reel Radar base
  POSTING_TABLE_NAME: 'posting',
  SOURCE_VIEWS: ['iphone farm', 'iremote'],

  // These tables are created automatically on first run
  SNAPSHOTS_TABLE_NAME: 'Daily Snapshots',
  FLAGGED_POSTS_TABLE_NAME: 'Flagged Posts',

  // Scraping settings
  APIFY_ACTOR: 'apify~instagram-profile-scraper',
  BATCH_SIZE: 5,
  BATCH_PAUSE_MS: 4000,
  POLL_INTERVAL_MS: 3000,
  POLL_MAX_ATTEMPTS: 40,

  // Flagging threshold
  VIEWS_FLAG_THRESHOLD: 10000,
};
