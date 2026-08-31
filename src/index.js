const { ensureTables } = require('./setup');
const { listView, listAll, createRecords, upsert, atFetch } = require('./airtable');
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
  for (const { username, source, recordId } of allAccounts) {
    if (!username || seen.has(username)) continue;
    seen.add(username);
    result.push({ username, source, recordId });
  }
  return result;
}

async function alreadyFlagged(postUrl) {
  const filter = `AND({Post URL} = "${postUrl}", {Detected On} = "${todayISO()}")`;
  const records = await listAll(FLAGGED_POSTS_TABLE_NAME, {
    filterByFormula: filter,
    maxRecords: 1,
    fields: ['Post ID'],
  });
  return records.length > 0;
}

async function updateTrialReels(recordId, followers) {
  const value = followers >= 200 ? 'yes' : 'no';
  try {
    await atFetch(`${encodeURIComponent(POSTING_TABLE_NAME)}/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { 'trial reels enabled?': value }, typecast: true }),
    });
  } catch (e) {
    console.error(`  ✗ Failed to update trial reels for ${recordId}: ${e.message}`);
  }
}

async function main() {
  console.log(`\n=== IG Tracker — ${new Date().toISOString()} ===\n`);

  await ensureTables();

  console.log('\nLoading accounts from Airtable...');
  const allAccounts = [];
  for (const viewName of SOURCE_VIEWS) {
    try {
      const records = await listView(POSTING_TABLE_NAME, viewName);
      console.log(`  ${viewName}: ${records.length} accounts`);
      for (const r of records) {
        const username = r.fields['username'] || r.fields['Username'];
        if (username) {
          allAccounts.push({
            username: username.trim().replace('@', ''),
            source: viewName,
            recordId: r.id,
          });
        }
      }
    } catch (e) {
      console.error(`  ✗ Failed to load view "${viewName}": ${e.message}`);
    }
  }

  const accounts = dedupeAccounts(allAccounts);
  console.log(`\nTotal unique accounts to scrape: ${accounts.length}`);

  if (accounts.length === 0) {
    console.log('No accounts found. Exiting.');
    return;
  }

  console.log('\nLoading yesterday snapshots...');
  const yesterdayMap = await loadYesterdaySnapshots();

  const today = todayISO();
  let totalSnapshots = 0;
  let totalFlagged = 0;
  let totalTrialUpdates = 0;
  let totalErrors = 0;

  const batches = [];
  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    batches.push(accounts.slice(i, i + BATCH_SIZE));
  }

  console.log(`\nScraping ${batches.length} batches of up to ${BATCH_SIZE}...\n`);

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const batch = batches[bIdx];
    const usernames = batch.map(a => a.username);
    console.log(`Batch ${bIdx + 1}/${batches.length}: ${usernames.join(', ')}`);

    let profiles = [];
    try {
      const raw = await scrapeProfiles(usernames);
      profiles = raw.map(parseProfile).filter(Boolean);
      console.log(`  ✓ Got ${profiles.length}/${usernames.length} profiles`);
    } catch (e) {
      console.error(`  ✗ Batch failed: ${e.message}`);
      totalErrors += batch.length;
      if (bIdx < batches.length - 1) await sleep(BATCH_PAUSE_MS);
      continue;
    }

    const snapshotRows = [];
    const flaggedRows = [];

    for (const profile of profiles) {
      const acct = batch.find(a => a.username === profile.username);
      const source = acct ? acct.source : 'unknown';
      const recordId = acct ? acct.recordId : null;
      const prevFollowers = yesterdayMap[profile.username] || 0;
      const delta = prevFollowers > 0 ? profile.followers - prevFollowers : 0;

      snapshotRows.push({
        'Snapshot ID': `${profile.username}_${today}`,
        'Username': profile.username,
        'Source': source,
        'Date': today,
        'Followers': profile.followers,
        'Follower Delta': delta,
        'Posts Last 24h': profile.postsLast24h,
        'Flagged Posts Count': profile.flaggedPosts.length,
      });

      // Update trial reels enabled field
      if (recordId) {
        await updateTrialReels(recordId, profile.followers);
        totalTrialUpdates++;
      }

      for (const post of profile.flaggedPosts) {
        const alreadyDone = await alreadyFlagged(post.url);
        if (!alreadyDone) {
          flaggedRows.push({
            'Post ID': `${profile.username}_${post.url.split('/').pop()}_${today}`,
            'Username': profile.username,
            'Source': source,
            'Post URL': post.url,
            'Views': post.views,
            'Likes': post.likes,
            'Comments': post.comments,
            'Caption': post.caption,
            'Posted At': post.postedAt,
            'Detected On': today,
          });
        }
      }

      totalFlagged += profile.flaggedPosts.length;
      totalSnapshots++;
    }

    if (snapshotRows.length > 0) {
      try {
        for (const row of snapshotRows) {
          await upsert(SNAPSHOTS_TABLE_NAME, 'Snapshot ID', row['Snapshot ID'], row);
        }
        console.log(`  ✓ Saved ${snapshotRows.length} snapshots`);
      } catch (e) {
        console.error(`  ✗ Snapshot write error: ${e.message}`);
      }
    }

    if (flaggedRows.length > 0) {
      try {
        await createRecords(FLAGGED_POSTS_TABLE_NAME, flaggedRows);
        console.log(`  🚨 Flagged ${flaggedRows.length} posts (10k+ views)`);
      } catch (e) {
        console.error(`  ✗ Flagged posts write error: ${e.message}`);
      }
    }

    if (bIdx < batches.length - 1) {
      console.log(`  Pausing ${BATCH_PAUSE_MS / 1000}s before next batch...`);
      await sleep(BATCH_PAUSE_MS);
    }
  }

  console.log(`
=== Done ===
  Snapshots written  : ${totalSnapshots}
  Trial reels updated: ${totalTrialUpdates}
  Posts flagged      : ${totalFlagged}
  Errors             : ${totalErrors}
  Run time           : ${new Date().toISOString()}
`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
