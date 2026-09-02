const { ensureTables } = require('./setup');
const { listView, listAll, createRecords, upsert, atFetch } = require('./airtable');
const { scrapeProfiles, scrapeReels, sleep } = require('./apify');
const {
  POSTING_TABLE_NAME,
  SOURCE_VIEWS,
  SNAPSHOTS_TABLE_NAME,
  FLAGGED_POSTS_TABLE_NAME,
  BATCH_SIZE,
  BATCH_PAUSE_MS,
  RETRY_EMPTY,
  RETRY_PAUSE_MS,
  VIEWS_FLAG_THRESHOLD,
  FLAG_WINDOW_HOURS,
} = require('./config');

const todayISO = () => new Date().toISOString().split('T')[0];

// ---------------------------------------------------------------- Airtable in

// Most recent snapshot per account from before today. Using "latest previous"
// rather than "yesterday" means a skipped day doesn't break the deltas.
async function loadPreviousSnapshots() {
  const records = await listAll(SNAPSHOTS_TABLE_NAME, {
    filterByFormula: `IS_BEFORE({Date}, "${todayISO()}")`,
    fields: ['Username', 'Date', 'Followers', 'Total Views', 'Scraped At'],
  });

  const map = {};
  for (const r of records) {
    const key = String(r.fields['Username'] || '').toLowerCase().trim();
    if (!key) continue;
    const date = r.fields['Date'] || '';
    if (!map[key] || date > map[key].date) {
      map[key] = {
        date,
        followers: r.fields['Followers'] || 0,
        totalViews: r.fields['Total Views'] || 0,
        scrapedAt: r.fields['Scraped At'] || null,
      };
    }
  }
  console.log(`  ${records.length} previous rows, ${Object.keys(map).length} accounts with history`);
  return map;
}

