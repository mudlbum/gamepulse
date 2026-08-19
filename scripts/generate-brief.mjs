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
import { fileURLToPath, pathToFileURL } from 'node:url';
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

    log('brief', `${base} — ${brief.factCount} corroborated, ${brief.evidenceCount} total claims, ${brief.conflicts.length} conflicts`);
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
    /* Name the hosts. Most outlets block unknown user agents or paywall the
       body, and when that happens there is nothing to cross-check facts
       against no matter how many outlets covered the story. Knowing WHICH
       hosts refuse is the difference between fixing this and guessing at it.
       We do not spoof a browser UA to get around it — a publisher blocking
       bots has made a decision we respect. */
    const refused = fetched
      .filter((f) => f && (!f.ok || f.text.length <= 250))
      .map((f) => `${safeHost(f.url)}${f.ok ? ' (too short)' : ' (unreachable)'}`);
    warn('brief', `${refused.length}/${fetched.length} sources unreadable for "${cluster.headline.slice(0, 50)}" — ${refused.join(', ')}`);
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

  const { facts, conflicts, singleSourced, factCount, evidenceCount } = reconcile(claims);

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
    sourceCount: fetched.length,
    games,
    sources: {
      primary: primary.map(pickMeta),
      secondary: secondary.map(pickMeta),
      unreadable: fetched.filter((f) => f && !f.ok).map(pickMeta),
    },
    facts,
    conflicts,
    singleSourced,
    /* Counted before facts/singleSourced were sliced for readability. The
       publish gate reads these two numbers and nothing else about volume:
       factCount is what two outlets agree on, evidenceCount is every specific
       claim the sources made. A story can be well evidenced and still poorly
       corroborated; those are different failures and the gate reports them
       separately. */
    factCount,
    evidenceCount,
    ourData,
    relatedPatchNotes: relatedPatch.map((g) => ({ game: g.game, title: g.latest?.title, url: g.latest?.url })),
    usable: usable.length > 0 && factCount >= 2 && evidenceCount >= 8,
    guidance: buildGuidance(primary.length, conflicts.length, singleSourced.length, factCount, usable.length),
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
 * Group claims into equivalence classes and decide what is corroborated, what
 * is contested, and what rests on a single outlet.
 *
 * Corroboration used to require two outlets to produce a CHARACTER-IDENTICAL
 * extracted value. Four consecutive nights of "0 corroborated facts" on stories
 * that eight outlets had covered showed why that fails. The claims were there —
 * 12 on the GTA 6 leak, 17 on the Warren Spector retirement — but no two
 * outlets phrase one the same way. "November 19, 2026" and "19 November 2026"
 * are the same day. Two outlets quoting the same sentence trim it differently.
 * Exact string equality scored every one of those as disagreement, which is not
 * corroboration failing — it is the comparison being wrong.
 *
 * Each kind is now compared on its own terms: dates by the day they denote,
 * figures by the quantity they denote, quotes by whether they are the same
 * sentence. The bar for what counts as evidence is unchanged; the measurement
 * is fixed.
 */
