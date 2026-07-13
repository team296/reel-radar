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
