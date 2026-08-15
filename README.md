# GamePulse

A bilingual (EN/KO) gaming publication that runs itself: live Steam player-count
leaderboards, patch-note tracking, trending clip discovery ranked by view
velocity, free-game alerts, a cosplay spotlight, gamer tools, and an automated
research-and-drafting pipeline for articles.

Static Astro site, deployed to GitHub Pages, refreshed every 30 minutes by
GitHub Actions. **No API keys required for any data source.**

---

## Quick start

```bash
npm install
npm run seed      # fixture data so the site builds offline
npm run dev       # http://localhost:4321
```

To pull real data instead of fixtures:

```bash
npm run data      # hits the live sources, writes public/data + src/data
npm run build
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build to `dist/` |
| `npm run data` | Refresh every dataset from live sources |
| `npm run data -- clips deals` | Refresh only the named datasets |
| `npm run data -- --discover` | Also search Bluesky for new cosplay accounts |
| `npm run seed` | Write fixture data (offline development) |
| `npm test` | 39 offline pipeline tests |
| `npm run brief` | Build research briefs from current news clusters |
| `npm run write` | Draft articles from the newest brief (needs `ANTHROPIC_API_KEY`) |

---

## Deploying

### 1. Push to GitHub

```bash
git init && git add -A && git commit -m "Initial commit"
gh repo create gamepulse --public --source=. --push
```

### 2. Turn on Pages

Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.

### 3. Set the two repo variables

**Settings → Secrets and variables → Actions → Variables:**

| Variable | Value |
| --- | --- |
| `SITE_URL` | `https://<user>.github.io` — or your custom domain, no trailing slash |
| `BASE_PATH` | `/` for a user site or custom domain; `/<repo-name>/` for a project site |

Getting `BASE_PATH` wrong is the single most common cause of a deployed site
with no CSS. If the repo is named `<user>.github.io`, use `/`. Otherwise use
`/<repo-name>/`.

### 4. Optional secrets

| Secret | Effect if set |
| --- | --- |
| `PAT_TOKEN` | A fine-grained PAT with `contents: write`. Lets the data-refresh commit trigger the deploy directly instead of dispatching it. Slightly faster; entirely optional. |
| `ANTHROPIC_API_KEY` | Enables automatic article drafting. Without it the pipeline still produces research briefs — you just write from them yourself. |

### 5. Before you launch — the config checklist

- [ ] `src/config.ts` — set `SITE.url` and the `social` handles
- [ ] `src/views/pages/Contact.astro` — replace `hello@example.com` with a real, monitored address
- [ ] `public/ads.txt` — uncomment the line and insert your AdSense publisher ID
- [ ] `src/config.ts` → `adsense` — set `clientId`, `enabled: true`, and the slot IDs **after** approval
- [ ] Rename the site in `src/config.ts` if you are not calling it GamePulse

---

## How the automation works

Three workflows, none of which can break the live site on their own.

```
refresh-data.yml   every 30 min   ─→  scripts/refresh-all.mjs
                                        ├─ leaderboard   Steam charts API
                                        ├─ updates       Steam news + publisher RSS + version probes
                                        ├─ clips         YouTube channel Atom feeds
                                        ├─ deals         Epic promotions + CheapShark
                                        ├─ cosplay       Bluesky public AppView
                                        └─ news          22 RSS feeds → story clustering
                                      ↓
                                   commits JSON → triggers deploy

write-articles.yml  09:00 & 21:00 UTC  ─→  generate-brief.mjs → write-article.mjs
                                            ↓
                                        pull request, draft: true

deploy.yml          on push             ─→  test → data → build → verify → Pages
```

### Failure behaviour

The pipeline is built so that a dead upstream degrades the site rather than
breaking it:

- A failed dataset **keeps the previous JSON** and flags it `_stale`; the UI says
  so in the header badge instead of rendering an empty page.
- The refresh job only fails if *every* dataset fails.
- The deploy job's data refresh is non-fatal — it builds against committed data.
- Feeds are judged on **the age of their newest item**, not their status code.
  Two of the feeds evaluated during setup return HTTP 200 with valid XML
  containing content from 2024, and one returns a valid feed with zero items. A
  naive health check ingests all three.

