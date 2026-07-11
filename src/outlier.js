// ─────────────────────────────────────────────────────────────
// OUTLIER ENGINE — decides which reels are worth an editor's time.
// Pure functions, no I/O, easy to reason about and tweak.
// ─────────────────────────────────────────────────────────────

import { config } from './config.js';

export function median(nums) {
  const s = nums.filter((n) => n > 0).sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function ageInDays(timestamp) {
  if (!timestamp) return Infinity;
  // Accept unix seconds, unix ms, or ISO strings.
  let ms;
  if (typeof timestamp === 'number') {
    ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  } else {
    ms = new Date(timestamp).getTime();
  }
  if (Number.isNaN(ms)) return Infinity;
  return (Date.now() - ms) / 86400000;
}

// Given one account's scraped data, return the reels that qualify as outliers,
// each annotated with the ratios that got it flagged. Also returns the median
// so the caller can store it back on the account row.
export function findOutliers({ followerCount, reels }) {
  const medianViews = median(reels.map((r) => r.views));

  const flagged = [];
  for (const reel of reels) {
    if (ageInDays(reel.timestamp) > config.recencyDays) continue;
    if (reel.views < config.minViewsFloor) continue;

    const followerRatio = followerCount > 0 ? reel.views / followerCount : 0;
    const baselineRatio = medianViews > 0 ? reel.views / medianViews : 0;

    const passesFollower = followerRatio >= config.followerRatioMin;
    const passesBaseline = baselineRatio >= config.baselineRatioMin;

    if (passesFollower || passesBaseline) {
      flagged.push({
        ...reel,
        followerRatio: Number(followerRatio.toFixed(1)),
        baselineRatio: Number(baselineRatio.toFixed(1)),
      });
    }
  }

  // Best first.
  flagged.sort(
    (a, b) => Math.max(b.followerRatio, b.baselineRatio) - Math.max(a.followerRatio, a.baselineRatio)
  );

  return { medianViews, flagged };
}
