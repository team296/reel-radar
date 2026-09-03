const { listTables, createTable, createField } = require('./airtable');
const { SNAPSHOTS_TABLE_NAME, FLAGGED_POSTS_TABLE_NAME } = require('./config');

const SNAPSHOT_FIELDS = [
  { name: 'Snapshot ID', type: 'singleLineText' },
  { name: 'Username', type: 'singleLineText' },
  { name: 'Source', type: 'singleLineText' },
  { name: 'Date', type: 'date', options: { dateFormat: { name: 'iso' } } },
  { name: 'Followers', type: 'number', options: { precision: 0 } },
  { name: 'Follower Delta', type: 'number', options: { precision: 0 } },
  // Reel-based figures. These replace the old grid-based Posts columns.
  { name: 'Reels Tracked', type: 'number', options: { precision: 0 } },
  { name: 'New Reels', type: 'number', options: { precision: 0 } },
  { name: 'Total Views', type: 'number', options: { precision: 0 } },
  { name: 'Views Delta', type: 'number', options: { precision: 0 } },
  { name: 'Flagged Posts Count', type: 'number', options: { precision: 0 } },
  // Machine-readable {shortCode: views} for the reels seen this run. Used by
  // the next run to compute a true per-reel views delta. Hide it in Airtable.
  { name: 'Reel Views JSON', type: 'multilineText' },
  {
    name: 'Scraped At',
    type: 'dateTime',
    options: {
      dateFormat: { name: 'iso' },
      timeFormat: { name: '24hour' },
      timeZone: 'Europe/London',
    },
  },
];

const FLAGGED_FIELDS = [
  { name: 'Post ID', type: 'singleLineText' },
  { name: 'Username', type: 'singleLineText' },
  { name: 'Source', type: 'singleLineText' },
  { name: 'Post URL', type: 'url' },
  { name: 'Views', type: 'number', options: { precision: 0 } },
  { name: 'Likes', type: 'number', options: { precision: 0 } },
  { name: 'Comments', type: 'number', options: { precision: 0 } },
  { name: 'Caption', type: 'multilineText' },
  {
    name: 'Posted At',
    type: 'dateTime',
    options: {
      dateFormat: { name: 'iso' },
      timeFormat: { name: '24hour' },
      timeZone: 'Europe/London',
    },
  },
  { name: 'Detected On', type: 'date', options: { dateFormat: { name: 'iso' } } },
];

async function ensureTable(tableName, wantedFields, existingTables) {
  const existing = existingTables.find(t => t.name === tableName);

  if (!existing) {
    console.log(`  Creating table: ${tableName}`);
    await createTable(tableName, wantedFields);
    return;
  }

  const have = existing.fields.map(f => f.name.toLowerCase());
  const missing = wantedFields.filter(f => !have.includes(f.name.toLowerCase()));

  if (!missing.length) {
    console.log(`  ok ${tableName} up to date`);
    return;
  }

  for (const field of missing) {
    try {
      await createField(existing.id, field);
      console.log(`  + Added column "${field.name}" to ${tableName}`);
    } catch (e) {
      console.error(`  x Could not add "${field.name}": ${e.message}`);
    }
  }
}

async function ensureTables() {
  console.log('Checking Airtable tables...');
  const tables = await listTables();
  await ensureTable(SNAPSHOTS_TABLE_NAME, SNAPSHOT_FIELDS, tables);
  await ensureTable(FLAGGED_POSTS_TABLE_NAME, FLAGGED_FIELDS, tables);
}

module.exports = { ensureTables };