### Adding or removing sources

Everything lives in `scripts/lib/sources.mjs`, with a note on each entry
explaining what was verified. The file also documents what was deliberately
excluded and why — Reddit's JSON endpoints (blocked from datacenter IPs, so they
would 403 on every Actions run), two abandoned RSS mirrors, and every game
database that turned out to require a key.

To add a YouTube channel you need its `UC…` ID, not its `@handle`: load the
channel page and search the HTML source for `rss+xml`.

---

## The article pipeline

This is the part that decides whether the site is a publication or a content
farm, so it is worth understanding.

**`scripts/generate-brief.mjs`** does not write anything. It assembles evidence:

1. Takes the hottest story clusters — stories several outlets are covering at
   once, which is a far better importance signal than any single feed.
2. Fetches the full text of every article in the cluster.
3. Extracts figures, dates, versions and quotes, each tagged with which outlet
   said it.
4. Separates **primary** sources (publisher blogs, patch notes, filings) from
   secondary reporting.
5. Cross-references claims and flags:
   - **CONFLICT** — outlets give different numbers for the same thing
   - **SINGLE-SOURCED** — only one outlet says it, with no primary backing
6. Attaches our own leaderboard data where the story is about a tracked game.

**`scripts/write-article.mjs`** drafts from that brief, under instructions that
single-sourced claims must be attributed in-text and conflicts must be resolved
against a primary source or reported as a discrepancy. Drafts are forced to
`draft: true` regardless of model output, and land as a pull request with a
review checklist.

Nothing reaches the live site without a human merging it.

---

## AdSense readiness

**Read this before applying.** Google's spam policy does not prohibit AI-assisted
content. It prohibits *scaled content abuse* — defined as generating "many pages
for the primary purpose of manipulating search rankings and not helping users,"
and it explicitly names using generative tools "to generate many pages without
adding value."

The difference is value, volume and transparency. This site is built for the
right side of that line:

| Requirement | How it is handled |
| --- | --- |
| Original content | The leaderboard, 24h deltas, 8-day trends, clip velocity ranking and cross-outlet story clustering are computed here and published nowhere else in this form |
| Not mass-produced | The drafting job runs twice a day and produces **drafts**, not posts. `write-article.mjs` refuses briefs with fewer than 4 corroborated facts |
| Human review | Every article arrives as a PR with `draft: true` and a review checklist |
| Transparency | AI assistance is disclosed on every article and in the editorial policy |
| Required pages | About, editorial policy, privacy, terms, contact — all present, in both languages |
| Privacy compliance | Consent banner with Google Consent Mode v2 signals; AdSense cookie disclosure; GDPR/CCPA/PIPA sections |
| `ads.txt` | Present, needs your publisher ID |
| No empty ad slots | `AdSlot.astro` renders nothing until `adsense.enabled` is true — a pre-approval site with empty ad containers is a common rejection |

Two things this repo cannot do for you:

1. **Build a track record.** Apply with a real posting history and real traffic,
   not on day one with six articles.
2. **Provide a certified CMP.** If you serve personalised ads to users in the
   EEA, UK or Switzerland, Google requires a CMP from its certified list. The
   included banner is a good-faith default that blocks storage until consent —
   swap it before running personalised ads in those regions.

---

## SEO and GEO

**SEO:** per-page canonical URLs, `hreflang` (en / ko / x-default) on every page,
JSON-LD graph (Organization, WebSite, WebPage, BreadcrumbList, NewsArticle/
Article with `citation[]`, FAQPage, VideoGame `about[]`), OG and Twitter cards,
a locale-aware sitemap with per-section change frequencies, RSS per language,
and YouTube facade embeds so a page with twelve clips does not carry twelve
iframes' worth of Core Web Vitals damage.

**GEO** (getting cited by AI answer engines) is a different job from ranking, and
it comes down to being the easiest source to quote correctly:

- **`/llms.txt`** — a flat-markdown map of the site: what each dataset is, where
  it comes from, how fresh it is, and a **"what this site cannot tell you"**
  section listing our limits explicitly. A model that knows our boundaries is
  less likely to misattribute a claim to us.
