#!/usr/bin/env node
/**
 * Decides whether today has a story worth publishing, and picks the best one.
 *
 * THIS SCRIPT IS THE REASON DAILY AUTO-PUBLISHING IS DEFENSIBLE.
 *
 * A daily schedule that publishes something every single day is a content farm
 * with a cron job. Google's scaled-content-abuse policy is aimed squarely at
 * that, and an AdSense reviewer looking at 365 posts a year on an automated
 * site will reach the same conclusion. So the schedule runs daily and the
 * decision is made daily, but the answer is allowed to be no. On a quiet day
 * this exits with `publish=false` and the workflow ships nothing.
 *
 * Expect roughly 3–5 publishes a week. Weeks with fewer are not a bug. If this
 * starts passing seven days out of seven, something has gone wrong with the
 * gate, not right with the news.
 *
 * Every threshold below exists to answer one question: could a competent human
 * writer produce an accurate article from this evidence alone? If not, no
 * amount of fluent prose fixes it.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log, warn } from './lib/http.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRIEFS = resolve(ROOT, 'briefs');
const POSTS_EN = resolve(ROOT, 'src/content/posts/en');

/* ---------------- thresholds ---------------- */

/** Two outlets that reported it independently, or one primary source. */
const MIN_OUTLETS = 2;
/** Enough corroborated facts to build an article that is not padding. */
const MIN_FACTS = 6;
/** Facts extracted from headlines alone are not facts. At least this many of
    the cluster's articles must have had readable body text. */
const MIN_READABLE = 2;
/** News, not history. */
const MAX_AGE_HOURS = 36;
/** A brief where a third of the numbers disagree is not ready to write from. */
const MAX_CONFLICT_RATIO = 0.34;
/** Do not re-cover a story we already published within this window. */
const DEDUPE_DAYS = 14;
/** Title-token overlap above this counts as the same story. */
const DUPLICATE_OVERLAP = 0.5;
/* Titles are short, so pure token overlap is a blunt instrument: "Helldivers 2
   update adds new Illuminate enemies" and "Helldivers 2's level cap just
   doubled to 300" share only 25% of their tokens and are the same patch. When
   we already covered a game this week, a much lower similarity is enough to
   call it a repeat. */
const SAME_GAME_DAYS = 7;
const SAME_GAME_OVERLAP = 0.25;

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was',
  'were', 'be', 'as', 'at', 'by', 'with', 'from', 'that', 'this', 'it', 'its',
  'new', 'now', 'game', 'games', 'gaming', 'update', 'players', 'player',
]);

const tokens = (s) =>
  new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  );

/** Overlap coefficient — the same measure the news clusterer uses. */
const overlap = (a, b) => {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return hit / Math.min(a.size, b.size);
};

async function main() {
  const files = (await readdir(BRIEFS).catch(() => []))
    .filter((f) => f.endsWith('.json') && f !== 'latest.json' && f !== 'selected.json')
    .sort()
    .reverse();

  if (!files.length) {
    return decide(null, 'no briefs were generated — the news pipeline produced no clusters');
  }

  const recent = await recentlyPublished();
  log('select', `${files.length} brief(s) to consider · ${recent.length} post(s) published in the last ${DEDUPE_DAYS} days`);

  const considered = [];

  for (const file of files.slice(0, 8)) {
    let brief;
    try {
      brief = JSON.parse(await readFile(resolve(BRIEFS, file), 'utf8'));
    } catch {
      continue;
    }
    const verdict = evaluate(brief, recent);
    considered.push({ file, title: brief.workingTitle, ...verdict });
    log('select', `${verdict.pass ? 'PASS' : 'skip'} · ${file} — ${verdict.reason}`);
  }

  const passing = considered.filter((c) => c.pass).sort((a, b) => b.score - a.score);

  if (!passing.length) {
    return decide(null, 'no story cleared the evidence gate today', considered);
  }
  return decide(passing[0], `selected on score ${passing[0].score.toFixed(1)}`, considered);
}

