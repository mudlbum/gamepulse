/**
 * Mobile charts — the closest thing to a mobile "leaderboard" that exists
 * without a key.
 *
 * Apple's marketing RSS is official, keyless, needs no User-Agent and covers
 * every storefront including Korea. Google Play has no official public API of
 * any kind; every "Play top charts API" is a paid third-party scraper, so
 * Android is simply absent and the page says so.
 *
 * Two verified traps:
 *  - There is NO games-only endpoint. `/games.json` and `/explicit.json` 404,
 *    and `?genre=6014` is SILENTLY IGNORED — it returns the general app chart
 *    with a 200. Filtering has to happen client-side via the iTunes Lookup API.
 *  - There is no `rank` field. Rank is array position, nothing else. The
 *    `genres` array is present on every entry and always empty.
 */
import { getJson, log, warn } from './lib/http.mjs';
import { ENDPOINTS } from './lib/sources.mjs';

const STOREFRONTS = [
  { cc: 'us', label: 'United States' },
  { cc: 'kr', label: '대한민국' },
];
const FETCH_LIMIT = 50; // generator supports 10 / 25 / 50 only
const KEEP = 15;

export async function fetchMobile() {
  const scope = 'mobile';
  const charts = {};

  for (const store of STOREFRONTS) {
    const lists = {};
    for (const kind of ['top-free', 'top-paid', 'top-grossing']) {
      const games = await chartFor(store.cc, kind, scope);
      if (games?.length) lists[kind] = games;
    }
    if (Object.keys(lists).length) {
      charts[store.cc] = { label: store.label, ...lists };
    }
  }

  if (!Object.keys(charts).length) {
    warn(scope, 'no mobile charts retrieved');
    return null;
  }

  const total = Object.values(charts).reduce(
    (s, c) => s + (c['top-free']?.length ?? 0) + (c['top-grossing']?.length ?? 0),
    0
  );
  log(scope, `${Object.keys(charts).length} storefronts, ${total} ranked games`);

  return {
    updated: new Date().toISOString(),
    source: 'Apple App Store marketing RSS (public, no key)',
    note: 'Store chart position, NOT a player count. Apple publishes no player numbers, and Google Play has no public API at all — Android is not covered.',
    androidAvailable: false,
    charts,
  };
}

async function chartFor(cc, kind, scope) {
  const json = await getJson(ENDPOINTS.appleChart(cc, kind, FETCH_LIMIT), { scope, retries: 2 });
  const results = json?.feed?.results;
  if (!Array.isArray(results) || !results.length) return null;

  /* The chart itself cannot be filtered to games, and every entry's `genres`
     array comes back empty, so genre has to be resolved separately. Lookup
     accepts up to 200 comma-separated ids in ONE request. */
  const ids = results.map((r) => r.id).filter(Boolean);
  const genreById = await lookupGenres(ids, cc, scope);

  // If the lookup failed we cannot tell games from banking apps. Returning
  // nothing is correct — a "top games" list containing a coffee app is worse
  // than an absent section.
  if (!genreById) {
    warn(scope, `genre lookup failed for ${cc}/${kind} — skipping rather than showing unfiltered apps`);
    return null;
  }

  return results
    .filter((r) => genreById.get(String(r.id)) === 'Games')
    .slice(0, KEEP)
    .map((r, i) => ({
      rank: i + 1, // no rank field exists in the payload; position is the rank
      name: r.name,
      artist: r.artistName,
      url: r.url,
      artwork: (r.artworkUrl100 || '').replace('100x100bb', '256x256bb'),
      releaseDate: r.releaseDate ?? null,
      appId: r.id,
    }));
}

/**
 * Resolve genres for a batch of app ids.
 *
 * Chunked at 20 rather than sent as one 50-id URL: Apple's lookup caps results
 * server-side and long id lists come back partially filled with no error, which
 * would quietly drop real games from the chart. Chunking also means one bad
 * batch costs 20 entries instead of the whole storefront.
 *
 * Returns null — meaning "do not render this chart" — unless most ids resolved.
 * A partial map would silently filter out games we simply failed to identify.
 */
async function lookupGenres(ids, cc, scope) {
  if (!ids.length) return new Map();
  const CHUNK = 20;
  const map = new Map();

  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    const json = await getJson(ENDPOINTS.itunesLookup(batch, cc), { scope, retries: 2 });
    for (const r of json?.results ?? []) {
      if (r?.trackId) map.set(String(r.trackId), r.primaryGenreName ?? null);
    }
    await new Promise((r) => setTimeout(r, 250)); // Apple throttles bursts
  }

  const coverage = map.size / ids.length;
  if (coverage < 0.6) {
    warn(scope, `genre lookup resolved only ${map.size}/${ids.length} ids (${Math.round(coverage * 100)}%) for ${cc} — not enough to filter reliably`);
    return null;
  }
  return map;
}
