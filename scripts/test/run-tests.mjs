#!/usr/bin/env node
/**
 * Offline integration tests for the data pipeline.
 *
 * Stubs globalThis.fetch and runs the REAL fetcher modules end to end, so the
 * parsing, ranking, clustering and staleness logic is genuinely exercised —
 * only the network is faked. Run with: npm test
 */
import assert from 'node:assert/strict';
import { rm, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as F from './fixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Must be set before any fetcher imports lib/history.mjs.
process.env.GP_HISTORY_PATH = resolve(ROOT, '.test-history.json');
// No politeness delays against a stubbed fetch, and resolve the whole mobile
// roster in one pass so the tests do not depend on the production batch size.
process.env.GP_PACE_MS = '0';
process.env.GP_MOBILE_RESOLVE_LIMIT = '500';

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message.split('\n')[0]}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

/* ---------------- fetch stub ---------------- */
const realFetch = globalThis.fetch;
let routes = [];
let unmatched = [];

function mockFetch(matchers) {
  routes = matchers;
  unmatched = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    for (const [pattern, respond] of routes) {
      if (u.includes(pattern)) {
        const value = typeof respond === 'function' ? respond(u) : respond;
        if (value === null) return new Response('nope', { status: 503 });
        const body = typeof value === 'string' ? value : JSON.stringify(value);
        const type = typeof value === 'string' ? 'application/xml' : 'application/json';
        return new Response(body, { status: 200, headers: { 'content-type': type } });
      }
    }
    unmatched.push(u);
    return new Response('not found', { status: 404 });
  };
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

/* =========================================================
   Run
   ========================================================= */
console.log('\n━━━ GamePulse pipeline tests ━━━');

// Start from a clean history so delta assertions are deterministic.
await rm(resolve(ROOT, '.test-history.json'), { force: true });

