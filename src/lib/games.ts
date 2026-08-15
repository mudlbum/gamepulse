import lbData from '../data/leaderboard.json';
import srData from '../data/speedruns.json';
import upData from '../data/updates.json';
import clipData from '../data/clips.json';
import mobileData from '../data/mobile.json';
import newsData from '../data/news.json';

/**
 * Builds the index of games that get their own page.
 *
 * A game earns a page if we hold something real about it: live Steam numbers,
 * a speedrun ladder, App Store metrics, or tracked patch notes. Pages that end
 * up sparse anyway are flagged `thin` and kept out of the index — see the
 * comment on the filter below.
 */

export function gameSlug(name: string): string {
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
}

export interface GameEntry {
  slug: string;
  name: string;
  steam: any | null;
  speedrun: any | null;
  patches: any | null;
  /** Per-storefront App Store data, keyed by country code. */
  mobile: Record<string, any> | null;
  clips: any[];
  /** News clusters whose headline or summary names this game. */
  news: any[];
  /** Other published games sharing a genre or platform — internal linking. */
  related: GameEntry[];
  platforms: string[];
  /** True when no public per-player ranking exists for this game anywhere. */
  noRanking: boolean;
  /** Too sparse to deserve indexing — reachable, but noindex and out of the sitemap. */
  thin: boolean;
}