function evaluate(brief, recent) {
  const facts = brief.facts?.length ?? 0;
  const conflicts = brief.conflicts?.length ?? 0;
  const outlets = brief.outletCount ?? brief.outlets?.length ?? 0;
  const readable = brief.readableCount ?? 0;
  const hasPrimary = (brief.sources?.primary?.length ?? 0) > 0;

  const newest = brief.newest ? Date.parse(brief.newest) : NaN;
  const ageHours = Number.isFinite(newest) ? (Date.now() - newest) / 3600_000 : Infinity;

  const fail = (reason) => ({ pass: false, reason, score: 0 });

  /* Readability is checked FIRST because it is the most diagnostic failure.
     The first live run reported "0 corroborated facts" for all five stories,
     which reads like a clustering problem; the actual cause was that not one
     source body could be fetched, so there was nothing to extract facts from.
     A gate that misreports why it refused is worse than one that refuses. */
  if (brief.readableCount != null && readable < MIN_READABLE)
    return fail(`only ${readable}/${brief.sourceCount ?? '?'} source bodies were readable — nothing to fact-check against`);
  if (outlets < MIN_OUTLETS && !hasPrimary)
    return fail(`only ${outlets} outlet(s) and no primary source`);
  if (facts < MIN_FACTS) return fail(`${facts} corroborated facts, need ${MIN_FACTS}`);
  if (ageHours > MAX_AGE_HOURS)
    return fail(`newest source is ${Math.round(ageHours)}h old, limit ${MAX_AGE_HOURS}h`);
  if (facts > 0 && conflicts / facts > MAX_CONFLICT_RATIO)
    return fail(`${conflicts} conflicts against ${facts} facts — evidence too contradictory`);

  const t = tokens(brief.workingTitle);
  const dupe = recent.find((p) => overlap(t, p.tokens) >= DUPLICATE_OVERLAP);
  if (dupe) return fail(`already covered: "${dupe.title}"`);

  const briefGames = (brief.games ?? []).map((g) => String(g).toLowerCase());
  const sameGame = recent.find(
    (p) =>
      p.recent &&
      p.games.some((g) => briefGames.includes(g)) &&
      overlap(t, p.tokens) >= SAME_GAME_OVERLAP
  );
  if (sameGame) return fail(`covered ${sameGame.games.join('/')} this week already: "${sameGame.title}"`);

  /* Score, for choosing between several passing stories. Corroboration and
     primary sourcing are worth more than raw volume — a story confirmed by the
     publisher beats one confirmed by five aggregators repeating each other. */
  const score =
    facts * 1.0 +
    outlets * 3.0 +
    (hasPrimary ? 8 : 0) +
    Math.max(0, 12 - ageHours / 3) -
    conflicts * 2.0;

  return { pass: true, reason: `${facts} facts · ${outlets} outlets · ${hasPrimary ? 'primary source' : 'secondary only'} · ${Math.round(ageHours)}h old`, score };
}

/** Titles published recently, so today's pick is not yesterday's story again. */
async function recentlyPublished() {
  const cut = Date.now() - DEDUPE_DAYS * 24 * 3600_000;
  const out = [];
  for (const f of await readdir(POSTS_EN).catch(() => [])) {
    if (!f.endsWith('.md')) continue;
    const raw = await readFile(resolve(POSTS_EN, f), 'utf8').catch(() => '');
    const title = (raw.match(/^title:\s*['"]?(.+?)['"]?\s*$/m) || [])[1];
    const date = (raw.match(/^pubDate:\s*['"]?(.+?)['"]?\s*$/m) || [])[1];
    const t = date ? Date.parse(date) : NaN;
    if (!title) continue;
    if (Number.isFinite(t) && t < cut) continue;
    // games: is a YAML flow or block list in the frontmatter.
    const gamesBlock = (raw.match(/^games:\s*(\[[^\]]*\]|(?:\n\s+-\s.*)+)/m) || [])[1] || '';
    const games = [...gamesBlock.matchAll(/["']?([^"',\[\]\n-][^"',\[\]\n]*)["']?/g)]
      .map((m) => m[1].trim().toLowerCase())
      .filter(Boolean);
    out.push({
      title,
      tokens: tokens(title),
      games,
      recent: !Number.isFinite(t) || t >= Date.now() - SAME_GAME_DAYS * 24 * 3600_000,
    });
  }
  return out;
}

async function decide(winner, reason, considered = []) {
  const result = {
    decided: new Date().toISOString(),
    publish: !!winner,
    reason,
    brief: winner?.file ?? null,
    title: winner?.title ?? null,
    considered: considered.map(({ file, title, pass, reason: r }) => ({ file, title, pass, reason: r })),
  };
  await writeFile(resolve(BRIEFS, 'selected.json'), JSON.stringify(result, null, 2), 'utf8');

  if (winner) {
    log('select', `PUBLISH → ${winner.file}`);
  } else {
    warn('select', `no publish today — ${reason}`);
  }

  /* GitHub Actions reads these to decide whether the rest of the job runs. */
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `publish=${result.publish}\nbrief=${result.brief ?? ''}\ntitle=${(result.title ?? '').replace(/\n/g, ' ')}\nreason=${reason.replace(/\n/g, ' ')}\n`
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    const lines = [
      `### Daily story selection`,
      '',
      result.publish ? `**Publishing:** ${result.title}` : `**Publishing nothing today.** ${reason}`,
      '',
      '| Brief | Verdict | Why |',
      '| --- | --- | --- |',
      ...result.considered.map((c) => `| ${c.title ?? c.file} | ${c.pass ? 'pass' : 'skip'} | ${c.reason} |`),
      '',
      '_A quiet day is a valid outcome. See the header comment in `scripts/select-story.mjs`._',
    ];
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
}

main().catch((err) => {
  warn('select', err?.message || String(err));
  // A crash here must not publish. Fail closed.
  process.exit(1);
});
