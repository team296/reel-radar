// ─────────────────────────────────────────────────────────────
// OPTIONAL — always-on scheduler.
// Use this instead of Railway's native cron if you'd rather keep
// the service running and let node-cron fire the daily job.
//
// Start command:  node src/scheduler.js
// Schedule below = 06:00 every day. Change the cron string as needed.
// ─────────────────────────────────────────────────────────────

import cron from 'node-cron';
import { run } from './index.js';

const SCHEDULE = process.env.CRON_SCHEDULE || '0 6 * * *';

console.log(`Reel Radar scheduler up. Running on: "${SCHEDULE}"`);

cron.schedule(SCHEDULE, () => {
  console.log('Cron tick — starting daily run.');
  run().catch((err) => console.error('Run failed:', err));
});

// Keep the process alive.
process.stdin.resume();
