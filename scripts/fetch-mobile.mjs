/**
 * Mobile games — per-storefront ranking, version history and patch notes.
 *
 * Read the long comment above MOBILE_GAMES in lib/sources.mjs before changing
 * anything here. Short version: Apple's marketing-RSS chart cannot be used
 * because its "Apps" chart excludes games by construction, so this builds a
 * board from iTunes Lookup over a named roster instead.
 *
 * WHAT THE NUMBERS MEAN — and the honesty rules that go with them:
 *  - `ratings` is the lifetime App Store rating count in that storefront. It is
 *    a popularity proxy. It is NOT a player count and must never be labelled as
 *    one. Apple publishes no player numbers for anyone.
 *  - `ratingsPerWeek` is the delta between now and the oldest sample we hold,
 *    normalised to 7 days. THIS is the live signal: it measures people rating
 *    the game this week, not people who rated it in 2019. It is null until we
 *    have two samples at least a day apart, and the UI must render that as "—"
 *    rather than 0.
 *  - Rank is our own ordering of our own roster. It is not an Apple chart
 *    position and the page says so.
 *
 * Android is absent. Google Play has no public API and every "Play top charts
 * API" is a paid third-party scraper.
 */
import { getJson, log, warn, toPlainText } from './lib/http.mjs';
import { ENDPOINTS, MOBILE_GAMES, MOBILE_STOREFRONTS } from './lib/sources.mjs';
import { readHistory, writeHistory } from './lib/history.mjs';

const KEEP = 20;
/* Only a handful of new titles are resolved per run so a roster edit spreads
   its search traffic over a few refreshes instead of arriving as one burst.
   Both knobs are env-overridable purely so the offline test suite can resolve
   the whole roster instantly instead of sleeping through it. */
const RESOLVE_PER_RUN = Number(process.env.GP_MOBILE_RESOLVE_LIMIT || 10);
/* Apple's Search API is documented at roughly 20 calls per minute and answers
   403 rather than 429 when you exceed it, which the retry logic reads as fatal.
   3 seconds between searches keeps a worst-case run (two storefront passes for
   every one of the ten names) just inside that. A full roster therefore takes a
   few refresh cycles to resolve, which is fine — ids are cached forever after. */
const PACE_MS = process.env.GP_PACE_MS != null ? Number(process.env.GP_PACE_MS) : 3000;
/* Rating counts move slowly, so sampling every 30 minutes would add ~4,000
   near-identical points a day to a file that is committed to git. One sample
   per 6 hours is plenty to compute a weekly delta. */
const SAMPLE_GAP_MS = 6 * 3600_000;
const WEEK_MS = 7 * 24 * 3600_000;
const DAY_MS = 24 * 3600_000;

export async function fetchMobile() {
  const scope = 'mobile';
  const history = await readHistory();
  history.mobileApps ??= {}; // name -> { id, name } | { none: true }

  await resolveNewGames(history, scope);

  const ids = [...new Set(
    Object.values(history.mobileApps)
      .filter((v) => v && !v.none && v.id)
      .map((v) => String(v.id))
  )];

  if (!ids.length) {
    warn(scope, 'no app ids resolved yet');
    return null;
  }

  const now = Date.now();
  const charts = {};

  for (const store of MOBILE_STOREFRONTS) {
    const apps = await lookupApps(ids, store.cc, scope);
    /* A null here means the lookup itself failed. An empty array would mean
       "this storefront genuinely carries none of these games", which cannot
       happen for a 40-game roster — so treat both as a failure of the
       storefront rather than writing an empty board over a good one. */
    if (!apps?.length) {
      warn(scope, `lookup returned nothing for ${store.cc} — skipping this storefront`);
      continue;
    }

    const entries = apps
      .filter((a) => a.ratings > 0)
      .sort((a, b) => b.ratings - a.ratings)
      .slice(0, KEEP)
      .map((a, i) => {
        const key = `m:${store.cc}:${a.appId}`;
        return { rank: i + 1, ...a, ratingsPerWeek: weeklyDelta(history, key, a.ratings, now) };
      });

    if (!entries.length) continue;

    // Sample AFTER computing the delta, or every game reads as zero growth.
    for (const e of entries) sample(history, `m:${store.cc}:${e.appId}`, e.ratings, now);

    charts[store.cc] = { cc: store.cc, label: store.label, labelKo: store.labelKo, entries };
  }

  if (!Object.keys(charts).length) {
    warn(scope, 'no storefront produced a board');
    return null;
  }

  await writeHistory(history);

  const total = Object.values(charts).reduce((s, c) => s + c.entries.length, 0);
  log(scope, `${Object.keys(charts).length} storefronts, ${total} ranked games`);

  return {
    updated: new Date().toISOString(),
    source: 'Apple iTunes Lookup API (public, no key)',
    metric: 'ratings',
    note:
      'Ranked by lifetime App Store rating count in each storefront. That is a popularity proxy, NOT a player count — Apple publishes no player numbers. "New ratings/week" is the live signal.',
    androidAvailable: false,
    androidNote:
      'Google Play publishes no public API for chart positions or install counts, so Android is not covered here.',
    charts,
  };
}

/* ------------------------------------------------------------------ *
 * Name -> trackId. Resolved once and cached in the committed history
 * file, exactly like the speedrun.com game ids.
 * ------------------------------------------------------------------ */
