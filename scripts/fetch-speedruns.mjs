/**
 * Per-game player leaderboards from speedrun.com.
 *
 * This is the only keyless source that answers "click a game, see a ranking of
 * actual players". Riot, Valve, Xbox and PlayStation all require keys or expose
 * nothing at all.
 *
 * LICENSING: speedrun.com content is CC-BY-NC 4.0. Every surface that renders
 * this data must credit speedrun.com and link back to the run. That is handled
 * in the game-page template, not here — but do not strip the weblinks from this
 * payload, they are the attribution.
 *
 * The v1 API is stable but unmaintained, and it has four traps that a naive
 * implementation walks straight into. Each is handled below and named in a
 * comment so the reason survives.
 */
import { getJson, log, warn, pool, slugify } from './lib/http.mjs';
import { ENDPOINTS, TRACKED_APPS } from './lib/sources.mjs';
import { readHistory, writeHistory } from './lib/history.mjs';

/** Games worth asking about. Anything not speedrun simply resolves to null. */
const CANDIDATES = [
  ...new Set([
    ...TRACKED_APPS.map((a) => a.name),
    'ELDEN RING',
    'Hollow Knight',
    'Celeste',
    'Grand Theft Auto V',
    'Minecraft',
    'Cyberpunk 2077',
    'Baldur\'s Gate 3',
    'Dark Souls III',
    'Sekiro: Shadows Die Twice',
    'Portal 2',
    'Terraria',
    'Stardew Valley',
    'Subnautica',
    'Outer Wilds',
  ]),
];

const TOP_N = 10;

export async function fetchSpeedruns() {
  const scope = 'speedrun';
  const history = await readHistory();
  history.srcGames ??= {}; // name -> { id, category, categoryName, weblink } | { none: true }

  /* Resolving a name to a game id is the expensive part and it never changes,
     so it is cached in the committed history file. Only genuinely new names
     hit the search endpoint, and only a few per run to stay well inside the
     100 req/min cap. */
  const unresolved = CANDIDATES.filter((n) => !(n in history.srcGames));
  if (unresolved.length) {
    log(scope, `resolving ${Math.min(unresolved.length, 8)} new game(s)`);
    for (const name of unresolved.slice(0, 8)) {
      history.srcGames[name] = await resolveGame(name, scope);
      await sleep(700);
    }
    await writeHistory(history);
  }

  const resolved = Object.entries(history.srcGames).filter(([, v]) => v && !v.none);
  if (!resolved.length) {
    warn(scope, 'no games resolved to speedrun.com entries');
    return null;
  }

  const boards = await pool(resolved.slice(0, 20), 2, async ([name, g]) => {
    const board = await fetchBoard(g, scope);
    if (!board) return null;
    return { game: name, slug: slugify(name), ...board };
  });

  const valid = boards.filter(Boolean).filter((b) => b.runs.length);
  if (!valid.length) {
    warn(scope, 'every leaderboard came back empty');
    return null;
  }

  log(scope, `${valid.length} leaderboards, ${valid.reduce((s, b) => s + b.runs.length, 0)} runs`);

  return {
    updated: new Date().toISOString(),
    source: 'speedrun.com API v1 (public, no key)',
    licence: 'CC-BY-NC 4.0 — attribution to speedrun.com required wherever this is shown',
    attributionUrl: 'https://www.speedrun.com/',
    boards: Object.fromEntries(valid.map((b) => [b.slug, b])),
  };
}

