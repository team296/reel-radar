// ─────────────────────────────────────────────────────────────
// REEL RADAR — daily run (fast batched version).
// Reads Active accounts → scrapes them in a few batched Apify runs →
// flags outliers → dedupes against the queue → writes new rows.
// ─────────────────────────────────────────────────────────────

import { config, assertConfig } from './config.js';
import { fetchManyAccounts } from './providers/apify.js';
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

  log('Scraping all accounts (batched)...');
  const scraped = await fetchManyAccounts(accounts.map((a) => a.handle));

  // SAFETY: if the whole scrape came back empty (e.g. no credit, IG blocked),
  // stop here and DO NOT touch any account rows. Better to skip a day than
  // to overwrite good follower/median numbers with zeros.
  const gotAnything = [...scraped.values()].some((d) => d.reels.length > 0);
  if (!gotAnything) {
    log('Scrape returned nothing for every account — leaving all data untouched and stopping.');
    log('Check Apify credit / actor status, then run again.');
    return;
  }

  const newRows = [];
  let scanned = 0;
  let flaggedTotal = 0;

  for (const account of accounts) {
    const data = scraped.get(account.handle.replace(/^@/, '').trim()) || {
      followerCount: 0,
      reels: [],
    };

    // Per-account guard: only update stats when we actually got reels back.
    // An empty result for one account leaves its existing numbers alone.
    if (data.reels.length > 0) {
      const { medianViews, flagged } = findOutliers(data);
      scanned += data.reels.length;
      flaggedTotal += flagged.length;

      try {
        await updateAccountStats(account.id, data.followerCount, medianViews);
      } catch (err) {
        log(`@${account.handle}: could not update stats — ${err.message}`);
      }

      const fresh = flagged.filter((r) => !seen.has(r.shortcode));
      for (const r of fresh) {
        seen.add(r.shortcode);
        newRows.push({
          ...r,
          handle: account.handle,
          model: account.model,
          postedDate: toPostedDate(r.timestamp),
        });
      }
    }
  }

  let written = 0;
  if (newRows.length) written = await writeReelRows(newRows);

  log('──────────────────────────────');
  log(`Done. Scanned ${scanned} reels across ${accounts.length} accounts.`);
  log(`${flaggedTotal} outliers found, ${written} new written to the queue.`);
}

import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
