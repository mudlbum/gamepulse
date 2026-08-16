#!/usr/bin/env node
/**
 * Research brief generator.
 *
 * This is the step that makes automated writing defensible. It does not write
 * anything — it assembles the evidence a writer (human or model) needs, and
 * more importantly it flags where that evidence disagrees with itself.
 *
 * For the hottest story clusters it:
 *   1. pulls the full text of every article in the cluster
 *   2. extracts numbers, dates, versions and quotes, tagged with which outlet
 *      said what
 *   3. cross-references those facts across outlets and marks any that conflict
 *   4. locates the primary source (publisher blog, patch notes, filing) and
 *      separates it from secondary reporting
 *   5. attaches our own leaderboard data where the story is about a game we track
 *
 * The output is a JSON + Markdown brief per story. Anything marked CONFLICT or
 * SINGLE-SOURCE must not be stated as fact in the finished article.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getText, toPlainText, slugify, pool, log, warn } from './lib/http.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'briefs');

const MAX_STORIES = Number(process.env.BRIEF_COUNT || 3);

/** Outlets that publish first-party information rather than reporting on it. */
const PRIMARY_HOSTS = [
  'blog.playstation.com', 'news.xbox.com', 'nintendo.com', 'store.steampowered.com',
  'leagueoflegends.com', 'playvalorant.com', 'bungie.net', 'pathofexile.com',
  'ea.com', 'callofduty.com', 'marvelrivals.com', 'blizzard.com', 'epicgames.com',
  'take2games.com', 'nintendo.co.jp', 'sec.gov', 'hoyoverse.com', 'riotgames.com',
];

async function main() {
  const news = JSON.parse(await readFile(resolve(ROOT, 'src/data/news.json'), 'utf8'));
  const leaderboard = await readJsonSafe(resolve(ROOT, 'src/data/leaderboard.json'));
  const updates = await readJsonSafe(resolve(ROOT, 'src/data/updates.json'));

  const clusters = (news.feeds?.en?.clusters ?? []).slice(0, MAX_STORIES);
  if (!clusters.length) {
    log('brief', 'no story clusters available — nothing to brief');
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const written = [];

  for (const cluster of clusters) {
    const brief = await buildBrief(cluster, { leaderboard, updates });
    const slug = slugify(brief.workingTitle).slice(0, 60);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `${stamp}-${slug}`;

    await writeFile(resolve(OUT_DIR, `${base}.json`), JSON.stringify(brief, null, 2), 'utf8');
    await writeFile(resolve(OUT_DIR, `${base}.md`), renderMarkdown(brief), 'utf8');
    written.push(`${base}.md`);

    log('brief', `${base} — ${brief.facts.length} facts, ${brief.conflicts.length} conflicts, ${brief.singleSourced.length} single-sourced`);
  }

  await writeFile(
    resolve(OUT_DIR, 'latest.json'),
    JSON.stringify({ generated: new Date().toISOString(), briefs: written }, null, 2),
    'utf8'
  );
  console.log(`\nWrote ${written.length} brief(s) to briefs/\n`);
}

async function buildBrief(cluster, context) {
  const articles = cluster.articles.slice(0, 6);

  const fetched = await pool(articles, 3, async (a) => {
    const html = await getText(a.url, { scope: 'brief', retries: 1, timeout: 18000 });
    if (!html) return { ...a, text: '', ok: false };
    return { ...a, text: extractReadable(html), ok: true };
  });

  const usable = fetched.filter((f) => f && f.ok && f.text.length > 250);
  if (usable.length < fetched.length) {
    warn('brief', `${fetched.length - usable.length}/${fetched.length} sources unreadable for "${cluster.headline.slice(0, 50)}"`);
  }

  const primary = usable.filter((a) => PRIMARY_HOSTS.some((h) => safeHost(a.url).includes(h)));
  const secondary = usable.filter((a) => !primary.includes(a));

  // Extract candidate facts, attributed to the outlet that stated them.
  const claims = [];
  for (const a of usable) {
    for (const c of extractClaims(a.text)) {
      claims.push({ ...c, outlet: a.outlet, url: a.url, isPrimary: primary.includes(a) });
    }
  }

  const { facts, conflicts, singleSourced } = reconcile(claims);

  const games = detectGames(cluster, context.leaderboard);
  const ourData = games.map((g) => {
    const e = (context.leaderboard?.entries ?? []).find((x) => x.name === g);
    return e
      ? {
          game: g,
          concurrent: e.current,
          rank: e.rank,
          change24h: e.change24h,
          note: 'From our own leaderboard — original data, safe to cite as ours.',
        }
      : { game: g, note: 'Not currently in our tracked Steam top 60.' };
  });

  const relatedPatch = (context.updates?.games ?? []).filter((g) =>
    games.some((name) => g.game.toLowerCase().includes(name.toLowerCase().slice(0, 8)))
  );

  return {
    generated: new Date().toISOString(),
    workingTitle: cluster.headline,
    heat: cluster.heat,
    outletCount: cluster.outletCount,
    outlets: cluster.outlets,
    /* Recorded so the publish gate can judge the brief on its own terms rather
       than re-deriving them: how fresh the newest source is, and how many
       articles actually yielded body text. Facts extracted from headlines
       alone are not facts. */
    newest: cluster.newest ?? null,
    readableCount: usable.length,
    games,
    sources: {
      primary: primary.map(pickMeta),
      secondary: secondary.map(pickMeta),
      unreadable: fetched.filter((f) => f && !f.ok).map(pickMeta),
    },
    facts,
    conflicts,
    singleSourced,
    ourData,
    relatedPatchNotes: relatedPatch.map((g) => ({ game: g.game, title: g.latest?.title, url: g.latest?.url })),
    usable: usable.length > 0 && facts.length >= 4,
    guidance: buildGuidance(primary.length, conflicts.length, singleSourced.length, facts.length, usable.length),
  };
}

/* ------------------------------------------------------------------ */

function extractReadable(html) {
  // Strip everything that is definitionally not article prose, then take the
  // longest run of text — crude, but robust across wildly different templates
  // and with no dependency on a heavyweight readability library.
  const cleaned = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|figure|iframe)[\s\S]*?<\/\1>/gi, ' ');

  const paragraphs = [...cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => toPlainText(m[1], 2000))
    .filter((p) => p.length > 60);

  return paragraphs.join('\n\n').slice(0, 24000);
}