async function resolveNewGames(history, scope) {
  const unresolved = MOBILE_GAMES.filter((n) => history.mobileApps[n] == null);
  if (!unresolved.length) return;

  const batch = unresolved.slice(0, RESOLVE_PER_RUN);
  log(scope, `resolving ${batch.length} of ${unresolved.length} new title(s)`);

  for (const name of batch) {
    const found = await searchApp(name, scope);
    /* null means the request failed — leave it unresolved so the next run
       retries. Caching a transient failure would blacklist a real game. */
    if (found) history.mobileApps[name] = found;
    await sleep(PACE_MS);
  }
  await writeHistory(history);
}

async function searchApp(name, scope) {
  /* App ids are global, so one search against the US storefront serves every
     storefront. Korean-market titles that never shipped in the US need the
     second pass. */
  for (const cc of ['us', 'kr']) {
    const json = await getJson(ENDPOINTS.itunesSearch(name, cc), { scope, retries: 1 });
    if (json === null) return null; // request failed — retry next run
    const hit = pickBest(name, json.results ?? []);
    if (hit) return { id: hit.trackId, name: hit.trackName, resolvedIn: cc };
    await sleep(PACE_MS * 0.75);
  }
  log(scope, `no App Store match for "${name}" — will not ask again`);
  return { none: true };
}

/**
 * Search is fuzzy and ranks by relevance, not by title match, so results[0] is
 * routinely a clone or a guide app ("Guide for Genshin Impact"). Require a real
 * name relationship AND the Games genre.
 */
function pickBest(want, results) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
  const w = norm(want);
  const games = results.filter(
    (r) => r?.trackId && (r.primaryGenreName === 'Games' || (r.genres ?? []).includes('Games'))
  );

  const exact = games.find((r) => norm(r.trackName) === w);
  if (exact) return exact;

  /* Prefix, not substring: "Guide for X" contains "x" and would otherwise win.
     Also accept the reverse (store title longer than our shorthand, e.g.
     "NIKKE" -> "GODDESS OF VICTORY: NIKKE"). */
  const prefix = games.find((r) => norm(r.trackName).startsWith(w) || w.startsWith(norm(r.trackName)));
  if (prefix) return prefix;

  /* A non-English storefront returns the LOCALISED title, which can share no
     characters at all with the name we searched for — the Korean store answers
     "Lineage W" with "리니지W". The bundle id is the developer's own identifier
     and stays romanised in every storefront (com.ncsoft.lineagew), so it is the
     only reliable bridge. Guarded on length because a three-letter name would
     collide with half the store. */
  if (w.length >= 4) {
    const byBundle = games.find((r) => norm(r.bundleId).includes(w));
    if (byBundle) return byBundle;
  }

  const contains = games.find((r) => norm(r.trackName).includes(w));
  return contains ?? null;
}

/* ------------------------------------------------------------------ *
 * Bulk lookup for one storefront.
 * ------------------------------------------------------------------ */
async function lookupApps(ids, cc, scope) {
  const CHUNK = 20; // long id lists come back partially filled with no error
  const out = [];
  let requested = 0;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    requested += batch.length;
    const json = await getJson(ENDPOINTS.itunesLookup(batch, cc), { scope, retries: 2 });
    if (json === null) return null; // one dead chunk invalidates the ranking
    for (const r of json.results ?? []) {
      if (!r?.trackId) continue;
      out.push(shape(r));
    }
    await sleep(PACE_MS * 0.6); // Apple throttles bursts
  }

  /* Missing entries are normal — plenty of these games never shipped in the US
     or never shipped in Korea. Only an implausibly small return means the
     lookup itself is misbehaving. */
  if (out.length < requested * 0.25) {
    warn(scope, `only ${out.length}/${requested} ids returned for ${cc} — treating as a failed lookup`);
    return null;
  }
  return out;
}

function shape(r) {
  return {
    appId: String(r.trackId),
    name: r.trackName,
    artist: r.artistName ?? null,
    url: r.trackViewUrl ?? null,
    artwork: (r.artworkUrl512 || r.artworkUrl100 || '').replace('100x100bb', '256x256bb') || null,
    ratings: Number(r.userRatingCount ?? 0),
    rating: r.averageUserRating != null ? Math.round(Number(r.averageUserRating) * 10) / 10 : null,
    version: r.version ?? null,
    versionDate: r.currentVersionReleaseDate ?? null,
    // Release notes are the closest thing mobile has to patch notes.
    releaseNotes: toPlainText(r.releaseNotes ?? '', 320) || null,
    price: r.formattedPrice ?? null,
    free: Number(r.price ?? 0) === 0,
    genre: r.primaryGenreName ?? null,
    releaseDate: r.releaseDate ?? null,
    contentRating: r.contentAdvisoryRating ?? null,
    screenshots: (r.screenshotUrls ?? []).slice(0, 3),
  };
}

/* ------------------------------------------------------------------ *
 * Weekly ratings velocity from the rolling history store.
 * ------------------------------------------------------------------ */
function weeklyDelta(history, key, current, now) {
  const points = history.series?.[key];
  if (!Array.isArray(points) || !points.length) return null;

  // Oldest sample still inside the window, but only if it is old enough to
  // mean anything — extrapolating a week from twenty minutes is noise.
  const oldest = points.find((p) => now - p.t <= WEEK_MS) ?? points[0];
  const span = now - oldest.t;
  if (span < DAY_MS) return null;

  const delta = current - oldest.v;
  if (!Number.isFinite(delta) || delta < 0) return null; // Apple resets counts on some relaunches
  return Math.round((delta / span) * WEEK_MS);
}

function sample(history, key, value, now) {
  if (!Number.isFinite(value)) return;
  history.series[key] ??= [];
  const points = history.series[key];
  const last = points[points.length - 1];
  if (last && now - last.t < SAMPLE_GAP_MS) {
    last.v = value;
    return;
  }
  points.push({ t: now, v: value });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
