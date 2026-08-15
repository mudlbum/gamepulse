#!/usr/bin/env node
/**
 * Writes fixture-derived JSON into public/data and src/data so the site can be
 * built and previewed with zero network access.
 *
 * Production never uses this: the deploy workflow runs `npm run data` against
 * the live sources before building. This exists so `npm run dev` works on a
 * plane, and so a first-time clone can `npm run build` immediately.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as F from './fixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIRS = [resolve(ROOT, 'public/data'), resolve(ROOT, 'src/data')];

const { YOUTUBE_CHANNELS: CHANNELS } = await import('../lib/sources.mjs');

const CLIP_TITLES = [
  'INSANE 1v5 clutch to win the Major',
  'Every change in the new patch, explained',
  'This Helldivers 2 stratagem should not be legal',
  'The play that ended The International group stage',
  'Genshin 7.0 Snezhnaya — first two hours',
  'Why nobody is talking about this Palworld build',
  'Switch 2 price rise: what it actually means',
  'Ranked but I only use the worst weapon',
  'The 40K crossover is better than it had any right to be',
  'Every Gamescom announcement in 8 minutes',
  'This 1-tap ended the series',
  'I tested every new Apex attachment',
];

// Keep fixture state out of production's history file entirely.
process.env.GP_HISTORY_PATH = resolve(ROOT, '.seed-history.json');

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
  const xml = (v) => new Response(v, { status: 200, headers: { 'content-type': 'application/xml' } });

  if (u.includes('GetGamesByConcurrentPlayers')) return json(F.steamConcurrent);
  if (u.includes('GetMostPlayedGames')) return json(F.steamChart);
  if (u.includes('appdetails')) return json(F.steamAppDetails(new URL(u).searchParams.get('appids')));
  if (u.includes('GetNumberOfCurrentPlayers')) return json({ response: { player_count: 50000, result: 1 } });
  if (u.includes('GetNewsForApp')) return json(F.steamNews(new URL(u).searchParams.get('appid')));
  if (u.includes('ddragon.leagueoflegends.com')) return json(F.ddragonVersions);
  if (u.includes('valorant-api.com')) return json(F.valorantVersion);
  if (u.includes('youtube.com/feeds')) {
    const id = new URL(u).searchParams.get('channel_id');
    const ch = CHANNELS.find((c) => c.id === id);
    const name = ch?.name ?? `Channel ${id.slice(-4)}`;
    // Deterministic per-channel titles — no Math.random, so seeds are stable.
    const i = CHANNELS.findIndex((c) => c.id === id);
    const rot = (n) => CLIP_TITLES[(Math.max(0, i) + n) % CLIP_TITLES.length];
    return xml(F.youtubeFeed(id, name, [rot(0), rot(1), rot(2)]));
  }
  if (u.includes('getAuthorFeed')) {
    const actor = decodeURIComponent(new URL(u).searchParams.get('actor'));
    const handle = actor.startsWith('did:') ? 'sample.bsky.social' : actor;
    return json(F.bskyAuthorFeed(handle, handle.split('.')[0]));
  }
  if (u.includes('itunes.apple.com/search'))
    return json(F.itunesSearch(new URL(u).searchParams.get('term'), new URL(u).searchParams.get('country')));
  if (u.includes('itunes.apple.com/lookup'))
    return json(F.itunesLookup(new URL(u).searchParams.get('id'), new URL(u).searchParams.get('country')));
  if (u.includes('speedrun.com/api/v1/games?name=')) return json(F.srGameSearch(new URL(u).searchParams.get('name')));
  if (u.includes('/categories')) return json(F.srCategories);
  if (u.includes('speedrun.com/api/v1/leaderboards')) return json(F.srLeaderboard);
  if (u.includes('freeGamesPromotions')) return json(F.epicFree);
  if (u.includes('cheapshark.com/api/1.0/deals')) return json(F.cheapSharkDeals);
  if (u.includes('cheapshark.com/api/1.0/stores')) return json(F.cheapSharkStores);

  /* News feeds. Each outlet gets its OWN phrasing of the same stories, the way
     real feeds do — identical strings would make the clustering preview
     meaningless and would not exercise the similarity scoring at all. */
  const EN_VARIANTS = {
    IGN: [
      'Nintendo confirms Switch 2 price rise to $500 from September 1',
      'Gamescom 2026 Opening Night Live: every game announced',
      'Helldivers 2 raises the level cap to 300 in Devoid of Liberty',
      'Genshin Impact 7.0 finally opens Snezhnaya',
      'The International 2026: Team Spirit stay perfect through day 2',
    ],
    'PC Gamer': [
      'Switch 2 is getting $50 more expensive on September 1',
      'Everything shown at Gamescom Opening Night Live 2026',
      'Helldivers 2 doubles its level cap and adds a Warhammer 40K Warbond',
      'Snezhnaya is here at last in Genshin Impact version 7.0',
      'Yatoro ties the all-time TI kill record on Kez',
    ],
    Kotaku: [
      'Nintendo raising Switch 2 price to $500 next month',
      'Gamescom Opening Night Live 2026: the full roundup',
      'Helldivers 2 level cap now 300 after Devoid of Liberty update',
      'Genshin Impact reaches Snezhnaya and skips a whole version',
      'Team Vision and Team Spirit go undefeated at The International',
    ],
  };
  const KO_VARIANTS = {
    '인벤': [
      '닌텐도, 스위치2 가격 9월 1일부터 50달러 인상',
      '게임스컴 2026 오프닝 나이트 라이브 공개 라인업 정리',
      '헬다이버스 2, 레벨 상한 300으로 두 배 상향',
      '원신 7.0 스네즈나야 업데이트 출시',
      '디 인터내셔널 2026 그룹 스테이지 중간 순위',
    ],
    '루리웹': [
      '스위치2 가격 인상 공식 발표, 9월 1일부터 적용',
      '게임스컴 오프닝 나이트 라이브 2026 총정리',
      '헬다이버스 2 레벨 상한 300 상향, 워해머 40K 콜라보',
      '원신 버전 7.0, 스네즈나야 지역 공개',
      'TI 2026 그룹 스테이지 팀 스피릿 전승',
    ],
    '게임메카': [
      '닌텐도 스위치2 가격 인상, 다음 달부터 500달러',
      '게임스컴 2026 ONL 발표 게임 목록',
      '헬다이버스 2 자유의 공백 업데이트, 상한 300',
      '원신 스네즈나야 마침내 공개, 7.0 업데이트',
      '디 인터내셔널 2026 2일 차 결과',
    ],
  };
  const pick = (map, key) => xml(F.rssFeed({ title: key, headlines: map[key], count: 5 }));

  if (u.includes('feedburner.com/ign')) return pick(EN_VARIANTS, 'IGN');
  if (u.includes('pcgamer')) return pick(EN_VARIANTS, 'PC Gamer');
  if (u.includes('kotaku')) return pick(EN_VARIANTS, 'Kotaku');
  if (u.includes('inven')) return pick(KO_VARIANTS, '인벤');
  if (u.includes('ruliweb')) return pick(KO_VARIANTS, '루리웹');
  if (u.includes('gamemeca')) return pick(KO_VARIANTS, '게임메카');
  if (u.includes('pathofexile.com') || u.includes('bungie.net') || u.includes('forums.blizzard.com')) {
    return xml(F.rssFeed({
      title: u.includes('pathofexile') ? 'Path of Exile' : u.includes('bungie') ? 'Bungie' : 'Blizzard Forums',
      headlines: ['Patch 0.5.5 notes', 'Update 1.1.5.3', 'Overwatch Retail Patch Notes – August 11, 2026'],
      count: 3,
    }));
  }
  return new Response('not found', { status: 404 });
};