async function loadAccounts() {
  const all = [];
  for (const viewName of SOURCE_VIEWS) {
    try {
      const records = await listView(POSTING_TABLE_NAME, viewName);
      console.log(`  ${viewName}: ${records.length} accounts`);
      for (const r of records) {
        const raw = r.fields['username'] || r.fields['Username'];
        if (raw) {
          all.push({
            username: String(raw).trim().replace('@', ''),
            source: viewName,
            recordId: r.id,
          });
        }
      }
    } catch (e) {
      console.error(`  x view "${viewName}": ${e.message}`);
    }
  }

  const seen = new Set();
  return all.filter(a => {
    const k = a.username.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Every reel URL already in Flagged Posts, so we never write one twice.
async function loadFlaggedUrls() {
  const records = await listAll(FLAGGED_POSTS_TABLE_NAME, { fields: ['Post URL'] });
  const set = new Set();
  for (const r of records) {
    if (r.fields['Post URL']) set.add(r.fields['Post URL']);
  }
  console.log(`  ${set.size} reels already flagged`);
  return set;
}

async function updateTrialReels(recordId, followers) {
  try {
    await atFetch(`${encodeURIComponent(POSTING_TABLE_NAME)}/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        fields: { 'trial reels enabled?': followers >= 200 ? 'yes' : 'no' },
        typecast: true,
      }),
    });
    return true;
  } catch (e) {
    console.error(`  x trial reels (${recordId}): ${e.message}`);
    return false;
  }
}

// ------------------------------------------------------------------ scraping

// Scrape one batch: profile for followers, reels tab for posts and views.
async function scrapeBatch(batch) {
  const usernames = batch.map(a => a.username);

  let profiles = {};
  try {
    profiles = await scrapeProfiles(usernames);
  } catch (e) {
    console.error(`  x profile scrape: ${e.message}`);
  }

  let reels = {};
  try {
    reels = await scrapeReels(usernames);
  } catch (e) {
    console.error(`  x reels scrape: ${e.message}`);
  }

  const results = [];
  for (const acct of batch) {
    const key = acct.username.toLowerCase();
    const profile = profiles[key];
    const accountReels = reels[key] || [];

    // Nothing at all came back — treat as a failure so we can retry it.
    if (!profile && !accountReels.length) {
      results.push({ acct, empty: true });
      continue;
    }

    results.push({
      acct,
      empty: false,
      followers: profile ? profile.followers : 0,
      hasProfile: Boolean(profile),
      reels: accountReels,
    });
  }
  return results;
}

// --------------------------------------------------------------------- main

async function main() {
  console.log(`\n=== IG Tracker - ${new Date().toISOString()} ===\n`);

  await ensureTables();

  console.log('\nLoading accounts...');
  const accounts = await loadAccounts();
  console.log(`  ${accounts.length} unique accounts`);
  if (!accounts.length) return;

  console.log('\nLoading history...');
  const prevMap = await loadPreviousSnapshots();
  const flaggedUrls = await loadFlaggedUrls();

  const today = todayISO();
  const scrapedAt = new Date().toISOString();

  const stats = { saved: 0, trial: 0, flagged: 0, empty: 0 };
  const snapshotRows = [];
  const flaggedRows = [];
  let emptyAccounts = [];

  // Turn one scrape result into a snapshot row (plus any flagged reels).
  function process(result) {
    const { acct, reels, followers, hasProfile } = result;
    const key = acct.username.toLowerCase();
    const prev = prevMap[key] || null;

    const totalViews = reels.reduce((s, r) => s + r.views, 0);

    // New reels = posted since the last time we scraped this account.
    // Anchoring to the previous scrape rather than a fixed 24h window means
    // it stays correct even if a run is late or missed.
    let newReels = 0;
    if (prev && prev.scrapedAt) {
      const since = new Date(prev.scrapedAt).getTime();
      newReels = reels.filter(r => r.postedAt && new Date(r.postedAt).getTime() > since).length;
    }

    // Only compute a follower delta if we actually got a profile this run,
    // otherwise 0 followers would look like a huge drop.
    const followerDelta = hasProfile && prev ? followers - prev.followers : 0;
    const viewsDelta = prev ? totalViews - prev.totalViews : 0;

    // Flag only reels that hit the view threshold AND went up inside the
    // window. Both conditions, as specified: a big number on an old reel is
    // not news.
    const windowStart = Date.now() - FLAG_WINDOW_HOURS * 60 * 60 * 1000;
    const hits = reels.filter(r =>
      r.views >= VIEWS_FLAG_THRESHOLD &&
      r.postedAt &&
      new Date(r.postedAt).getTime() >= windowStart
    );

    console.log(
      `  ${acct.username}: ${hasProfile ? followers : '?'} followers ` +
      `(${followerDelta >= 0 ? '+' : ''}${followerDelta}), ` +
      `${reels.length} reels, ${totalViews} views ` +
      `(${viewsDelta >= 0 ? '+' : ''}${viewsDelta}), ` +
      `${newReels} new${prev ? '' : ' [first run]'}`
    );

    const row = {
      'Snapshot ID': `${acct.username}_${today}`,
      'Username': acct.username,
      'Source': acct.source,
      'Date': today,
      'Reels Tracked': reels.length,
      'New Reels': newReels,
      'Total Views': totalViews,
      'Views Delta': viewsDelta,
      'Flagged Posts Count': hits.length,
      'Scraped At': scrapedAt,
    };
    // Don't write follower fields at all if the profile scrape missed —
    // better a gap than a wrong number.
    if (hasProfile) {
      row['Followers'] = followers;
      row['Follower Delta'] = followerDelta;
    }
    snapshotRows.push(row);

    for (const reel of hits) {
      if (!reel.url || flaggedUrls.has(reel.url)) continue;
      flaggedUrls.add(reel.url);
      flaggedRows.push({
        'Post ID': `${acct.username}_${reel.shortCode || reel.url.split('/').filter(Boolean).pop()}`,
        'Username': acct.username,
        'Source': acct.source,
        'Post URL': reel.url,
        'Views': reel.views,
        'Likes': reel.likes,
        'Comments': reel.comments,
        'Caption': reel.caption,
        'Posted At': reel.postedAt,
        'Detected On': today,
      });
      stats.flagged++;
    }

    stats.saved++;
    return { recordId: acct.recordId, followers, hasProfile };
  }

  // --- main pass
  const batches = [];
  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    batches.push(accounts.slice(i, i + BATCH_SIZE));
  }
  console.log(`\nScraping ${batches.length} batches of up to ${BATCH_SIZE}...\n`);

  const trialUpdates = [];

  for (let i = 0; i < batches.length; i++) {
    console.log(`Batch ${i + 1}/${batches.length}: ${batches[i].map(a => a.username).join(', ')}`);
    const results = await scrapeBatch(batches[i]);

    for (const result of results) {
      if (result.empty) {
        console.log(`  ! ${result.acct.username}: empty, will retry`);
        emptyAccounts.push(result.acct);
        continue;
      }
      trialUpdates.push(process(result));
    }

    if (i < batches.length - 1) await sleep(BATCH_PAUSE_MS);
  }

  // --- retry pass for anything that came back empty
  if (RETRY_EMPTY && emptyAccounts.length) {
    console.log(`\nRetrying ${emptyAccounts.length} empty accounts...\n`);
    await sleep(RETRY_PAUSE_MS);

    const retryBatches = [];
    for (let i = 0; i < emptyAccounts.length; i += BATCH_SIZE) {
      retryBatches.push(emptyAccounts.slice(i, i + BATCH_SIZE));
    }

    const stillEmpty = [];
    for (let i = 0; i < retryBatches.length; i++) {
      console.log(`Retry ${i + 1}/${retryBatches.length}: ${retryBatches[i].map(a => a.username).join(', ')}`);
      const results = await scrapeBatch(retryBatches[i]);
      for (const result of results) {
        if (result.empty) {
          stillEmpty.push(result.acct.username);
          continue;
        }
        trialUpdates.push(process(result));
      }
      if (i < retryBatches.length - 1) await sleep(BATCH_PAUSE_MS);
    }

    stats.empty = stillEmpty.length;
    if (stillEmpty.length) {
      console.log(`\n  Still empty after retry: ${stillEmpty.join(', ')}`);
    }
  } else {
    stats.empty = emptyAccounts.length;
  }

  // --- writes
  console.log('\nWriting to Airtable...');

  for (const row of snapshotRows) {
    try {
      await upsert(SNAPSHOTS_TABLE_NAME, 'Snapshot ID', row['Snapshot ID'], row);
    } catch (e) {
      console.error(`  x snapshot ${row['Username']}: ${e.message}`);
    }
  }
  console.log(`  ok ${snapshotRows.length} snapshots`);

  if (flaggedRows.length) {
    try {
      await createRecords(FLAGGED_POSTS_TABLE_NAME, flaggedRows);
      console.log(`  ok ${flaggedRows.length} newly flagged reels`);
    } catch (e) {
      console.error(`  x flagged posts: ${e.message}`);
    }
  }

  for (const u of trialUpdates) {
    if (u.recordId && u.hasProfile) {
      if (await updateTrialReels(u.recordId, u.followers)) stats.trial++;
    }
  }
  console.log(`  ok ${stats.trial} trial-reels fields`);

  const dayViews = snapshotRows.reduce(
    (s, r) => s + Math.max(r['Views Delta'] || 0, 0), 0
  );
  const newReels = snapshotRows.reduce((s, r) => s + (r['New Reels'] || 0), 0);

  console.log(`
=== Done ===
  Accounts saved     : ${stats.saved} / ${accounts.length}
  Failed after retry : ${stats.empty}
  New reels posted   : ${newReels}
  Views gained today : ${dayViews.toLocaleString()}
  Newly flagged      : ${stats.flagged} (>= ${VIEWS_FLAG_THRESHOLD.toLocaleString()} views within ${FLAG_WINDOW_HOURS}h)
  Finished           : ${new Date().toISOString()}
`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