async function resolveGame(name, scope) {
  const json = await getJson(
    `${ENDPOINTS.speedrunBase}/games?name=${encodeURIComponent(name)}&max=5`,
    { scope, retries: 1 }
  );
  const games = json?.data;
  if (!Array.isArray(games) || !games.length) return { none: true };

  /* Search is fuzzy across names AND abbreviations, so data[0] is not reliably
     the game asked for. Prefer an exact case-insensitive title match. */
  const want = name.toLowerCase();
  const exact = games.find((g) => (g.names?.international ?? '').toLowerCase() === want);
  const game = exact ?? games[0];
  if (!exact && (game.names?.international ?? '').toLowerCase() !== want) {
    // Loose match — only accept if one clearly contains the other.
    const got = (game.names?.international ?? '').toLowerCase();
    if (!got.includes(want) && !want.includes(got)) return { none: true };
  }

  const cats = await getJson(`${ENDPOINTS.speedrunBase}/games/${game.id}/categories`, { scope, retries: 1 });
  /* There is no isMain/isDefault flag on categories. The only workable
     heuristic is the first full-game, non-miscellaneous category — the docs say
     miscellaneous ones "are usually not shown directly on the leaderboards". */
  const main = (cats?.data ?? []).find((c) => c.type === 'per-game' && !c.miscellaneous);
  if (!main) return { none: true };

  return {
    id: game.id,
    name: game.names?.international ?? name,
    // Never build the URL from `abbreviation` — the docs explicitly warn against it.
    weblink: game.weblink ?? null,
    cover: game.assets?.['cover-medium']?.uri ?? null,
    category: main.id,
    categoryName: main.name,
    categoryRules: (main.rules ?? '').slice(0, 400) || null,
  };
}

async function fetchBoard(g, scope) {
  const json = await getJson(
    `${ENDPOINTS.speedrunBase}/leaderboards/${g.id}/category/${g.category}?top=${TOP_N}&embed=players`,
    { scope, retries: 1, timeout: 20000 }
  );
  const d = json?.data;
  if (!d || !Array.isArray(d.runs)) return null;

  /* TRAP: `embed=players` does NOT attach players to each run. It adds ONE
     flat list at data.players.data[], while run.players stays as id stubs.
     Reading run.players[i].names.international therefore yields undefined for
     every row. The join has to be done by hand. */
  const playerIndex = new Map();
  for (const p of d.players?.data ?? []) {
    if (p?.id) playerIndex.set(p.id, p);
  }

  const runs = d.runs.map(({ place, run }) => {
    const names = (run.players ?? []).map((stub) => resolvePlayerName(stub, playerIndex));
    return {
      place,
      players: names,
      // primary_t is the numeric seconds form; `primary` is an ISO-8601 duration.
      seconds: Number(run.times?.primary_t ?? 0),
      time: formatDuration(Number(run.times?.primary_t ?? 0)),
      // TRAP: videos can be null, and links can be absent even when it is not.
      video: run.videos?.links?.[0]?.uri ?? null,
      date: run.date ?? null, // nullable — not every run has a known date
      weblink: run.weblink ?? null,
    };
  });

  return {
    gameId: g.id,
    gameName: g.name,
    gameWeblink: g.weblink,
    cover: g.cover,
    category: g.categoryName,
    categoryRules: g.categoryRules,
    timing: d.timing ?? null,
    boardWeblink: d.weblink ?? null,
    /* TRAP: `top=N` returns the top N PLACES, and ties mean that can be more
       than N runs. Never size a table on the requested N. */
    runs,
    hasTies: new Set(runs.map((r) => r.place)).size !== runs.length,
  };
}

/**
 * TRAP: a player is one of two incompatible shapes.
 *   rel === 'user'  -> { id, names: { international } }
 *   rel === 'guest' -> { name }   — flat, no id, no names object
 * Reading names.international on a guest returns undefined.
 */
function resolvePlayerName(stub, index) {
  if (!stub) return { name: 'Unknown', url: null, guest: false };
  if (stub.rel === 'guest') {
    return { name: stub.name ?? 'Guest', url: stub.uri ?? null, guest: true };
  }
  const full = stub.id ? index.get(stub.id) : null;
  const name =
    full?.names?.international ??
    full?.name ??
    stub.names?.international ??
    stub.name ??
    'Unknown';
  return { name, url: full?.weblink ?? stub.uri ?? null, guest: false };
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '—';
  const ms = Math.round((totalSeconds % 1) * 1000);
  const s = Math.floor(totalSeconds) % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const base = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return ms ? `${base}.${pad(ms, 3)}` : base;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