- **`keyTakeaway`** on every article — one self-contained paragraph, every key
  number in it, written to be lifted verbatim.
- **FAQ blocks** as `FAQPage` schema — real questions, standalone answers.
- **`citation[]`** in article schema, populated from the sources list.
- **Machine-readable JSON** at `/data/*.json`, linked from `llms.txt`.
- **`robots.txt` allows AI crawlers on purpose.** GPTBot, ClaudeBot,
  PerplexityBot, Google-Extended and others are explicitly allowed — blocking
  them protects content from training but also removes any possibility of being
  cited. Flip them to `Disallow` in `src/pages/robots.txt.ts` if you decide that
  trade is not worth it.

---

## Testing

```bash
npm test
```

39 tests that stub `fetch` and run the real fetcher modules end to end against
realistic fixtures. They cover the parsing, ranking, clustering and staleness
logic — the places bugs actually live — including:

- rejecting a stale feed that returns 200 with valid XML
- rejecting a valid feed with zero items
- YouTube velocity ranking a 6-hour-old clip above a 2-year-old viral one
- the leaderboard falling back to per-app counts when the charts API dies
- filtering forum noise down to patch threads
- clustering the same story across outlets that phrase headlines differently
- *not* clustering unrelated headlines
- Korean bigram tokenisation
- every cosplay card carrying attribution back to its creator

Fixtures in `scripts/test/fixtures.mjs` match the exact response shapes verified
on 2026-08-15. If an upstream changes shape, update the fixture and the failing
tests will show you what breaks downstream.

---

## Project layout

```
scripts/
  lib/           http (retry, backoff, pooling), feed parsing + health, sources registry, history store
  fetch-*.mjs    one module per dataset
  refresh-all.mjs        orchestrator — never blanks a dataset on failure
  generate-brief.mjs     evidence assembly + conflict detection
  write-article.mjs      drafting (optional, needs a key)
  test/          fixtures, 39 integration tests, offline seed generator
src/
  config.ts      site identity, AdSense, analytics, poll interval
  i18n/ui.ts     every string, both languages
  content/posts/{en,ko}/   articles, paired by translationKey
  data/          generated JSON, imported at build time so numbers are in the HTML
  components/    Header, Footer, ThemeToggle, Seo, LiveBadge, LeaderboardTable, cards…
  views/         shared page bodies rendered by both locales
  pages/         thin route wrappers, EN at root and KO under /ko/
data-store/
  history.json   rolling 8-day player-count series — the repo is the database
public/data/     same JSON, fetched client-side for live refresh between builds
```

Pages are thin wrappers around shared views so the English and Korean routes
cannot drift apart structurally — only their strings differ.

---

## Known limitations

Stated plainly, because they are also stated on the site:

- **Player counts are Steam-only.** No console platform holder or mobile store
  publishes a comparable live concurrent figure. A game low on the leaderboard
  may be enormous on PlayStation.
- **"Real-time" means every 30 minutes.** GitHub Pages serves static files;
  the browser re-polls `/data/*.json` between builds, and GitHub's cron
  scheduler is best-effort and runs late under load.
- **Riot, Blizzard and HoYoverse publish no usable patch RSS.** Riot is handled
  by polling live build-version endpoints; Blizzard by filtering their Discourse
  forum feed; HoYoverse is not covered automatically at all.
- **Reddit is not used.** It blocks unauthenticated JSON from datacenter IPs,
  so it would 403 on every Actions run.
- **Bluesky `searchPosts` requires auth** — the only public read endpoint that
  does. Cosplay discovery uses `searchActors` + `getAuthorFeed` instead, which
  means a curated account list rather than open keyword search.
- **Steam's `appdetails` endpoint is undocumented** and rate-limited to roughly
  200 requests per 5 minutes. Metadata is cached in `data-store/history.json`
  and only looked up for games never seen before.

---

## Licence

Code: MIT. Content in `src/content/`: yours. Game artwork, screenshots and
trademarks belong to their respective publishers.
