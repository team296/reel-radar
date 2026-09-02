const { listTables, createTable, createField } = require('./airtable');
const { SNAPSHOTS_TABLE_NAME, FLAGGED_POSTS_TABLE_NAME } = require('./config');

// Desired schema. If the table is missing it gets created with all of these.
// If it already exists, any field not present gets added.
const SNAPSHOT_FIELDS = [
  { name: 'Snapshot ID', type: 'singleLineText' },
  { name: 'Username', type: 'singleLineText' },
  { name: 'Source', type: 'singleLineText' },
  { name: 'Date', type: 'date', options: { dateFormat: { name: 'iso' } } },
  { name: 'Followers', type: 'number', options: { precision: 0 } },
  { name: 'Follower Delta', type: 'number', options: { precision: 0 } },
  { name: 'Posts Total', type: 'number', options: { precision: 0 } },
  { name: 'Posts Delta', type: 'number', options: { precision: 0 } },
  { name: 'Total Views', type: 'number', options: { precision: 0 } },
  { name: 'Views Delta', type: 'number', options: { precision: 0 } },
  { name: 'Flagged Posts Count', type: 'number', options: { precision: 0 } },
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
    console.log(`  ok Created ${tableName}`);
    return;
  }

  const haveNames = existing.fields.map(f => f.name.toLowerCase());
  const missing = wantedFields.filter(f => !haveNames.includes(f.name.toLowerCase()));

  if (missing.length === 0) {
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
