// ─────────────────────────────────────────────────────────────
// REEL RADAR — daily run.
// Reads Active accounts → scrapes each → flags outliers →
// dedupes against the queue → writes new rows for editors.
//
// Run once with:  node src/index.js
// (Railway cron triggers this daily; see README.)
// ─────────────────────────────────────────────────────────────

import { config, assertConfig } from './config.js';
import { fetchAccountReels } from './providers/apify.js';
import { findOutliers } from './outlier.js';
import {
  getActiveAccounts,
  getExistingShortcodes,
  updateAccountStats,
  writeReelRows,
} from './airtable.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);

function toPostedDate(timestamp) {
  if (!timestamp) return undefined;
  let ms;
  if (typeof timestamp === 'number') ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  else ms = new Date(timestamp).getTime();
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms).toISOString().slice(0, 10);
}

export async function run() {
  assertConfig();
  log('Reel Radar starting.');
  log(
    `Rules: within ${config.recencyDays}d, ≥${config.minViewsFloor.toLocaleString()} views, ` +
    `≥${config.followerRatioMin}x followers OR ≥${config.baselineRatioMin}x own median.`
  );

  const accounts = await getActiveAccounts();
  log(`Loaded ${accounts.length} active accounts.`);
  if (!accounts.length) {
    log('Nothing to scrape. Add accounts to "Inspiration Accounts" and tick Active.');
    return;
  }

  const seen = await getExistingShortcodes();
  log(`${seen.size} reels already in the queue (will be skipped).`);

  const newRows = [];
  let scanned = 0;
  let errors = 0;

  for (const account of accounts) {
    try {
      const data = await fetchAccountReels(account.handle);
      const { medianViews, flagged } = findOutliers(data);
      scanned += data.reels.length;

      await updateAccountStats(account.id, data.followerCount, medianViews);

      const fresh = flagged.filter((r) => !seen.has(r.shortcode));
      for (const r of fresh) {
        seen.add(r.shortcode); // guard against dupes within this run too
        newRows.push({
          ...r,
          handle: account.handle,
          model: account.model,
          postedDate: toPostedDate(r.timestamp),
        });
      }

      log(
        `@${account.handle}: ${data.reels.length} reels, ` +
        `${data.followerCount.toLocaleString()} followers, ` +
        `${flagged.length} outliers (${fresh.length} new).`
      );
    } catch (err) {
      errors += 1;
      log(`@${account.handle}: ERROR — ${err.message}`);
    }
  }

  let written = 0;
  if (newRows.length) written = await writeReelRows(newRows);

  log('──────────────────────────────');
  log(`Done. Scanned ${scanned} reels across ${accounts.length} accounts.`);
  log(`${written} new outliers written to the queue. ${errors} account errors.`);
}

// Run only when this file is executed directly (not when imported by the scheduler).
import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
