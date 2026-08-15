import lbData from '../data/leaderboard.json';
import srData from '../data/speedruns.json';
import upData from '../data/updates.json';
import clipData from '../data/clips.json';

/**
 * Builds the index of games that get their own page.
 *
 * A game earns a page if we hold something real about it: live Steam numbers,
 * a speedrun ladder, or tracked patch notes. Games we know nothing about do not
 * get a stub — thin pages help nobody and hurt an AdSense review.
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
  clips: any[];
  platforms: string[];
  /** True when no public per-player ranking exists for this game anywhere. */
  noRanking: boolean;
}

export function buildGameIndex(): GameEntry[] {
  const lb: any = lbData;
  const sr: any = srData;
  const up: any = upData;
  const clips: any = clipData;

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
        clips: [],
        platforms: [],
        noRanking: true,
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

  // Attach clips whose title or channel names the game.
  const allClips = [...(clips.trending ?? []), ...(clips.breakout ?? [])];
  for (const g of bySlug.values()) {
    const needle = g.name.toLowerCase().split(':')[0].trim();
    if (needle.length < 4) continue;
    g.clips = allClips.filter((c: any) => (c.title ?? '').toLowerCase().includes(needle)).slice(0, 3);
  }

  return [...bySlug.values()]
    .filter((g) => g.steam || g.speedrun || g.patches)
    .sort((a, b) => (b.steam?.current ?? 0) - (a.steam?.current ?? 0));
}

/** Why a given game has no player ranking — shown verbatim on the page. */
export function noRankingReason(name: string, lang: 'en' | 'ko'): string {
  const n = name.toLowerCase();
  const riot = n.includes('league') || n.includes('valorant');
  const blizzard = n.includes('overwatch') || n.includes('warcraft');

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