const { fetchLeaderboard } = await import('../fetch-leaderboard.mjs');
const { fetchUpdates } = await import('../fetch-updates.mjs');
const { fetchClips } = await import('../fetch-clips.mjs');
const { fetchCosplay } = await import('../fetch-cosplay.mjs');
const { fetchDeals } = await import('../fetch-deals.mjs');
const { fetchNews } = await import('../fetch-news.mjs');
const { fetchMobile } = await import('../fetch-mobile.mjs');
const { fetchSpeedruns } = await import('../fetch-speedruns.mjs');

/* Run the leaderboard several times with the clock rolled back so the seeded
   preview has a real history curve — sparklines and 24h deltas are a core part
   of the page and a single sample renders them as em-dashes. */
const { readHistory, writeHistory } = await import('../lib/history.mjs');
for (let step = 6; step >= 1; step--) {
  await fetchLeaderboard();
  const h = await readHistory();
  for (const pts of Object.values(h.series)) {
    const last = pts[pts.length - 1];
    if (!last) continue;
    last.t -= step * 7 * 3600_000;
    // Deterministic wobble so the curve is not a flat line.
    last.v = Math.round(last.v * (1 + Math.sin(step * 1.7) * 0.11 - step * 0.012));
  }
  await writeHistory(h);
}

const datasets = {
  leaderboard: await fetchLeaderboard(),
  updates: await fetchUpdates(),
  clips: await fetchClips(),
  deals: await fetchDeals(),
  cosplay: await fetchCosplay(),
  news: await fetchNews(),
  mobile: await fetchMobile(),
  speedruns: await fetchSpeedruns(),
};

for (const dir of DIRS) await mkdir(dir, { recursive: true });

for (const [name, data] of Object.entries(datasets)) {
  const payload = { ...(data ?? { updated: null }), _stale: false, _sample: true };
  for (const dir of DIRS) {
    await writeFile(resolve(dir, `${name}.json`), JSON.stringify(payload), 'utf8');
  }
  console.log(`  seeded ${name}.json`);
}

const health = {
  updated: new Date().toISOString(),
  _sample: true,
  tasks: Object.keys(datasets).map((t) => ({ task: t, status: 'ok', detail: 'seed fixture', ms: 0 })),
  ok: Object.keys(datasets).length,
  total: Object.keys(datasets).length,
};
for (const dir of DIRS) await writeFile(resolve(dir, 'health.json'), JSON.stringify(health), 'utf8');

globalThis.fetch = realFetch;


console.log('\nSeed data written. Run `npm run data` to replace it with live data.\n');
