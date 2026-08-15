#!/usr/bin/env node
/**
 * Pipeline orchestrator. Run by GitHub Actions on a cron.
 *
 * Contract with the rest of the site:
 *  - Writes one JSON file per dataset into BOTH public/data (fetched by the
 *    browser for live refresh) and src/data (imported at build time so the
 *    numbers are in the served HTML and therefore crawlable).
 *  - NEVER deletes or blanks an existing file when a fetch fails. A failed run
 *    leaves yesterday's data in place and marks it stale, which is far better
 *    than shipping an empty leaderboard.
 *  - Always exits 0 unless every single dataset failed, so one flaky upstream
 *    cannot break the deploy.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchLeaderboard } from './fetch-leaderboard.mjs';
import { fetchUpdates } from './fetch-updates.mjs';
import { fetchClips } from './fetch-clips.mjs';
import { fetchCosplay } from './fetch-cosplay.mjs';
import { fetchDeals } from './fetch-deals.mjs';
import { fetchNews } from './fetch-news.mjs';
import { log, warn } from './lib/http.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = resolve(ROOT, 'public/data');
const SRC_DIR = resolve(ROOT, 'src/data');

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const discover = process.argv.includes('--discover');

const TASKS = [
  { name: 'leaderboard', run: fetchLeaderboard },
  { name: 'updates', run: fetchUpdates },
  { name: 'clips', run: fetchClips },
  { name: 'deals', run: fetchDeals },
  { name: 'cosplay', run: () => fetchCosplay({ discover }) },
  { name: 'news', run: fetchNews },
];

async function main() {
  const started = Date.now();
  await mkdir(PUBLIC_DIR, { recursive: true });
  await mkdir(SRC_DIR, { recursive: true });

  const selected = only.length ? TASKS.filter((t) => only.includes(t.name)) : TASKS;
  if (!selected.length) {
    console.error(`No matching task. Available: ${TASKS.map((t) => t.name).join(', ')}`);
    process.exit(1);
  }

  const report = [];

  // Sequential on purpose: each task already parallelises internally, and
  // running them all at once trips rate limits on shared hosts.
  for (const task of selected) {
    const t0 = Date.now();
    let status = 'ok';
    let detail = '';
    try {
      const data = await task.run();
      if (data) {
        await writeDataset(task.name, data);
      } else {
        status = 'stale';
        detail = 'fetch returned no data — previous file kept';
        await markStale(task.name);
      }
    } catch (err) {
      status = 'error';
      detail = err?.message || String(err);
      warn('refresh', `${task.name} threw: ${detail}`);
      await markStale(task.name);
    }
    const ms = Date.now() - t0;
    report.push({ task: task.name, status, detail, ms });
    log('refresh', `${task.name}: ${status} (${(ms / 1000).toFixed(1)}s)`);
  }

  const health = {
    updated: new Date().toISOString(),
    durationMs: Date.now() - started,
    tasks: report,
    ok: report.filter((r) => r.status === 'ok').length,
    total: report.length,
  };
  await writeJson(resolve(PUBLIC_DIR, 'health.json'), health);
  await writeJson(resolve(SRC_DIR, 'health.json'), health);

  console.log('\n─── refresh summary ─────────────────────────');
  for (const r of report) {
    const icon = r.status === 'ok' ? '✓' : r.status === 'stale' ? '·' : '✗';
    console.log(`  ${icon} ${r.task.padEnd(12)} ${r.status.padEnd(6)} ${(r.ms / 1000).toFixed(1)}s ${r.detail}`);
  }
  console.log(`─── ${health.ok}/${health.total} succeeded in ${(health.durationMs / 1000).toFixed(1)}s ───\n`);

  // Only a total wipeout is worth failing the workflow over.
  if (health.ok === 0) {
    console.error('Every dataset failed. Failing the run so the alert fires.');
    process.exit(1);
  }
}

async function writeDataset(name, data) {
  const payload = { ...data, _stale: false };
  await writeJson(resolve(PUBLIC_DIR, `${name}.json`), payload);
  await writeJson(resolve(SRC_DIR, `${name}.json`), payload);
}

/** Keep the last good payload but flag it, so the UI can say so honestly. */
async function markStale(name) {
  for (const dir of [PUBLIC_DIR, SRC_DIR]) {
    const path = resolve(dir, `${name}.json`);
    try {
      const existing = JSON.parse(await readFile(path, 'utf8'));
      existing._stale = true;
      existing._staleSince = new Date().toISOString();
      await writeJson(path, existing);
    } catch {
      // Nothing on disk yet — write a placeholder so imports never explode.
      await writeJson(path, { updated: null, _stale: true, _empty: true });
    }
  }
}

async function writeJson(path, obj) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(obj), 'utf8');
}

main().catch((err) => {
  console.error('Fatal error in refresh pipeline:', err);
  process.exit(1);
});
