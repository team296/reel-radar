const { listTables, createTable } = require('./airtable');
const { SNAPSHOTS_TABLE_NAME, FLAGGED_POSTS_TABLE_NAME } = require('./config');

async function ensureTables() {
  console.log('Checking Airtable tables...');
  const tables = await listTables();
  const names = tables.map(t => t.name);

  if (!names.includes(SNAPSHOTS_TABLE_NAME)) {
    console.log(`Creating table: ${SNAPSHOTS_TABLE_NAME}`);
    await createTable(SNAPSHOTS_TABLE_NAME, [
      { name: 'Snapshot ID', type: 'singleLineText' },
      { name: 'Username', type: 'singleLineText' },
      { name: 'Source', type: 'singleLineText' },
      { name: 'Date', type: 'date', options: { dateFormat: { name: 'iso' } } },
      { name: 'Followers', type: 'number', options: { precision: 0 } },
      { name: 'Follower Delta', type: 'number', options: { precision: 0 } },
      { name: 'Posts Last 24h', type: 'number', options: { precision: 0 } },
      { name: 'Flagged Posts Count', type: 'number', options: { precision: 0 } },
    ]);
    console.log(`  ✓ Created ${SNAPSHOTS_TABLE_NAME}`);
  } else {
    console.log(`  ✓ ${SNAPSHOTS_TABLE_NAME} exists`);
  }

  if (!names.includes(FLAGGED_POSTS_TABLE_NAME)) {
    console.log(`Creating table: ${FLAGGED_POSTS_TABLE_NAME}`);
    await createTable(FLAGGED_POSTS_TABLE_NAME, [
      { name: 'Post ID', type: 'singleLineText' },
      { name: 'Username', type: 'singleLineText' },
      { name: 'Source', type: 'singleLineText' },
      { name: 'Post URL', type: 'url' },
      { name: 'Views', type: 'number', options: { precision: 0 } },
      { name: 'Likes', type: 'number', options: { precision: 0 } },
      { name: 'Comments', type: 'number', options: { precision: 0 } },
      { name: 'Caption', type: 'multilineText' },
      { name: 'Posted At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'Europe/London' } },
      { name: 'Detected On', type: 'date', options: { dateFormat: { name: 'iso' } } },
    ]);
    console.log(`  ✓ Created ${FLAGGED_POSTS_TABLE_NAME}`);
  } else {
    console.log(`  ✓ ${FLAGGED_POSTS_TABLE_NAME} exists`);
  }
}

module.exports = { ensureTables };