function reconcile(claims) {
  /** Equivalence classes. O(n²) over ≤200 claims — small enough not to care. */
  const buckets = [];
  for (const c of claims) {
    const key = canonical(c);
    let bucket = buckets.find((b) => b.kind === c.kind && sameClaim(b, key));
    if (!bucket) {
      bucket = { kind: c.kind, key, items: [] };
      buckets.push(bucket);
    }
    bucket.items.push(c);
  }

  const facts = [];
  const singleSourced = [];

  for (const bucket of buckets) {
    const group = bucket.items;
    const outlets = [...new Set(group.map((g) => g.outlet))];
    const hasPrimary = group.some((g) => g.isPrimary);
    /* Show the longest variant. When three outlets quote the same sentence at
       different lengths, the fullest one is the most useful to a writer. */
    const best = group.reduce((a, b) => (b.value.length > a.value.length ? b : a));
    const entry = {
      kind: bucket.kind,
      key: bucket.key,
      value: best.value,
      outlets,
      hasPrimary,
      corroboration: outlets.length,
      context: best.context,
      urls: [...new Set(group.map((g) => g.url))].slice(0, 4),
    };
    if (outlets.length >= 2 || hasPrimary) facts.push(entry);
    else singleSourced.push(entry);
  }

  facts.sort((a, b) => Number(b.hasPrimary) - Number(a.hasPrimary) || b.corroboration - a.corroboration);

  // Conflicts: the same measure appearing in near-identical sentences with
  // different values. Catches "3.82 million" vs "3.8 million" vs "4 million".
  const conflicts = [];
  const numeric = facts.filter((f) => f.kind === 'figure' || f.kind === 'percent');
  for (let i = 0; i < numeric.length; i++) {
    for (let j = i + 1; j < numeric.length; j++) {
      const a = numeric[i];
      const b = numeric[j];
      if (a.key === b.key) continue;
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

  /* Counted BEFORE the slices below. The publish gate reads these, and a brief
     with 80 facts must not be reported as having 60. */
  const factCount = facts.length;
  const evidenceCount = facts.length + singleSourced.length;

  return {
    facts: facts.slice(0, 60),
    conflicts: conflicts.slice(0, 20),
    singleSourced: singleSourced.slice(0, 30),
    factCount,
    evidenceCount,
  };
}

/** Two claims of the same kind are the same claim if their canonical forms
    match, or — for quotes, where trimming differs outlet to outlet — if they
    are recognisably the same sentence. */
function sameClaim(bucket, key) {
  if (bucket.key === key) return true;
  if (bucket.kind !== 'quote') return false;
  return sameQuote(bucket.key, key);
}

/** Canonical form: what the claim MEANS, stripped of how it was written. */
function canonical(c) {
  switch (c.kind) {
    case 'date': return canonicalDate(c.value) ?? normValue(c.value);
    case 'figure': return canonicalFigure(c.value);
    case 'percent': return canonicalPercent(c.value);
    case 'version': return canonicalVersion(c.value);
    case 'quote': return normQuote(c.value);
    default: return normValue(c.value);
  }
}

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

/** "November 19, 2026" and "19 November 2026" are the same day. */
function canonicalDate(v) {
  const s = String(v).toLowerCase();
  const month = MONTHS.findIndex((m) => s.includes(m));
  if (month < 0) return null;
  const nums = s.replace(MONTHS[month], ' ').match(/\d+/g) || [];
  const day = nums.find((n) => Number(n) >= 1 && Number(n) <= 31 && n.length <= 2);
  const year = nums.find((n) => n.length === 4);
  if (!day || !year) return null;
  return `d:${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const SCALES = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };

/** "3.8 million copies", "3,800,000 copies" and "$3.8m" all denote one number. */
function canonicalFigure(v) {
  const s = String(v).toLowerCase().replace(/,/g, '');
  const currency = /\$|usd|£|€/.test(s) ? 'cur' : 'n';
  const num = parseFloat((s.match(/[\d.]+/) || ['0'])[0]);
  const scaleWord = Object.keys(SCALES).find((k) => new RegExp(`[\\d.]\\s?${k}\\b`).test(s));
  const value = num * (scaleWord ? SCALES[scaleWord] : 1);
  const noun = (s.match(/\b(units|copies|players|users|subscribers|downloads|concurrent)\b/) || [''])[0];
  // Round to 3 significant figures: "3.82 million" and "3.8 million" are the
  // same claim reported at different precision, not two different claims.
  const rounded = value === 0 ? 0 : Number(value.toPrecision(3));
  return `f:${currency}:${rounded}${noun ? ':' + noun : ''}`;
}

const UP = /\b(up|rose|grew|increased|increase|rise|growth)\b/;
const DOWN = /\b(down|fell|declined|decreased|decrease|drop|decline)\b/;

/** "up 12%", "increased by 12%" and "12% increase" are one claim. */
function canonicalPercent(v) {
  const s = String(v).toLowerCase();
  const num = parseFloat((s.match(/[\d.]+/) || ['0'])[0]);
  const dir = UP.test(s) ? 'up' : DOWN.test(s) ? 'down' : '?';
  return `p:${dir}:${Number(num.toPrecision(3))}`;
}

/** "patch 7.0.0", "update 7.0.0" and "version 7.0.0" name the same build.
    "season 7" does not — a season is a different kind of thing. */
function canonicalVersion(v) {
  const s = String(v).toLowerCase().trim();
  const num = (s.match(/[\d][\d.\w]*/) || [''])[0].replace(/\.+$/, '');
  const family = /^season/.test(s) ? 'season' : 'build';
  return `v:${family}:${num}`;
}

function normQuote(v) {
  return String(v).toLowerCase().replace(/[^a-z0-9가-힣\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Two quotes are the same quote if one is contained in the other, or if they
 * share most of their substantive words. Outlets routinely clip the same
 * sentence at different points; that is one fact reported twice, not two.
 */
function sameQuote(a, b) {
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 25) return false;
  if (long.includes(short)) return true;
  const words = (s) => new Set(s.split(' ').filter((w) => w.length > 3));
  const A = words(short);
  const B = words(long);
  if (A.size < 4) return false;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / A.size >= 0.7;
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

/* Exported so the corroboration logic can be tested without a network. The
   four nights of "0 corroborated facts" happened in a function no test ever
   called; that is not a coincidence worth repeating. */
export {
  reconcile,
  canonical,
  sameQuote,
  canonicalDate,
  canonicalFigure,
  canonicalPercent,
  canonicalVersion,
  extractClaims,
  extractReadable,
};

/* Only run the pipeline when invoked directly, so importing this module for
   tests does not go and fetch six news articles. */
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('Brief generation failed:', err);
    process.exit(1);
  });
}
