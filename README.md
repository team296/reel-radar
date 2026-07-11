# Reel Radar

Finds Instagram reels that are punching above their weight, and drops them
into an Airtable queue for your editors to copy. Runs itself once a day.

**How it decides a reel is worth copying** — a reel is flagged only if it:
1. was posted in the last **21 days** (no stale virals), **and**
2. has at least **50,000 views** (kills small-account noise), **and**
3. did at least **10x the account's follower count** in views **OR** at least
   **8x that account's own median reel** (catches breakout formats even on
   big accounts where 10x-followers is impossible).

All four numbers are tunable — see *Tuning* below.

---

## What you touch vs what it does

**You, once:**
- Make a free Apify account, grab an API token.
- Make an Airtable personal access token.
- Deploy to Railway, paste both tokens in.
- Fill the **Inspiration Accounts** table with the handles you copy.

**It, every morning:**
- Scrapes each active account's recent reels + follower count.
- Flags the outliers, skips anything already in the queue.
- Writes fresh rows to **Reel Queue** for editors.

Nobody logs into Apify day-to-day.

---

## The Airtable base

Base **Reel Radar** (`appCyze40Y6jR4u1H`) — already created, two tables:

**Inspiration Accounts** — you fill this:
- `Handle` — IG username, no @ (e.g. `someaccount`)
- `Model` — which model's editor it feeds (Olivia / Luna / Mica / Darcy)
- `Active` — tick to scrape, untick to pause
- `Follower Count`, `Median Views`, `Last Scraped` — auto-filled each run

**Reel Queue** — editors work this:
- Thumbnail, Reel URL, Views, Follower Ratio, Baseline Ratio, Posted Date,
  Caption, Source Handle, Model
- `Status` — New → Assigned → In Progress → Posted (or Skipped)

Tip: make a filtered view per model, or a Kanban grouped by Status, so each
editor sees only their New reels.

---

## Setup

### 1. Apify token
- Sign up free at apify.com (no card needed).
- **Settings → Integrations → API token** → copy it.
- That's your `APIFY_TOKEN`.

### 2. Airtable token
- Airtable → **Builder Hub → Personal access tokens → Create token**.
- Scopes: `data.records:read`, `data.records:write`, `schema.bases:read`.
- Access: add the **Reel Radar** base.
- Copy it → that's your `AIRTABLE_TOKEN`.

### 3. Deploy on Railway
- New project → Deploy from this repo (or `railway up` from the folder).
- **Variables** tab → add everything from `.env.example` (at minimum
  `APIFY_TOKEN` and `AIRTABLE_TOKEN`; the base ID is already defaulted).
- Schedule the daily run — two options:
  - **Railway native cron (recommended):** set the service's *Cron Schedule*
    to `0 6 * * *` and *Start Command* to `npm start`. Railway spins the
    container up daily, it runs once, and exits.
  - **Always-on:** set *Start Command* to `npm run cron`. The process stays
    up and node-cron fires at 06:00 (change `CRON_SCHEDULE` to adjust).

### 4. Run it once by hand to confirm
From the Railway shell (or locally with a `.env`): `npm start`.
Watch the logs — you'll see per-account lines like
`@handle: 20 reels, 45,000 followers, 2 outliers (2 new)`.

---

## First-run check (important)

Instagram scrapers label fields differently, so on the **first real run**,
open one flagged reel in the queue and sanity-check its **Views** against the
actual reel on Instagram. If views read as 0 or look wrong, the actor uses a
different field name — tell me which actor you picked and I'll pin the mapping
in `src/providers/apify.js` (the `readViews` list). Everything else is
actor-agnostic.

---

## Tuning

Edit these in Railway Variables (or `src/config.js` for the defaults):

| Variable | Default | What it does |
|---|---|---|
| `REELS_PER_ACCOUNT` | 20 | Recent reels pulled per account (higher = more cost) |
| `RECENCY_DAYS` | 21 | Ignore reels older than this |
| `MIN_VIEWS_FLOOR` | 50000 | Minimum views to count at all |
| `FOLLOWER_RATIO_MIN` | 10 | Flag at ≥ this × followers |
| `BASELINE_RATIO_MIN` | 8 | ...or ≥ this × the account's own median |

Too few reels surfacing → lower the floor or the ratios. Too much noise →
raise them.

---

## Cost

Apify bills per result. At ~20 reels + profile per account:
- ~100 accounts daily ≈ a few $/month.
- ~300 accounts daily ≈ $30–90/month depending on the actor's per-result rate.
Start on the free tier ($5 credit) to prove it, then Starter ($29/mo).

---

## Swapping the scraper

The whole pipeline talks to one function — `fetchAccountReels(handle)` in
`src/providers/apify.js` — which returns a normalized shape. To move to
RapidAPI, HikerAPI, or anything else, rewrite only that file to return the
same shape. Nothing else changes.