export function buildGameIndex(): GameEntry[] {
  const lb: any = lbData;
  const sr: any = srData;
  const up: any = upData;
  const clips: any = clipData;
  const mob: any = mobileData;
  const news: any = newsData;

  const bySlug = new Map<string, GameEntry>();

  const ensure = (name: string): GameEntry => {
    const slug = gameSlug(name);
    if (!bySlug.has(slug)) {
      bySlug.set(slug, {
        slug,
        name,
        steam: null,
        speedrun: null,
        patches: null,
        mobile: null,
        clips: [],
        news: [],
        related: [],
        platforms: [],
        noRanking: true,
        thin: false,
      });
    }
    return bySlug.get(slug)!;
  };

  // Steam concurrents — skip placeholder names from apps whose metadata has
  // not resolved yet ("App 394360"); they'd make meaningless pages.
  for (const e of lb.entries ?? []) {
    if (/^App \d+$/.test(e.name)) continue;
    const g = ensure(e.name);
    g.steam = e;
    if (!g.platforms.includes('pc')) g.platforms.push('pc');
  }

  for (const [, board] of Object.entries<any>(sr.boards ?? {})) {
    const g = ensure(board.gameName ?? board.game);
    g.speedrun = board;
    g.noRanking = false;
  }

  for (const game of up.games ?? []) {
    const g = ensure(game.game);
    g.patches = game;
    for (const p of game.platforms ?? []) if (!g.platforms.includes(p)) g.platforms.push(p);
  }

  /* Mobile. A game can appear in several storefronts under different localised
     titles ("Blue Archive" vs "블루 아카이브"), so entries are merged on the
     App Store track id rather than on the name, and the US title — or the first
     one seen — becomes the canonical page name. */
  const byAppId = new Map<string, GameEntry>();
  for (const chart of Object.values<any>(mob.charts ?? {})) {
    for (const e of chart.entries ?? []) {
      let g = byAppId.get(e.appId);
      if (!g) {
        g = ensure(e.name);
        byAppId.set(e.appId, g);
      }
      g.mobile ??= {};
      g.mobile[chart.cc] = { ...e, storeLabel: chart.label, storeLabelKo: chart.labelKo };
      if (!g.platforms.includes('mobile')) g.platforms.push('mobile');
    }
  }

  /* Attach clips and news that name the game.
     `needle` deliberately cuts at the first colon and requires four characters:
     "Tom Clancy's Rainbow Six Siege" matches on the full string almost never,
     while a two-letter needle would match half the internet. */
  const allClips = [...(clips.trending ?? []), ...(clips.breakout ?? [])];
  const allClusters = [
    ...((news.feeds?.en?.clusters ?? []) as any[]),
    ...((news.feeds?.en?.latest ?? []) as any[]),
  ];

  for (const g of bySlug.values()) {
    const needle = g.name.toLowerCase().split(':')[0].trim();
    if (needle.length < 4) continue;
    g.clips = allClips.filter((c: any) => (c.title ?? '').toLowerCase().includes(needle)).slice(0, 3);
    g.news = allClusters
      .filter((c: any) => `${c.headline ?? c.title ?? ''} ${c.summary ?? ''}`.toLowerCase().includes(needle))
      .slice(0, 4);
  }

  /* Every game we hold anything about gets a page — a reader looking for
     League of Legends should find it. But a page carrying a version number and
     nothing else should not be in Google's index: ~60 of those is what gets a
     site classified as thin content. So sparse pages are marked `thin`, which
     makes them noindex and drops them from the sitemap while leaving them
     reachable. The flag is recomputed every build, so a page becomes indexable
     by itself the moment real material arrives for it. */
  const published = [...bySlug.values()].filter((g) => g.steam || g.speedrun || g.patches || g.mobile);
  for (const g of published) g.thin = substanceOf(g) < 3;

  /* Related games, computed after the filter so nothing links to a page that
     was never built. Shared genre first, then shared platform. */
  for (const g of published) {
    const genres: string[] = g.steam?.genres ?? [];
    const score = (o: GameEntry) => {
      if (o.slug === g.slug) return -1;
      const og: string[] = o.steam?.genres ?? [];
      const sharedGenre = genres.filter((x) => og.includes(x)).length;
      const sharedPlatform = g.platforms.filter((p) => o.platforms.includes(p)).length;
      return sharedGenre * 10 + sharedPlatform;
    };
    g.related = published
      .map((o) => ({ o, s: score(o) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || (b.o.steam?.current ?? 0) - (a.o.steam?.current ?? 0))
      .slice(0, 6)
      .map((x) => x.o);
  }

  return published.sort((a, b) => (b.steam?.current ?? 0) - (a.steam?.current ?? 0));
}

/**
 * How much verifiable material a game page would actually carry.
 *
 * Each point is one real section a reader gets. The threshold of 3 was chosen
 * against the live data: it keeps every game with live numbers, every game with
 * a runner ladder, every mobile title, and the Riot/Blizzard games that have a
 * patch feed plus clips or coverage — and drops the handful that would render
 * as a title, a platform badge and nothing else.
 */
export function substanceOf(g: GameEntry): number {
  let n = 0;
  if (g.steam) n += 2; // live count, peak, 24h change, 8-day chart
  if (g.steam?.spark?.length > 2) n += 1;
  if (g.speedrun?.runs?.length) n += 2; // a full ranked table
  if (g.mobile && Object.keys(g.mobile).length) n += 2; // per-storefront metrics
  if (Object.values<any>(g.mobile ?? {}).some((m: any) => m.releaseNotes)) n += 1;
  if (g.patches?.entries?.length) n += Math.min(2, g.patches.entries.length);
  if (g.clips.length) n += 1;
  if (g.news.length) n += 1;
  return n;
}

/**
 * Games grouped for the index page.
 *
 * A game lands in every group it belongs to, because Genshin Impact really is
 * both a mobile and a PC game and picking one would make the other list wrong.
 * Sorted by whatever hard number that group has: concurrents for PC, ratings
 * volume for mobile, recency for everything else.
 */
export function groupGames(games: GameEntry[]) {
  const mobileWeight = (g: GameEntry) =>
    Math.max(0, ...Object.values<any>(g.mobile ?? {}).map((m: any) => m.ratings ?? 0));
  const lastPatch = (g: GameEntry) => {
    const d = g.patches?.entries?.[0]?.date;
    return d ? Date.parse(d) || 0 : 0;
  };

  const pc = games.filter((g) => g.steam).sort((a, b) => (b.steam.current ?? 0) - (a.steam.current ?? 0));
  const mobile = games.filter((g) => g.mobile).sort((a, b) => mobileWeight(b) - mobileWeight(a));
  // Everything with a page but no live number of its own — the Riot and
  // Blizzard titles, mostly. Without this group they exist but are unreachable.
  const other = games
    .filter((g) => !g.steam && !g.mobile)
    .sort((a, b) => lastPatch(b) - lastPatch(a));

  return { pc, mobile, other };
}

/** Why a given game has no player ranking — shown verbatim on the page. */
export function noRankingReason(name: string, lang: 'en' | 'ko', mobileOnly = false): string {
  const n = name.toLowerCase();
  const riot = n.includes('league') || n.includes('valorant');
  const blizzard = n.includes('overwatch') || n.includes('warcraft');

  if (mobileOnly && !riot && !blizzard) {
    return lang === 'ko'
      ? '모바일 게임의 플레이어 순위를 공개하는 무료 API는 없습니다. 애플은 플레이어 수를 공개하지 않고, Google Play는 공개 API 자체가 없습니다. 게임 내 랭킹은 앱 안에서만 확인할 수 있어, 위의 App Store 지표를 대신 싣습니다.'
      : 'No free API publishes a player ranking for mobile games. Apple releases no player numbers and Google Play has no public API at all, while in-game ladders live only inside the app. The App Store metrics above are what can be verified.';
  }

  if (lang === 'ko') {
    if (riot)
      return '라이엇은 랭킹 사다리 데이터를 API 키 없이 공개하지 않습니다. 개발자 키는 24시간마다 만료되어 자동화에 쓸 수 없고, e스포츠 API는 라이엇 웹 클라이언트에 내장된 비공개 키를 필요로 합니다. 그래서 이 게임의 플레이어 순위는 싣지 않습니다.';
    if (blizzard)
      return '블리자드는 공개 랭킹 API를 제공하지 않습니다. 공식 순위는 게임 클라이언트 안에서만 확인할 수 있습니다.';
    return '이 게임의 플레이어 순위를 공개하는 무료 공개 API가 없습니다. 확인되지 않은 수치를 만들어내기보다 없다고 밝히는 편을 택했습니다.';
  }
  if (riot)
    return 'Riot does not publish ranked-ladder data without an API key. Development keys expire every 24 hours, which rules them out for an automated site, and the esports endpoint only works with a private key embedded in Riot’s own web client. So we do not carry a player ranking for this game.';
  if (blizzard)
    return 'Blizzard publishes no public ranking API. Official standings are visible only inside the game client.';
  return 'No free public API publishes a player ranking for this game. We would rather say so than invent a number.';
}

/**
 * Slugs that must stay out of the sitemap, for astro.config.mjs.
 *
 * Derived from the same index the pages are built from rather than
 * reimplemented, because a sitemap that disagrees with the pages' own robots
 * meta produces "Submitted URL marked noindex" all over Search Console.
 */
export function thinGameSlugs(): Set<string> {
  return new Set(buildGameIndex().filter((g) => g.thin).map((g) => g.slug));
}
