const { ensureTables } = require('./setup');
const { listView, listAll, createRecords, upsert } = require('./airtable');
const { scrapeProfiles, parseProfile } = require('./apify');
const {
  POSTING_TABLE_NAME,
  SOURCE_VIEWS,
  SNAPSHOTS_TABLE_NAME,
  FLAGGED_POSTS_TABLE_NAME,
  BATCH_SIZE,
  BATCH_PAUSE_MS,
} = require('./config');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

async function loadYesterdaySnapshots() {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const filter = `{Date} = "${yesterday}"`;
  const records = await listAll(SNAPSHOTS_TABLE_NAME, {
    filterByFormula: filter,
    fields: ['Username', 'Followers'],
  });
  const map = {};
  for (const r of records) {
    map[r.fields['Username']] = r.fields['Followers'] || 0;
  }
  console.log(`Loaded ${records.length} yesterday snapshots for delta calculation`);
  return map;
}

function dedupeAccounts(allAccounts) {
  const seen = new Set();
  const result = [];
  for (const { username, source } of allAccounts) {
    if (!username || seen.has(username)) continue;
    seen.add(username);
