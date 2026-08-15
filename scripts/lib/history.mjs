/**
 * Rolling time-series store, committed to the repo.
 *
 * GitHub Pages has no database, so the repo itself is the database. Each
 * refresh appends one sample per tracked game and prunes anything older than
 * the retention window, keeping the file bounded at a few hundred KB.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * data-store/history.json is production state: the rolling player series AND
 * the speedrun.com game-id cache. Tests and the offline seeder run the real
 * fetchers against fixtures, so without redirecting this path they write
 * fixture values straight into it — and a fixture-resolved game id 404s
 * against the live API, silently disabling the speedruns dataset in CI.
 * Both set GP_HISTORY_PATH to a scratch file so production state is untouched.
 */
const HISTORY_PATH = process.env.GP_HISTORY_PATH
  ? resolve(process.env.GP_HISTORY_PATH)
  : resolve(ROOT, 'data-store/history.json');

const RETENTION_MS = 8 * 24 * 3600_000; // 8 days
const MAX_POINTS = 400; // hard cap per game

const EMPTY = { version: 1, series: {}, meta: {}, lastRanks: {}, updated: null };

export async function readHistory() {
  try {
    const raw = await readFile(HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...EMPTY, ...parsed, series: parsed.series ?? {}, meta: parsed.meta ?? {} };
  } catch {
    return structuredClone(EMPTY);
  }
}

export async function writeHistory(history) {
  history.updated = new Date().toISOString();
  const cutoff = Date.now() - RETENTION_MS;
  for (const [appid, points] of Object.entries(history.series)) {
    const pruned = points.filter((p) => p.t >= cutoff).slice(-MAX_POINTS);
    if (pruned.length) history.series[appid] = pruned;
    else delete history.series[appid];
  }
  await mkdir(dirname(HISTORY_PATH), { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(history), 'utf8');
}

export function pushHistoryPoint(history, appid, t, v) {
  if (!Number.isFinite(v)) return;
  const key = String(appid);
  history.series[key] ??= [];
  const points = history.series[key];
  const last = points[points.length - 1];
  // Collapse samples taken less than 10 minutes apart (e.g. a manual re-run).
  if (last && t - last.t < 10 * 60_000) {
    last.v = v;
    last.t = t;
    return;
  }
  points.push({ t, v });
}
