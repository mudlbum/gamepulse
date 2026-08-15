/**
 * Live player-count leaderboard.
 *
 * Source: Valve's public ISteamChartsService endpoint (no key), enriched with
 * store metadata for names and cover art, and diffed against a committed
 * rolling history so we can show 24h change and a sparkline.
 *
 * This is the one dataset on the site that is genuinely ours: nobody else
 * publishes this exact combination of live rank, 24h delta and 7-day shape in
 * one place, which is what makes the page worth indexing rather than being
 * just another scrape.
 */
import { getJson, log, warn, pool } from './lib/http.mjs';
import { ENDPOINTS, TRACKED_APPS } from './lib/sources.mjs';
import { readHistory, writeHistory, pushHistoryPoint } from './lib/history.mjs';

const NAME_BY_APPID = new Map(TRACKED_APPS.map((a) => [a.appid, a.name]));
const TOP_N = 60;

export async function fetchLeaderboard() {
  const scope = 'leaderboard';
  const now = new Date();

  /* Three sources, in descending order of truthfulness about "right now":
       1. GetGamesByConcurrentPlayers — real live concurrents.
       2. GetMostPlayedGames         — weekly chart, peak only, NO live figure.
       3. per-app GetNumberOfCurrentPlayers — live but only for tracked apps.
     The middle one is a ranking fallback, not a player-count source; treating
     its output as live is what produced a board of zeros on first deploy. */
  let ranks = null;
  let sourceUrl = ENDPOINTS.steamConcurrent;
  let sourceLabel = 'Steam ISteamChartsService/GetGamesByConcurrentPlayers (live concurrents, no key)';
  let metric = 'concurrent';

  const live = await getJson(ENDPOINTS.steamConcurrent, { scope, retries: 3 });
  if (Array.isArray(live?.response?.ranks) && live.response.ranks.length) {
    ranks = live.response.ranks;
  } else {
    warn(scope, 'live-concurrents endpoint empty — falling back to the weekly chart (peak figures)');
    const chart = await getJson(ENDPOINTS.steamMostPlayed, { scope, retries: 2 });
    if (Array.isArray(chart?.response?.ranks) && chart.response.ranks.length) {
      ranks = chart.response.ranks;
      sourceUrl = ENDPOINTS.steamMostPlayed;
      sourceLabel = 'Steam ISteamChartsService/GetMostPlayedGames (weekly PEAK, not live)';
      metric = 'peak';
    }
  }

  if (!Array.isArray(ranks) || !ranks.length) {
    warn(scope, 'both chart endpoints returned nothing — falling back to per-app player counts');
    ranks = await fallbackRanks(scope);
    sourceLabel = 'Steam GetNumberOfCurrentPlayers per app (live, tracked apps only)';
    metric = 'concurrent';
    if (!ranks.length) return null;
  }

  ranks = ranks.slice(0, TOP_N);

  // Enrich with store metadata. Steam's appdetails endpoint is undocumented
  // and rate-limited to roughly 200 requests / 5 min, so we cache names and
  // art in the history file and only look up apps we have never seen.
  const history = await readHistory();
  const meta = history.meta ?? {};
  const unknown = ranks.filter((r) => !meta[r.appid]?.name && !NAME_BY_APPID.has(r.appid));

  if (unknown.length) {
    log(scope, `resolving metadata for ${unknown.length} new app(s)`);
    await pool(unknown.slice(0, 25), 3, async (r) => {
      const detail = await getJson(ENDPOINTS.steamAppDetails(r.appid), { scope, retries: 1, timeout: 15000 });
      const d = detail?.[String(r.appid)];
      if (d?.success && d.data) {
        meta[r.appid] = {
          name: d.data.name,
          image: d.data.capsule_image || d.data.header_image || null,
          free: !!d.data.is_free,
          genres: (d.data.genres || []).map((g) => g.description).slice(0, 3),
          developers: (d.data.developers || []).slice(0, 2),
          releaseDate: d.data.release_date?.date || null,
        };
      }
      await new Promise((r2) => setTimeout(r2, 350)); // stay well under the rate limit
    });
  }

  const entries = ranks.map((r) => {
    const m = meta[r.appid] || {};
    const name = m.name || NAME_BY_APPID.get(r.appid) || `App ${r.appid}`;
    const peak = Number(r.peak_in_game ?? 0);
    /* Never let a missing field become a confident zero. If the payload has no
       live number, fall back to peak and let `metric` tell the UI what it is
       actually looking at. */
    const rawCurrent = r.concurrent_in_game ?? r.player_count ?? null;
    const current = rawCurrent == null ? peak : Number(rawCurrent);
    const series = history.series?.[r.appid] ?? [];

    // 24h comparison: the oldest sample within the last 30 hours.
    const dayAgoCut = Date.now() - 24 * 3600_000;
    const older = series.filter((p) => p.t <= dayAgoCut);
    const ref = older.length ? older[older.length - 1] : series[0];
    const change24h = ref && ref.v > 0 ? ((current - ref.v) / ref.v) * 100 : null;

    const prevRank = history.lastRanks?.[r.appid] ?? null;

    return {
      appid: r.appid,
      rank: r.rank,
      name,
      image: m.image || `https://cdn.akamai.steamstatic.com/steam/apps/${r.appid}/capsule_231x87.jpg`,
      url: `https://store.steampowered.com/app/${r.appid}/`,
      current,
      peak,
      free: !!m.free,
      genres: m.genres || [],
      /* Already fetched from appdetails and cached in history.meta, but never
         emitted until now — so every game page was missing the facts that make
         it worth indexing (who made it, when it shipped, what it is). */
      developers: m.developers || [],
      releaseDate: m.releaseDate || null,
      change24h: change24h === null ? null : Math.round(change24h * 10) / 10,
      rankChange: prevRank === null ? null : prevRank - r.rank,
      lastWeekRank: r.last_week_rank ?? null,
      /* The stored series does not yet contain this run's sample — it is
         appended below — so append it here too, otherwise the sparkline always
         lags one refresh behind and a brand-new game shows an empty chart. */
      spark: downsample([...series.map((p) => p.v), current], 24),
    };
  });

  // Record this observation for the next run's deltas.
  const stamp = now.getTime();
  for (const e of entries) pushHistoryPoint(history, e.appid, stamp, e.current);
  history.meta = meta;
  history.lastRanks = Object.fromEntries(entries.map((e) => [e.appid, e.rank]));
  await writeHistory(history);

  const risers = [...entries]
    .filter((e) => e.change24h !== null && e.current > 5000)
    .sort((a, b) => b.change24h - a.change24h)
    .slice(0, 5);
  const fallers = [...entries]
    .filter((e) => e.change24h !== null && e.current > 5000)
    .sort((a, b) => a.change24h - b.change24h)
    .slice(0, 5);

  log(scope, `${entries.length} games · #1 ${entries[0]?.name} @ ${entries[0]?.current.toLocaleString()}`);

  const totalPlayers = entries.reduce((s, e) => s + e.current, 0);
  if (totalPlayers === 0 && entries.length) {
    warn(scope, `every entry reports 0 players — the payload shape probably changed. Source: ${sourceUrl}`);
  }

  return {
    updated: now.toISOString(),
    source: sourceLabel,
    sourceUrl,
    /* 'concurrent' = players in game right now. 'peak' = the period's high
       water mark, shown only when no live figure was available. */
    metric,
    totalPlayers,
    entries,
    risers,
    fallers,
  };
}

/** If the chart service is down, rebuild a ranking from per-app counts. */
async function fallbackRanks(scope) {
  const results = await pool(TRACKED_APPS, 5, async (app) => {
    const j = await getJson(ENDPOINTS.steamPlayers(app.appid), { scope, retries: 1, timeout: 12000 });
    const count = j?.response?.player_count;
    return typeof count === 'number' ? { appid: app.appid, concurrent_in_game: count, peak_in_game: 0 } : null;
  });
  return results
    .filter(Boolean)
    .sort((a, b) => b.concurrent_in_game - a.concurrent_in_game)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

function downsample(values, target) {
  if (values.length <= target) return values;
  const step = values.length / target;
  const out = [];
  for (let i = 0; i < target; i++) out.push(values[Math.floor(i * step)]);
  out[out.length - 1] = values[values.length - 1];
  return out;
}