const CLAIM_PATTERNS = [
  // Money and large counts
  { kind: 'figure', re: /(?:^|[\s(])((?:US)?\$\s?[\d,.]+(?:\s?(?:million|billion|bn|m|k))?)/gi },
  { kind: 'figure', re: /(?:^|[\s(])([\d][\d,.]*\s?(?:million|billion|thousand)\s+(?:units|copies|players|users|subscribers|downloads|concurrent))/gi },
  { kind: 'figure', re: /(?:^|[\s(])([\d][\d,]{3,}\s+(?:concurrent|players|units|copies))/gi },
  // Percentages with direction
  { kind: 'percent', re: /((?:up|down|rose|fell|grew|declined|increased|decreased)\s+(?:by\s+)?[\d.]+\s?%)/gi },
  { kind: 'percent', re: /([\d.]+\s?%\s+(?:increase|decrease|drop|rise|growth|decline|year[- ]on[- ]year|YoY))/gi },
  // Dates
  { kind: 'date', re: /((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/gi },
  { kind: 'date', re: /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/gi },
  // Versions and seasons
  { kind: 'version', re: /((?:version|patch|update|season)\s+[\d.]+[\w.]*)/gi },
];

function extractClaims(text) {
  const out = [];
  const sentences = text.split(/(?<=[.!?])\s+/);

  for (const sentence of sentences) {
    if (sentence.length < 25 || sentence.length > 400) continue;

    for (const { kind, re } of CLAIM_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(sentence)) !== null) {
        out.push({
          kind,
          value: m[1].trim().replace(/\s+/g, ' '),
          context: sentence.trim(),
        });
        if (out.length > 200) return out;
      }
    }

    // Direct quotes — attribute-critical, so captured separately.
    const q = sentence.match(/[""]([^""]{25,260})[""]/);
    if (q) out.push({ kind: 'quote', value: q[1].trim(), context: sentence.trim() });
  }
  return out;
}

/**
 * Group claims by normalised value and decide what is corroborated, what is
 * contested, and what rests on a single outlet.
 */
function reconcile(claims) {
  const byValue = new Map();
  for (const c of claims) {
    const key = `${c.kind}::${normValue(c.value)}`;
    if (!byValue.has(key)) byValue.set(key, []);
    byValue.get(key).push(c);
  }

  const facts = [];
  const singleSourced = [];

  for (const [key, group] of byValue) {
    const outlets = [...new Set(group.map((g) => g.outlet))];
    const hasPrimary = group.some((g) => g.isPrimary);
    const entry = {
      kind: group[0].kind,
      value: group[0].value,
      outlets,
      hasPrimary,
      corroboration: outlets.length,
      context: group[0].context,
      urls: [...new Set(group.map((g) => g.url))].slice(0, 4),
    };
    if (outlets.length >= 2 || hasPrimary) facts.push(entry);
    else singleSourced.push(entry);
  }

  facts.sort((a, b) => Number(b.hasPrimary) - Number(a.hasPrimary) || b.corroboration - a.corroboration);

  // Conflicts: same kind of measure appearing in near-identical sentences with
  // different values. Catches "3.82 million" vs "3.8 million" vs "4 million".
  const conflicts = [];
  const numeric = facts.filter((f) => f.kind === 'figure' || f.kind === 'percent');
  for (let i = 0; i < numeric.length; i++) {
    for (let j = i + 1; j < numeric.length; j++) {
      const a = numeric[i];
      const b = numeric[j];
      if (normValue(a.value) === normValue(b.value)) continue;
      if (contextSimilarity(a.context, b.context) > 0.55) {
        conflicts.push({
          a: { value: a.value, outlets: a.outlets, url: a.urls[0] },
          b: { value: b.value, outlets: b.outlets, url: b.urls[0] },
          sharedContext: a.context.slice(0, 200),
          instruction: 'Sources disagree. Verify against the primary source, or state the discrepancy in the article. Do NOT silently pick one.',
        });
      }
    }
  }

  return { facts: facts.slice(0, 60), conflicts: conflicts.slice(0, 20), singleSourced: singleSourced.slice(0, 30) };
}

function normValue(v) {
  return String(v).toLowerCase().replace(/[\s,$]/g, '').replace(/illion$/, '');
}

function contextSimilarity(a, b) {
  const t = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
  const A = t(a);
  const B = t(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size || 1, B.size || 1);
}

function detectGames(cluster, leaderboard) {
  const hay = (cluster.headline + ' ' + cluster.articles.map((a) => a.title).join(' ')).toLowerCase();
  const names = (leaderboard?.entries ?? []).map((e) => e.name);
  const extra = ['Fortnite', 'Genshin Impact', 'League of Legends', 'VALORANT', 'Minecraft', 'Roblox',
    'Grand Theft Auto VI', 'Call of Duty', 'Honkai: Star Rail', 'Nintendo Switch 2', 'Pokémon'];
  return [...new Set([...names, ...extra])]
    .filter((n) => hay.includes(n.toLowerCase()) || hay.includes(n.toLowerCase().split(':')[0]))
    .slice(0, 4);
}

function pickMeta(a) {
  return { outlet: a.outlet, title: a.title, url: a.url, date: a.date, host: safeHost(a.url) };
}

function safeHost(url) {
  try { return new URL(url).host; } catch { return ''; }
}

function buildGuidance(primaryCount, conflictCount, singleCount, factCount = 1, readable = 1) {
  const g = [];
  if (readable === 0) {
    g.push('UNUSABLE — none of the source articles could be read (paywalled, JavaScript-rendered, or blocking automated requests). Do not write from this brief. Open the URLs manually or drop the story.');
    return g;
  }
  if (factCount === 0) {
    g.push('UNUSABLE — sources were readable but no verifiable figures, dates or quotes could be extracted. This is usually an opinion piece or a roundup with no hard claims. Do not write from this brief.');
    return g;
  }
  if (primaryCount === 0) {
    g.push('NO PRIMARY SOURCE FOUND. Every claim here is second-hand reporting. Either locate the publisher/official source before writing, or attribute every claim explicitly to the outlet that made it ("According to Eurogamer…").');
  } else {
    g.push(`${primaryCount} primary source(s) located. Prefer their wording and figures over any secondary outlet.`);
  }
  if (conflictCount > 0) {
    g.push(`${conflictCount} numeric conflict(s) detected. Each must be resolved against the primary source or explicitly reported as a discrepancy. Never average them, never pick silently.`);
  }
  if (singleCount > 0) {
    g.push(`${singleCount} claim(s) appear in only one outlet with no primary backing. Do not state these as fact. Either attribute them or leave them out.`);
  }
  g.push('Any claim not in the facts list below is not verified by this brief and must not be asserted.');
  g.push('Add every URL actually used to the article frontmatter sources[] array.');
  return g;
}

function renderMarkdown(b) {
  const L = [];
  L.push(`# Research brief: ${b.workingTitle}`, '');
  if (!b.usable) L.push('> **⛔ NOT USABLE FOR PUBLICATION.** See instructions below.', '');
  L.push(`Generated ${b.generated}`);
  L.push(`Covered by ${b.outletCount} outlets: ${b.outlets.join(', ')}`);
  if (b.games.length) L.push(`Games: ${b.games.join(', ')}`);
  L.push('');

  L.push('## Instructions to the writer', '');
  for (const g of b.guidance) L.push(`- ${g}`);
  L.push('');

  if (b.conflicts.length) {
    L.push('## ⚠ Conflicting figures — resolve before writing', '');
    for (const c of b.conflicts) {
      L.push(`- **${c.a.value}** (${c.a.outlets.join(', ')}) vs **${c.b.value}** (${c.b.outlets.join(', ')})`);
      L.push(`  - Context: "${c.sharedContext}"`);
      L.push(`  - ${c.instruction}`);
    }
    L.push('');
  }

  L.push('## Primary sources', '');
  if (b.sources.primary.length) {
    for (const s of b.sources.primary) L.push(`- [${s.title}](${s.url}) — ${s.host}`);
  } else {
    L.push('- **None found.** Locate one before writing, or attribute everything.');
  }
  L.push('');

  L.push('## Secondary reporting', '');
  for (const s of b.sources.secondary) L.push(`- [${s.title}](${s.url}) — ${s.outlet}`);
  L.push('');

  if (b.sources.unreadable.length) {
    L.push('## Could not be read (paywall, JS-rendered, or blocked)', '');
    for (const s of b.sources.unreadable) L.push(`- ${s.outlet}: ${s.url}`);
    L.push('');
  }

  L.push('## Corroborated facts', '');
  L.push('| Type | Value | Outlets | Primary? |');
  L.push('| --- | --- | --- | --- |');
  for (const f of b.facts.slice(0, 40)) {
    L.push(`| ${f.kind} | ${f.value.replace(/\|/g, '\\|')} | ${f.outlets.join(', ')} | ${f.hasPrimary ? 'yes' : 'no'} |`);
  }
  L.push('');

  if (b.singleSourced.length) {
    L.push('## Single-sourced — DO NOT state as fact', '');
    for (const f of b.singleSourced.slice(0, 20)) {
      L.push(`- ${f.value} — only ${f.outlets[0]}`);
    }
    L.push('');
  }

  if (b.ourData.length) {
    L.push('## Our own data (original, safe to cite as ours)', '');
    for (const d of b.ourData) {
      L.push(
        d.concurrent
          ? `- **${d.game}**: #${d.rank} on our Steam leaderboard, ${d.concurrent.toLocaleString()} concurrent, ${d.change24h ?? 'n/a'}% over 24h.`
          : `- **${d.game}**: ${d.note}`
      );
    }
    L.push('');
  }

  if (b.relatedPatchNotes.length) {
    L.push('## Related patch notes we track', '');
    for (const p of b.relatedPatchNotes) L.push(`- ${p.game}: [${p.title}](${p.url})`);
    L.push('');
  }

  L.push('## Supporting context (verbatim sentences)', '');
  for (const f of b.facts.slice(0, 18)) {
    L.push(`> ${f.context}`);
    L.push(`> — ${f.outlets.join(', ')}`, '');
  }

  return L.join('\n');
}

async function readJsonSafe(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

main().catch((err) => {
  console.error('Brief generation failed:', err);
  process.exit(1);
});
