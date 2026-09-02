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

// Find the most recent snapshot for each account BEFORE today.
// Using "most recent previous" instead of strictly yesterday means the
// deltas still work if a day gets skipped (missed cron, failed run).
async function loadPreviousSnapshots() {
  const today = todayISO();
  const records = await listAll(SNAPSHOTS_TABLE_NAME, {
    filterByFormula: `IS_BEFORE({Date}, "${today}")`,
    fields: ['Username', 'Date', 'Followers', 'Posts Total', 'Total Views'],
  });

  const map = {};
  for (const r of records) {
    const rawName = r.fields['Username'];
    if (!rawName) continue;
    const key = String(rawName).toLowerCase().trim();
    const date = r.fields['Date'] || '';
    // Keep only the latest-dated row per username
    if (!map[key] || date > map[key].date) {
      map[key] = {
        date,
        followers: r.fields['Followers'] || 0,
        postsTotal: r.fields['Posts Total'] || 0,
        totalViews: r.fields['Total Views'] || 0,
      };
    }
  }

  console.log(`  Loaded ${records.length} previous rows, ${Object.keys(map).length} accounts with history`);
  return map;
}

function dedupeAccounts(allAccounts) {
  const seen = new Set();
  const result = [];
  for (const acct of allAccounts) {
    const key = acct.username.toLowerCase();
    if (!acct.username || seen.has(key)) continue;
    seen.add(key);
    result.push(acct);
  }
  return result;
}

async function alreadyFlagged(postUrl) {
  const records = await listAll(FLAGGED_POSTS_TABLE_NAME, {
    filterByFormula: `{Post URL} = "${postUrl}"`,
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
    return true;
  } catch (e) {
    console.error(`  x trial reels update failed (${recordId}): ${e.message}`);
    return false;
  }
}

async function main() {
  console.log(`\n=== IG Tracker - ${new Date().toISOString()} ===\n`);

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
            username: String(username).trim().replace('@', ''),
            source: viewName,
            recordId: r.id,
          });
        }
      }
    } catch (e) {
      console.error(`  x Failed to load view "${viewName}": ${e.message}`);
    }
  }

  const accounts = dedupeAccounts(allAccounts);
  console.log(`\nTotal unique accounts to scrape: ${accounts.length}`);
  if (accounts.length === 0) {
    console.log('No accounts found. Exiting.');
    return;
  }

  console.log('\nLoading previous snapshots for deltas...');
  const prevMap = await loadPreviousSnapshots();

  const today = todayISO();
  let totalSnapshots = 0;
  let totalFlagged = 0;
  let totalTrialUpdates = 0;
  let totalErrors = 0;
  let dayViews = 0;

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
      profiles = raw.map(parseProfile).filter(p => p.username);
      console.log(`  ok Got ${profiles.length}/${usernames.length} profiles`);
    } catch (e) {
      console.error(`  x Batch failed: ${e.message}`);
      totalErrors += batch.length;
      if (bIdx < batches.length - 1) await sleep(BATCH_PAUSE_MS);
      continue;
    }

    const snapshotRows = [];
    const flaggedRows = [];

    for (const profile of profiles) {
      const key = profile.username.toLowerCase();
      const acct = batch.find(a => a.username.toLowerCase() === key);
      const source = acct ? acct.source : 'unknown';
      const recordId = acct ? acct.recordId : null;

      // Guard: if the scrape came back empty, skip rather than
      // overwriting good data with zeros.
      if (profile.followers === 0 && profile.postsTotal === 0) {
        console.log(`  ! ${profile.username}: empty scrape, skipping`);
        totalErrors++;
        continue;
      }

      const prev = prevMap[key] || null;
      const followerDelta = prev ? profile.followers - prev.followers : 0;
      const postsDelta = prev ? profile.postsTotal - prev.postsTotal : 0;
      const viewsDelta = prev ? profile.totalViews - prev.totalViews : 0;

      dayViews += viewsDelta > 0 ? viewsDelta : 0;

      console.log(
        `  ${profile.username}: ${profile.followers} followers (${followerDelta >= 0 ? '+' : ''}${followerDelta}), ` +
        `posts ${profile.postsTotal} (${postsDelta >= 0 ? '+' : ''}${postsDelta}), ` +
        `views ${profile.totalViews} (${viewsDelta >= 0 ? '+' : ''}${viewsDelta})` +
        `${prev ? '' : ' [no history yet]'}`
      );

      snapshotRows.push({
        'Snapshot ID': `${profile.username}_${today}`,
        'Username': profile.username,
        'Source': source,
        'Date': today,
        'Followers': profile.followers,
        'Follower Delta': followerDelta,
        'Posts Total': profile.postsTotal,
        'Posts Delta': postsDelta,
        'Total Views': profile.totalViews,
        'Views Delta': viewsDelta,
        'Flagged Posts Count': profile.flaggedPosts.length,
      });

      if (recordId) {
        const ok = await updateTrialReels(recordId, profile.followers);
        if (ok) totalTrialUpdates++;
      }

      for (const post of profile.flaggedPosts) {
        if (await alreadyFlagged(post.url)) continue;
        flaggedRows.push({
          'Post ID': `${profile.username}_${post.url.split('/').filter(Boolean).pop()}`,
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

      totalFlagged += profile.flaggedPosts.length;
      totalSnapshots++;
    }

    if (snapshotRows.length > 0) {
      try {
        for (const row of snapshotRows) {
          await upsert(SNAPSHOTS_TABLE_NAME, 'Snapshot ID', row['Snapshot ID'], row);
        }
        console.log(`  ok Saved ${snapshotRows.length} snapshots`);
      } catch (e) {
        console.error(`  x Snapshot write error: ${e.message}`);
      }
    }

    if (flaggedRows.length > 0) {
      try {
        await createRecords(FLAGGED_POSTS_TABLE_NAME, flaggedRows);
        console.log(`  !! Flagged ${flaggedRows.length} new posts (10k+ views)`);
      } catch (e) {
        console.error(`  x Flagged posts write error: ${e.message}`);
      }
    }

    if (bIdx < batches.length - 1) {
      console.log(`  Pausing ${BATCH_PAUSE_MS / 1000}s before next batch...`);
      await sleep(BATCH_PAUSE_MS);
    }
  }

  console.log(`
=== Done ===
  Snapshots written   : ${totalSnapshots}
  Trial reels updated : ${totalTrialUpdates}
  New posts flagged   : ${totalFlagged}
  Views gained today  : ${dayViews.toLocaleString()}
  Errors / skipped    : ${totalErrors}
  Finished            : ${new Date().toISOString()}
`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