/* ---------- feed parsing ---------- */
section('Feed parsing & health gating');
{
  const { fetchFeed, fetchYouTubeChannel, youTubeId } = await import('../lib/feed.mjs');

  await test('parses a well-formed RSS 2.0 feed', async () => {
    mockFetch([['good.example', F.rssFeed({ title: 'Good Outlet' })]]);
    const res = await fetchFeed('https://good.example/feed');
    assert.equal(res.ok, true);
    assert.equal(res.items.length, 5);
    assert.equal(res.items[0].source, 'Good Outlet');
    assert.ok(res.items[0].link.startsWith('https://'));
  });

  await test('strips HTML/CDATA out of summaries', async () => {
    mockFetch([['good.example', F.rssFeed({})]]);
    const res = await fetchFeed('https://good.example/feed');
    assert.ok(!res.items[0].summary.includes('<'), 'summary still contains markup');
    assert.ok(res.items[0].summary.includes('markup'));
  });

  await test('extracts media:thumbnail images', async () => {
    mockFetch([['good.example', F.rssFeed({})]]);
    const res = await fetchFeed('https://good.example/feed');
    assert.equal(res.items[0].image, 'https://example.com/img-1.jpg');
  });

  await test('REJECTS a stale feed that returns 200 with valid XML', async () => {
    mockFetch([['stale.example', F.staleFeed]]);
    const res = await fetchFeed('https://stale.example/feed', { maxAgeDays: 21 });
    assert.equal(res.ok, false, 'stale feed was wrongly accepted');
    assert.equal(res.error, 'stale');
    assert.ok(res.staleDays > 700);
  });

  await test('REJECTS a valid feed containing zero items', async () => {
    mockFetch([['empty.example', F.emptyFeed]]);
    const res = await fetchFeed('https://empty.example/feed');
    assert.equal(res.ok, false);
    assert.equal(res.error, 'empty');
  });

  await test('handles an unreachable feed without throwing', async () => {
    mockFetch([['dead.example', null]]);
    const res = await fetchFeed('https://dead.example/feed', { retries: 0 });
    assert.equal(res.ok, false);
    assert.equal(res.items.length, 0);
  });

  await test('computes YouTube view velocity from media:statistics', async () => {
    mockFetch([['youtube.com/feeds', F.youtubeFeed('UCtest', 'Test Channel')]]);
    const vids = await fetchYouTubeChannel('UCtest', { name: 'Test Channel' });
    assert.equal(vids.length, 3);
    const clutch = vids.find((v) => v.videoId === 'dQw4w9WgXcQ');
    assert.equal(clutch.views, 480000);
    // 480,000 views over ~6 hours ≈ 80,000/hr
    assert.ok(clutch.velocity > 70000 && clutch.velocity < 90000, `velocity was ${clutch.velocity}`);
  });

  await test('velocity ranks a fresh clip above an old viral one', async () => {
    mockFetch([['youtube.com/feeds', F.youtubeFeed('UCtest')]]);
    const vids = await fetchYouTubeChannel('UCtest', {});
    const fresh = vids.find((v) => v.videoId === 'dQw4w9WgXcQ');
    const old = vids.find((v) => v.videoId === 'zYxWvUtSrQp');
    assert.ok(old.views > fresh.views, 'fixture assumption: old video has more total views');
    assert.ok(fresh.velocity > old.velocity, 'fresh clip should win on velocity');
  });

  await test('youTubeId extracts ids from every URL form', () => {
    assert.equal(youTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(youTubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(youTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(youTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0'), 'dQw4w9WgXcQ');
    assert.equal(youTubeId('https://example.com/not-a-video'), null);
  });
}

/* ---------- leaderboard ---------- */
section('Leaderboard');
{
  const { fetchLeaderboard } = await import('../fetch-leaderboard.mjs');

  const liveMocks = () => [
    ['GetGamesByConcurrentPlayers', F.steamConcurrent],
    ['GetMostPlayedGames', F.steamChart],
    ['appdetails', (u) => F.steamAppDetails(new URL(u).searchParams.get('appids'))],
  ];

  await test('builds a ranked board from the live-concurrents endpoint', async () => {
    mockFetch(liveMocks());
    const lb = await fetchLeaderboard();
    assert.ok(lb, 'returned null');
    assert.equal(lb.entries.length, 10);
    assert.equal(lb.entries[0].rank, 1);
    assert.equal(lb.entries[0].appid, 730);
    assert.equal(lb.entries[0].current, 746368);
    assert.equal(lb.metric, 'concurrent');
    assert.ok(lb.sourceUrl.includes('GetGamesByConcurrentPlayers'), lb.sourceUrl);
  });

  /* Regression: the enrichment step skipped any app whose name was hardcoded in
     TRACKED_APPS, so the biggest games on the site never had is_free resolved
     and Counter-Strike 2 rendered as "Paid". */
  await test('REGRESSION: hardcoded-name apps still get store metadata resolved', async () => {
    mockFetch(liveMocks());
    const lb = await fetchLeaderboard();
    const cs = lb.entries.find((e) => e.appid === 730); // 730 is in TRACKED_APPS
    assert.equal(cs.metaResolved, true, 'a TRACKED_APPS entry was never enriched');
    assert.equal(cs.free, true, 'Counter-Strike 2 is free-to-play and came back as paid');
  });

  await test('sums total players across the board', async () => {
    mockFetch(liveMocks());
    const lb = await fetchLeaderboard();
    const expected = F.steamConcurrent.response.ranks.reduce((s, r) => s + r.concurrent_in_game, 0);
    assert.equal(lb.totalPlayers, expected);
  });

  /* Regression: the first production deploy shipped a board of zeros because
     GetMostPlayedGames has no concurrent_in_game field and the code read one
     anyway. These three lock that door. */
  await test('REGRESSION: never reports 0 when the weekly chart omits concurrent_in_game', async () => {
    mockFetch([
      ['GetGamesByConcurrentPlayers', null], // live endpoint down
      ['GetMostPlayedGames', F.steamChart],  // weekly chart: peak only
      ['appdetails', (u) => F.steamAppDetails(new URL(u).searchParams.get('appids'))],
    ]);
    const lb = await fetchLeaderboard();
    assert.ok(lb, 'returned null');
    assert.ok(lb.totalPlayers > 0, 'board totalled zero players');
    for (const e of lb.entries) {
      assert.ok(e.current > 0, `${e.name} reported ${e.current} players`);
    }
  });

  await test('labels the metric as peak when only the weekly chart is available', async () => {
    mockFetch([
      ['GetGamesByConcurrentPlayers', null],
      ['GetMostPlayedGames', F.steamChart],
      ['appdetails', (u) => F.steamAppDetails(new URL(u).searchParams.get('appids'))],
    ]);
    const lb = await fetchLeaderboard();
    assert.equal(lb.metric, 'peak', 'peak figures must not be presented as live');
    assert.ok(/peak/i.test(lb.source), lb.source);
  });

  await test('prefers live concurrents over the weekly chart when both respond', async () => {
    mockFetch(liveMocks());
    const lb = await fetchLeaderboard();
    // CS2 weekly peak is 1,182,329; live concurrent is 746,368.
    assert.equal(lb.entries[0].current, 746368, 'used the weekly peak instead of the live figure');
  });

  await test('persists history and produces a sparkline on the second run', async () => {
    mockFetch(liveMocks());
    await fetchLeaderboard();
    // Age the stored samples so the 10-minute collapse window does not merge them.
    const hp = resolve(ROOT, 'data-store/history.json');
    const h = JSON.parse(await readFile(hp, 'utf8'));
    for (const pts of Object.values(h.series)) for (const p of pts) p.t -= 40 * 3600_000;
    const { writeFile } = await import('node:fs/promises');
    await writeFile(hp, JSON.stringify(h));

    const lb2 = await fetchLeaderboard();
    assert.ok(lb2.entries[0].spark.length >= 2, 'sparkline did not accumulate points');
    assert.notEqual(lb2.entries[0].change24h, null, '24h change should be computable');
  });

  await test('falls back to per-app counts when the chart service dies', async () => {
    mockFetch([
      ['GetGamesByConcurrentPlayers', null],
      ['GetMostPlayedGames', null],
      ['GetNumberOfCurrentPlayers', (u) => {
        const id = new URL(u).searchParams.get('appid');
        return { response: { player_count: 100000 - Number(id) % 50000, result: 1 } };
      }],
      ['appdetails', (u) => F.steamAppDetails(new URL(u).searchParams.get('appids'))],
    ]);
    const lb = await fetchLeaderboard();
    assert.ok(lb, 'fallback returned null');
    assert.ok(lb.entries.length > 5, 'fallback produced too few entries');
    assert.equal(lb.entries[0].rank, 1);
    // Ranks must be strictly descending by player count.
    for (let i = 1; i < lb.entries.length; i++) {
      assert.ok(lb.entries[i - 1].current >= lb.entries[i].current, 'fallback ranking is not sorted');
    }
  });

  await test('returns null when Steam is entirely unreachable', async () => {
    mockFetch([['api.steampowered.com', null]]);
    const lb = await fetchLeaderboard();
    assert.equal(lb, null);
  });
}

/* ---------- updates ---------- */
section('Update tracker');
{
  const { fetchUpdates } = await import('../fetch-updates.mjs');

  await test('parses Steam news into patch entries and strips BBCode', async () => {
    mockFetch([
      ['GetNewsForApp', (u) => F.steamNews(new URL(u).searchParams.get('appid'))],
      ['pathofexile.com/news/rss', F.rssFeed({ title: 'Path of Exile', headlines: ['0.5.5 Patch Notes'] })],
      ['bungie.net/en/rss', F.rssFeed({ title: 'Bungie', headlines: ['Update 1.1.5.3'] })],
      ['forums.blizzard.com', F.rssFeed({ title: 'Blizzard Forums', headlines: ['Overwatch Patch Notes – August 11, 2026', 'random player thread'] })],
      ['ddragon.leagueoflegends.com', F.ddragonVersions],
      ['valorant-api.com', F.valorantVersion],
    ]);
    const up = await fetchUpdates();
    assert.ok(up.games.length > 0);
    const withSteam = up.games.find((g) => g.method === 'Steam news API');
    assert.ok(withSteam, 'no Steam-sourced game found');
    assert.ok(!withSteam.latest.summary.includes('[h1]'), 'BBCode leaked into the summary');
    assert.ok(!withSteam.latest.summary.includes('[b]'), 'BBCode leaked into the summary');
  });

  await test('detects the live League patch version via ddragon', async () => {
    mockFetch([
      ['GetNewsForApp', (u) => F.steamNews(new URL(u).searchParams.get('appid'))],
      ['ddragon.leagueoflegends.com', F.ddragonVersions],
      ['valorant-api.com', F.valorantVersion],
    ]);
    const up = await fetchUpdates();
    const lol = up.games.find((g) => g.id === 'lol');
    assert.ok(lol, 'League probe missing');
    assert.equal(lol.latest.version, '26.16.1');
    assert.ok(lol.latest.url.includes('patch-26-16-notes'), `bad notes URL: ${lol.latest.url}`);
  });

  await test('derives the VALORANT build from the version endpoint', async () => {
    mockFetch([
      ['GetNewsForApp', (u) => F.steamNews(new URL(u).searchParams.get('appid'))],
      ['ddragon.leagueoflegends.com', F.ddragonVersions],
      ['valorant-api.com', F.valorantVersion],
    ]);
    const up = await fetchUpdates();
    const val = up.games.find((g) => g.id === 'valorant');
    assert.equal(val.latest.version, '13.02');
    assert.ok(val.latest.url.includes('13-02'));
  });

  await test('filters forum noise down to patch threads only', async () => {
    mockFetch([
      ['GetNewsForApp', null],
      ['forums.blizzard.com/en/overwatch', F.rssFeed({
        title: 'Overwatch Forum',
        headlines: [
          'Overwatch Retail Patch Notes – August 11, 2026',
          'Why is my rank going down',
          'LF group for comp',
          'Hotfix deployed for D.Mon',
          'anyone else miss old Busan',
        ],
      })],
      ['ddragon', F.ddragonVersions],
      ['valorant-api.com', F.valorantVersion],
    ]);
    const up = await fetchUpdates();
    const ow = up.games.find((g) => g.id === 'overwatch');
    assert.ok(ow, 'overwatch entry missing');
    assert.equal(ow.entries.length, 2, `expected 2 patch threads, got ${ow.entries.length}`);
    for (const e of ow.entries) {
      assert.match(e.title, /patch|hotfix/i);
    }
  });

  await test('survives every update source failing', async () => {
    mockFetch([['', null]]);
    const up = await fetchUpdates();
    assert.ok(Array.isArray(up.games));
    assert.ok(Array.isArray(up.timeline));
  });
}

/* ---------- clips ---------- */
section('Clips');
{
  const { fetchClips } = await import('../fetch-clips.mjs');

  await test('aggregates channels and ranks by velocity', async () => {
    mockFetch([['youtube.com/feeds', (u) => {
      const id = new URL(u).searchParams.get('channel_id');
      return F.youtubeFeed(id, `Channel ${id.slice(-4)}`);
    }]]);
    const clips = await fetchClips();
    assert.ok(clips, 'returned null');
    assert.ok(clips.trending.length > 0);
    for (let i = 1; i < clips.trending.length; i++) {
      assert.ok(clips.trending[i - 1].velocity >= clips.trending[i].velocity, 'trending is not velocity-sorted');
    }
  });

  await test('excludes videos older than the freshness window', async () => {
    mockFetch([['youtube.com/feeds', (u) => F.youtubeFeed(new URL(u).searchParams.get('channel_id'))]]);
    const clips = await fetchClips();
    const stale = clips.trending.find((v) => v.videoId === 'zYxWvUtSrQp');
    assert.equal(stale, undefined, 'a 2-year-old video made it into trending');
  });

  await test('caps how many slots one channel can occupy', async () => {
    mockFetch([['youtube.com/feeds', (u) => F.youtubeFeed(new URL(u).searchParams.get('channel_id'))]]);
    const clips = await fetchClips();
    const counts = {};
    for (const v of clips.trending) counts[v.channelId] = (counts[v.channelId] ?? 0) + 1;
    for (const [ch, n] of Object.entries(counts)) {
      assert.ok(n <= 3, `channel ${ch} took ${n} slots (limit 3)`);
    }
  });

  await test('returns null rather than an empty page when YouTube is down', async () => {
    mockFetch([['youtube.com', null]]);
    const clips = await fetchClips();
    assert.equal(clips, null);
  });
}

/* ---------- deals ---------- */
section('Deals');
{
  const { fetchDeals } = await import('../fetch-deals.mjs');

  await test('separates currently-free from upcoming-free correctly', async () => {
    mockFetch([
      ['freeGamesPromotions', F.epicFree],
      ['cheapshark.com/api/1.0/deals', F.cheapSharkDeals],
      ['cheapshark.com/api/1.0/stores', F.cheapSharkStores],
    ]);
    const d = await fetchDeals();
    assert.equal(d.freeNow.length, 1);
    assert.equal(d.freeNow[0].title, 'Caravan SandWitch');
    assert.equal(d.freeSoon.length, 1);
    assert.equal(d.freeSoon[0].title, 'Next Week Freebie');
  });

  await test('excludes a 50%-off item from the free lists', async () => {
    mockFetch([
      ['freeGamesPromotions', F.epicFree],
      ['cheapshark.com/api/1.0/deals', F.cheapSharkDeals],
      ['cheapshark.com/api/1.0/stores', F.cheapSharkStores],
    ]);
    const d = await fetchDeals();
    const titles = [...d.freeNow, ...d.freeSoon].map((x) => x.title);
    assert.ok(!titles.includes('Just A Discount, Not Free'), 'a paid discount was listed as free');
  });

  await test('resolves store names and filters weak discounts', async () => {
    mockFetch([
      ['freeGamesPromotions', F.epicFree],
      ['cheapshark.com/api/1.0/deals', F.cheapSharkDeals],
      ['cheapshark.com/api/1.0/stores', F.cheapSharkStores],
    ]);
    const d = await fetchDeals();
    assert.equal(d.discounts.length, 2, 'the 10%-off deal should have been filtered out');
    assert.equal(d.discounts[0].store, 'Steam');
    assert.equal(d.discounts[0].savings, 75);
    assert.ok(d.discounts[0].url.includes('cheapshark.com/redirect'));
  });

  await test('still returns Epic data when CheapShark is down', async () => {
    mockFetch([
      ['freeGamesPromotions', F.epicFree],
      ['cheapshark.com', null],
    ]);
    const d = await fetchDeals();
    assert.ok(d, 'returned null despite Epic being up');
    assert.equal(d.freeNow.length, 1);
    assert.equal(d.discounts.length, 0);
  });
}

/* ---------- news + clustering ---------- */
section('News clustering');
{
  const { fetchNews } = await import('../fetch-news.mjs');

  const bigStory = [
    'Nintendo confirms Switch 2 price increase to $500 from September 1',
    'Switch 2 price rises by $50 in the US and Europe next month',
    'Nintendo raising Switch 2 price to $500 on September 1',
  ];

  await test('clusters the same story across multiple outlets', async () => {
    mockFetch([
      ['feedburner.com/ign', F.rssFeed({ title: 'IGN', headlines: [bigStory[0], 'Unrelated indie review'], count: 2 })],
      ['pcgamer.com', F.rssFeed({ title: 'PC Gamer', headlines: [bigStory[1], 'A different GPU story'], count: 2 })],
      ['kotaku.com', F.rssFeed({ title: 'Kotaku', headlines: [bigStory[2], 'Something else entirely'], count: 2 })],
      ['', F.emptyFeed],
    ]);
    const news = await fetchNews();
    const clusters = news.feeds.en.clusters;
    assert.ok(clusters.length > 0, 'no clusters formed');
    const top = clusters[0];
    assert.ok(top.outletCount >= 3, `expected 3+ outlets in the top cluster, got ${top.outletCount}`);
    assert.match(top.headline, /Switch 2/i);
    assert.ok(top.articles.length >= 3, 'cluster lost its source articles');
  });

  await test('a cluster keeps every source URL for fact-checking', async () => {
    mockFetch([
      ['feedburner.com/ign', F.rssFeed({ title: 'IGN', headlines: [bigStory[0]], count: 1 })],
      ['pcgamer.com', F.rssFeed({ title: 'PC Gamer', headlines: [bigStory[1]], count: 1 })],
      ['kotaku.com', F.rssFeed({ title: 'Kotaku', headlines: [bigStory[2]], count: 1 })],
      ['', F.emptyFeed],
    ]);
    const news = await fetchNews();
    const top = news.feeds.en.clusters[0];
    for (const a of top.articles) {
      assert.ok(a.url?.startsWith('http'), 'article missing a URL');
      assert.ok(a.outlet, 'article missing an outlet name');
    }
  });

  await test('does not merge unrelated headlines', async () => {
    mockFetch([
      ['feedburner.com/ign', F.rssFeed({ title: 'IGN', headlines: ['Nintendo raises Switch 2 price'], count: 1 })],
      ['pcgamer.com', F.rssFeed({ title: 'PC Gamer', headlines: ['Best mechanical keyboards for 2026'], count: 1 })],
      ['kotaku.com', F.rssFeed({ title: 'Kotaku', headlines: ['Nintendo confirms Switch 2 price hike'], count: 1 })],
      ['', F.emptyFeed],
    ]);
    const news = await fetchNews();
    const top = news.feeds.en.clusters[0];
    assert.ok(!top.articles.some((a) => /keyboard/i.test(a.title)), 'unrelated headline was clustered in');
  });

  await test('reports per-feed health including stale detection', async () => {
    mockFetch([
      ['feedburner.com/ign', F.rssFeed({ title: 'IGN', count: 3 })],
      ['pcgamer.com', F.staleFeed],
      ['kotaku.com', F.emptyFeed],
      ['', null],
    ]);
    const news = await fetchNews();
    const ign = news.health.find((h) => h.name === 'IGN');
    const pcg = news.health.find((h) => h.name === 'PC Gamer');
    const kot = news.health.find((h) => h.name === 'Kotaku');
    assert.equal(ign.ok, true);
    assert.equal(pcg.ok, false);
    assert.equal(pcg.error, 'stale');
    assert.equal(kot.ok, false);
    assert.equal(kot.error, 'empty');
  });

  await test('handles Korean headlines with bigram tokenisation', async () => {
    mockFetch([
      ['feeds.feedburner.com/inven', F.rssFeed({
        title: '인벤',
        headlines: ['닌텐도, 스위치2 가격 9월 1일부터 50달러 인상', '신작 인디게임 리뷰'],
        count: 2,
      })],
      ['bbs.ruliweb.com/news/rss', F.rssFeed({
        title: '루리웹',
        headlines: ['스위치2 가격 인상 발표, 9월 1일부터 적용', '주간 판매량 집계'],
        count: 2,
      })],
      ['gamemeca.com', F.rssFeed({
        title: '게임메카',
        headlines: ['닌텐도 스위치2 가격 인상 공식 발표', 'PC방 순위'],
        count: 2,
      })],
      ['', F.emptyFeed],
    ]);
    const news = await fetchNews();
    const ko = news.feeds.ko.clusters;
    assert.ok(ko.length > 0, 'no Korean clusters formed');
    assert.ok(ko[0].outletCount >= 2, `Korean clustering found only ${ko[0].outletCount} outlet(s)`);
  });
}


/* ---------- mobile ---------- */
section('Mobile games');
{
  const cc = (u) => new URL(u).searchParams.get('country') || 'us';
  const appleMocks = () => [
    ['itunes.apple.com/search', (u) => F.itunesSearch(new URL(u).searchParams.get('term'), cc(u))],
    ['itunes.apple.com/lookup', (u) => F.itunesLookup(new URL(u).searchParams.get('id'), cc(u))],
  ];

  const { fetchMobile } = await import('../fetch-mobile.mjs');
  const HIST = resolve(ROOT, '.test-history.json');

  /* fetchMobile caches resolved app ids and rating samples in the history
     store, so without a reset the second test reads the first one's cache and
     the velocity assertions become meaningless. Only the mobile keys are
     cleared — the Steam series other sections rely on stays put.
     (Re-importing the module with a cache-busting query would NOT work:
     lib/history.mjs resolves its path once at load and is shared.) */
  const resetMobileCache = async (seedSeries) => {
    let h = {};
    try {
      h = JSON.parse(await readFile(HIST, 'utf8'));
    } catch {
      h = { version: 1, series: {}, meta: {} };
    }
    delete h.mobileApps;
    h.series ??= {};
    for (const k of Object.keys(h.series)) if (k.startsWith('m:')) delete h.series[k];
    Object.assign(h.series, seedSeries ?? {});
    await writeFile(HIST, JSON.stringify(h), 'utf8');
  };

  const freshMobile = async () => {
    await resetMobileCache();
    return fetchMobile;
  };

  await test('rejects guide apps and clones that outrank the real game in search', async () => {
    const fetchMobile = await freshMobile();
    mockFetch(appleMocks());
    const m = await fetchMobile();
    assert.ok(m, 'returned null');
    const names = m.charts.us.entries.map((g) => g.name);
    assert.ok(names.includes('Roblox'), 'lost the real game');
    // results[0] is "Guide for Roblox" and results[1] is a wallpaper app.
    assert.ok(!names.some((n) => /Guide for/.test(n)), 'a guide app was listed as a game');
    assert.ok(!names.some((n) => /Wallpapers/.test(n)), 'a wallpaper app was listed as a game');
  });

  await test('ranks by rating count and numbers the rows 1..n', async () => {
    const fetchMobile = await freshMobile();
    mockFetch(appleMocks());
    const m = await fetchMobile();
    const rows = m.charts.us.entries;
    assert.deepEqual(rows.map((r) => r.rank), rows.map((_, i) => i + 1), 'ranks are not 1..n');
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1].ratings >= rows[i].ratings, 'not sorted by rating count');
    }
    assert.equal(rows[0].name, 'Roblox', 'the most-rated game is not first');
  });

  await test('uses each storefront’s own localised title and rating count', async () => {
    const fetchMobile = await freshMobile();
    mockFetch(appleMocks());
    const m = await fetchMobile();
    assert.ok(m.charts.kr, 'no Korean storefront');
    const ba = m.charts.kr.entries.find((e) => e.appId === '1642013251');
    assert.ok(ba, 'Blue Archive missing from the KR board');
    assert.equal(ba.name, '블루 아카이브', 'KR board used the US title');
    const baUs = m.charts.us.entries.find((e) => e.appId === '1642013251');
    assert.ok(ba.ratings > baUs.ratings, 'KR and US rating counts are not independent');
  });

  await test('carries a game that exists only in the Korean storefront', async () => {
    const fetchMobile = await freshMobile();
    mockFetch(appleMocks());
    const m = await fetchMobile();
    assert.ok(
      m.charts.kr.entries.some((e) => e.appId === '1571023359'),
      'Lineage W, which never shipped in the US, was dropped'
    );
    assert.ok(
      !m.charts.us.entries.some((e) => e.appId === '1571023359'),
      'a KR-only game leaked into the US board'
    );
  });

  await test('keeps the previous board rather than writing a partial one when lookup dies', async () => {
    const fetchMobile = await freshMobile();
    mockFetch([
      ['itunes.apple.com/search', (u) => F.itunesSearch(new URL(u).searchParams.get('term'), cc(u))],
      ['itunes.apple.com/lookup', null],
    ]);
    const m = await fetchMobile();
    assert.equal(m, null, 'returned a board built from a dead lookup');
  });

  await test('chunks the lookup so a long id list is never truncated server-side', async () => {
    const seen = [];
    const fetchMobile = await freshMobile();
    mockFetch([
      ['itunes.apple.com/search', (u) => F.itunesSearch(new URL(u).searchParams.get('term'), cc(u))],
      ['itunes.apple.com/lookup', (u) => {
        const ids = new URL(u).searchParams.get('id').split(',');
        seen.push(ids.length);
        assert.ok(ids.length <= 20, `sent a batch of ${ids.length} ids`);
        return F.itunesLookup(ids.join(','), cc(u));
      }],
    ]);
    const m = await fetchMobile();
    assert.ok(m, 'returned null');
    assert.ok(seen.length > 0, 'lookup was never called');
  });

  await test('reports ratings velocity as null until there is a real time span', async () => {
    const fetchMobile = await freshMobile();
    mockFetch(appleMocks());
    const m = await fetchMobile();
    // First ever run: one sample, no span, so no weekly figure may be claimed.
    for (const e of m.charts.us.entries) {
      assert.equal(e.ratingsPerWeek, null, `invented a weekly delta from a single sample for ${e.name}`);
    }
  });

  await test('extrapolates a weekly delta from an older sample', async () => {
    // Roblox sat 140,000 ratings lower 3.5 days ago -> ~280,000/week.
    const threeAndAHalfDaysAgo = Date.now() - 3.5 * 24 * 3600_000;
    await resetMobileCache({
      'm:us:1477376905': [{ t: threeAndAHalfDaysAgo, v: 8_140_233 - 140_000 }],
    });
    mockFetch(appleMocks());
    const m = await fetchMobile();
    const roblox = m.charts.us.entries.find((e) => e.appId === '1477376905');
    assert.ok(roblox.ratingsPerWeek > 270_000 && roblox.ratingsPerWeek < 290_000,
      `weekly delta was ${roblox.ratingsPerWeek}`);
  });

  /* Regression: the first deploy published "+0 this week" against 19.8 million
     Roblox ratings. A zero is not a measurement, and a corrupt timestamp makes
     the span look like decades so that any flat reading passes the day-long
     minimum and formats as a confident zero. Both must come out as null. */
  await test('REGRESSION: a flat reading is null, never a published zero', async () => {
    await resetMobileCache({
      'm:us:1477376905': [{ t: Date.now() - 3 * 24 * 3600_000, v: 8_140_233 }],
    });
    mockFetch(appleMocks());
    const m = await fetchMobile();
    const roblox = m.charts.us.entries.find((e) => e.appId === '1477376905');
    assert.equal(roblox.ratingsPerWeek, null, 'published a zero weekly delta');
  });

  await test('REGRESSION: a corrupt sample timestamp cannot fake a week of history', async () => {
    for (const bad of [0, null, undefined, NaN, Date.now() + 5 * 24 * 3600_000]) {
      await resetMobileCache({ 'm:us:1477376905': [{ t: bad, v: 8_000_000 }] });
      mockFetch(appleMocks());
      const m = await fetchMobile();
      const roblox = m.charts.us.entries.find((e) => e.appId === '1477376905');
      assert.equal(roblox.ratingsPerWeek, null, `t=${String(bad)} produced a weekly delta`);
    }
  });

  await test('refuses a negative delta rather than showing a game shrinking', async () => {
    // Apple resets counts on some relaunches; that is not negative growth.
    await resetMobileCache({
      'm:us:1477376905': [{ t: Date.now() - 3 * 24 * 3600_000, v: 9_999_999 }],
    });
    mockFetch(appleMocks());
    const m = await fetchMobile();
    const roblox = m.charts.us.entries.find((e) => e.appId === '1477376905');
    assert.equal(roblox.ratingsPerWeek, null, 'reported a negative weekly delta');
  });

  await test('labels the metric honestly and reports Android as unavailable', async () => {
    const fetchMobile = await freshMobile();
    mockFetch(appleMocks());
    const m = await fetchMobile();
    assert.equal(m.androidAvailable, false);
    assert.match(m.note, /NOT a player count/i);
    assert.match(m.androidNote, /Google Play/);
  });
}

/* ---------- speedruns ---------- */
section('Speedrun leaderboards');
{
  const { fetchSpeedruns } = await import('../fetch-speedruns.mjs');

  const srMocks = () => [
    ['speedrun.com/api/v1/games?name=', (u) => F.srGameSearch(new URL(u).searchParams.get('name'))],
    ['/categories', F.srCategories],
    ['speedrun.com/api/v1/leaderboards', F.srLeaderboard],
  ];

  await test('builds a per-game runner leaderboard', async () => {
    mockFetch(srMocks());
    const sr = await fetchSpeedruns();
    assert.ok(sr, 'returned null');
    const board = Object.values(sr.boards)[0];
    assert.ok(board.runs.length >= 3);
    assert.equal(board.runs[0].place, 1);
    assert.equal(board.category, 'Any%', 'picked a miscellaneous or per-level category');
  });

  await test('TRAP: joins players from the flat embed list, not from run stubs', async () => {
    mockFetch(srMocks());
    const sr = await fetchSpeedruns();
    const board = Object.values(sr.boards)[0];
    // embed=players returns ONE list at data.players.data[]; run.players stays
    // as id stubs. Without the join every name would be "Unknown".
    assert.equal(board.runs[0].players[0].name, 'Distortion2');
    assert.ok(!board.runs.some((r) => r.players.some((p) => p.name === 'Unknown')), 'a player failed to resolve');
  });

  await test('TRAP: handles guest players, which have a flat name and no id', async () => {
    mockFetch(srMocks());
    const sr = await fetchSpeedruns();
    const board = Object.values(sr.boards)[0];
    const guest = board.runs.flatMap((r) => r.players).find((p) => p.guest);
    assert.ok(guest, 'no guest player found in fixture');
    assert.equal(guest.name, 'AnonRunner', 'guest name read from the wrong field');
  });

  await test('TRAP: survives null videos and null dates', async () => {
    mockFetch(srMocks());
    const sr = await fetchSpeedruns();
    const board = Object.values(sr.boards)[0];
    const noVideo = board.runs.find((r) => r.video === null);
    assert.ok(noVideo, 'null-video run was dropped or crashed');
    assert.equal(noVideo.date, null);
    // videos.text present but videos.links absent must also yield null, not throw.
    assert.ok(board.runs.every((r) => r.video === null || typeof r.video === 'string'));
  });

  await test('TRAP: preserves ties (top=N can return more than N runs)', async () => {
    mockFetch(srMocks());
    const sr = await fetchSpeedruns();
    const board = Object.values(sr.boards)[0];
    const places = board.runs.map((r) => r.place);
    assert.equal(places.filter((p) => p === 2).length, 2, 'tie was collapsed');
    assert.equal(board.hasTies, true);
  });

  await test('formats run times from primary_t seconds', async () => {
    mockFetch(srMocks());
    const sr = await fetchSpeedruns();
    const board = Object.values(sr.boards)[0];
    assert.equal(board.runs[0].time, '5:50.500');
    assert.equal(board.runs[1].time, '6:01');
  });

  await test('carries the CC-BY-NC attribution requirement in the payload', async () => {
    mockFetch(srMocks());
    const sr = await fetchSpeedruns();
    assert.match(sr.licence, /CC-BY-NC/);
    assert.ok(Object.values(sr.boards)[0].boardWeblink, 'lost the attribution link');
  });

  await test('REGRESSION: a failed resolve is not cached as permanently missing', async () => {
    const { readHistory } = await import('../lib/history.mjs');
    // Search endpoint down; leaderboards would work if a game resolved.
    mockFetch([
      ['speedrun.com/api/v1/games?name=', null],
      ['/categories', F.srCategories],
      ['speedrun.com/api/v1/leaderboards', F.srLeaderboard],
    ]);
    await fetchSpeedruns();
    const h = await readHistory();
    const cached = Object.values(h.srcGames ?? {});
    // A transient failure must leave NOTHING behind, or the game is
    // blacklisted forever and no later run ever retries it.
    assert.ok(
      !cached.some((v) => v && v.none === true),
      'a transient failure was cached as {none:true}, permanently disabling that game'
    );
  });

  await test('returns null when speedrun.com is unreachable', async () => {
    mockFetch([['speedrun.com', null]]);
    const sr = await fetchSpeedruns();
    assert.equal(sr, null);
  });
}

/* ---------- text utilities ---------- */
section('Text utilities');
{
  const { toPlainText, slugify } = await import('../lib/http.mjs');

  await test('toPlainText strips HTML, BBCode and entities', () => {
    const out = toPlainText('<p>Hello &amp; [b]welcome[/b] &mdash; it&#39;s here</p>');
    assert.ok(!out.includes('<'), out);
    assert.ok(!out.includes('['), out);
    assert.ok(out.includes('&'), out);
    assert.ok(out.includes("it's"), out);
  });

  await test('toPlainText truncates on a word boundary', () => {
    const out = toPlainText('word '.repeat(200), 50);
    assert.ok(out.length <= 52, `length was ${out.length}`);
    assert.ok(out.endsWith('…'));
  });

  await test('slugify handles Korean and punctuation', () => {
    assert.equal(slugify('Switch 2 Price Increase!'), 'switch-2-price-increase');
    assert.equal(slugify('스위치2 가격 인상'), '스위치2-가격-인상');
  });
}

restoreFetch();

/* ---------- summary ---------- */
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  ${passed} passed, ${failed} failed`);
if (unmatched.length) {
  console.log(`  (${unmatched.length} unmatched fetch calls fell through to 404 — expected for unused sources)`);
}
if (failed) {
  console.log('\nFailures:\n');
  for (const f of failures) {
    console.log(`  ✗ ${f.name}`);
    console.log(`    ${f.err.stack?.split('\n').slice(0, 4).join('\n    ')}\n`);
  }
  process.exit(1);
}
console.log('  All pipeline tests passed.\n');
