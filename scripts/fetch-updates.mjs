/**
 * Game update / patch-note tracker.
 *
 * Three strategies, because no single one covers the market:
 *  1. Steam ISteamNews  — real patch notes for anything on Steam, keyless.
 *  2. Official RSS      — for publishers who actually run a feed (GGG, Bungie).
 *  3. Version probes    — Riot ships no feed at all, but exposes the live
 *                         build version as JSON, so we detect the bump and
 *                         link to the official notes page.
 */
import { getJson, log, warn, toPlainText, pool } from './lib/http.mjs';
import { fetchFeed } from './lib/feed.mjs';
import { ENDPOINTS, PATCH_SOURCES, VERSION_PROBES, STEAM_UPDATE_FEEDS } from './lib/sources.mjs';
import { readHistory, writeHistory } from './lib/history.mjs';

const PATCH_WORDS =
  /\b(patch|update|hotfix|season|v?\d+\.\d+|changelog|release notes|balance|bug ?fix|maintenance|버전|패치|업데이트)\b/i;

export async function fetchUpdates() {
  const scope = 'updates';

  const [steamResults, rssResults, versionResults] = await Promise.all([
    pool(PATCH_SOURCES.filter((s) => s.type === 'steam'), 4, fromSteam),
    pool(PATCH_SOURCES.filter((s) => s.type === 'rss'), 4, fromRss),
    pool(VERSION_PROBES, 3, fromVersionProbe),
  ]);

  const games = [...steamResults, ...rssResults, ...versionResults].filter(Boolean);
  games.sort((a, b) => new Date(b.latest?.date || 0) - new Date(a.latest?.date || 0));

  const flat = games
    .flatMap((g) => (g.entries || []).map((e) => ({ ...e, game: g.game, gameId: g.id, platforms: g.platforms })))
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 60);

  log(scope, `${games.length} games tracked, ${flat.length} update entries`);

  return {
    updated: new Date().toISOString(),
    games,
    timeline: flat,
  };
}

async function fromSteam(src) {
  const json = await getJson(ENDPOINTS.steamNews(src.appid, 8), { scope: 'updates', retries: 1 });
  const items = json?.appnews?.newsitems;
  if (!Array.isArray(items) || !items.length) return null;

  const entries = items
    .filter((n) => STEAM_UPDATE_FEEDS.has(n.feed_type === 1 ? 'steam_community_announcements' : n.feedname) || PATCH_WORDS.test(n.title))
    .map((n) => ({
      title: toPlainText(n.title, 150),
      url: n.url,
      date: new Date(Number(n.date) * 1000).toISOString(),
      summary: toPlainText(n.contents, 320),
      author: n.author || null,
      version: extractVersion(n.title),
      sourceLabel: n.feedlabel || 'Steam',
    }))
    .slice(0, 6);

  if (!entries.length) return null;

  return {
    id: src.id,
    game: src.game,
    platforms: src.platforms,
    official: src.official,
    method: 'Steam news API',
    latest: entries[0],
    entries,
  };
}

async function fromRss(src) {
  const { ok, items, error } = await fetchFeed(src.url, { scope: 'updates', maxAgeDays: 45, limit: 25 });
  if (!ok) {
    warn('updates', `${src.game}: feed unusable (${error})`);
    return null;
  }

  // Blizzard's Discourse feeds carry every forum thread, so patch content has
  // to be filtered out of a lot of player chatter.
  const filtered = src.noisy ? items.filter((i) => PATCH_WORDS.test(i.title)) : items;
  const entries = filtered.slice(0, 6).map((i) => ({
    title: i.title,
    url: i.link,
    date: i.date,
    summary: i.summary,
    author: i.author,
    version: extractVersion(i.title),
    sourceLabel: i.source || 'Official',
  }));

  if (!entries.length) return null;

  return {
    id: src.id,
    game: src.game,
    platforms: src.platforms,
    official: src.official,
    method: 'Official RSS',
    latest: entries[0],
    entries,
  };
}

/**
 * Version probing. We persist the last seen build so a change can be reported
 * with an accurate "detected at" timestamp rather than pretending the patch
 * landed exactly when our cron happened to run.
 */
async function fromVersionProbe(probe) {
  const json = await getJson(probe.url, { scope: 'updates', retries: 2 });
  if (!json) return null;
  const version = probe.pick(json);
  if (!version) return null;

  const history = await readHistory();
  history.versions ??= {};
  const prev = history.versions[probe.id];
  const changed = !prev || prev.version !== version;
  const firstSeen = changed ? new Date().toISOString() : prev.firstSeen;

  history.versions[probe.id] = { version, firstSeen };
  await writeHistory(history);

  return {
    id: probe.id,
    game: probe.game,
    platforms: probe.platforms,
    official: probe.official,
    method: 'Live version probe',
    versionOnly: true,
    latest: {
      title: `${probe.game} patch ${version}`,
      url: probe.notesUrl(version),
      date: firstSeen,
      summary: `Live build is now ${version}. Official patch notes are published on the ${probe.game} site.`,
      version,
      sourceLabel: 'Official',
      isNew: changed,
    },
    entries: [
      {
        title: `${probe.game} patch ${version}`,
        url: probe.notesUrl(version),
        date: firstSeen,
        summary: `Detected live build ${version}.`,
        version,
        sourceLabel: 'Official',
      },
    ],
  };
}

function extractVersion(title) {
  if (!title) return null;
  const m =
    String(title).match(/\b(?:v(?:er(?:sion)?)?\.?\s*)?(\d+\.\d+(?:\.\d+)*)\b/i) ||
    String(title).match(/\bseason\s+(\d+(?:\.\d+)?)\b/i) ||
    String(title).match(/\b(?:패치|버전)\s*(\d+\.\d+(?:\.\d+)*)/);
  return m ? m[1] : null;
}
