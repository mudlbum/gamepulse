/**
 * News aggregation + story clustering.
 *
 * Beyond building the news river, this clusters headlines across outlets. When
 * eight publications write about the same thing inside a few hours, that is a
 * far better signal of what actually matters than any single feed — and the
 * clusters become the research briefs the article writer works from, with
 * multiple independent sources attached to each one by construction.
 */
import { pool, log, warn } from './lib/http.mjs';
import { fetchFeed } from './lib/feed.mjs';
import { NEWS_FEEDS } from './lib/sources.mjs';

const STOP = new Set(
  ('a an the and or but of for to in on at by with from as is are was were be been will would can could ' +
    'this that these those it its new now get gets got has have had you your we our they their he she ' +
    'about after all also how into more most out over said says say than then there what when where which ' +
    'who why more just like some out up down off game games gaming video review preview trailer news best top')
    .split(' ')
);

export async function fetchNews() {
  const scope = 'news';
  const out = { updated: new Date().toISOString(), feeds: {}, health: [] };

  for (const [lang, feeds] of Object.entries(NEWS_FEEDS)) {
    const results = await pool(feeds, 5, async (f) => {
      const res = await fetchFeed(f.url, { scope, maxAgeDays: 10, limit: 25 });
      out.health.push({
        lang,
        name: f.name,
        url: f.url,
        ok: res.ok,
        error: res.error ?? null,
        staleDays: res.staleDays == null ? null : Math.round(res.staleDays * 10) / 10,
        items: res.items?.length ?? 0,
      });
      if (!res.ok) return [];
      return res.items.map((i) => ({ ...i, outlet: f.name, weight: f.weight ?? 1, official: !!f.official }));
    });

    const items = results
      .flat()
      .filter((i) => i.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    /* Cluster on the FULL list, dedupe only for the display river.
       Deduping first would delete the evidence clustering depends on: when
       three outlets run the identical wire headline, a global title-dedupe
       leaves one copy, the cluster reports a single outlet, and the
       "covered by 2+ outlets" filter throws away the biggest story of the day. */
    const clusters = clusterStories(items, lang);
    const deduped = dedupe(items);

    out.feeds[lang] = {
      latest: deduped.slice(0, 60),
      clusters: clusters.slice(0, 20),
      outlets: [...new Set(deduped.map((i) => i.outlet))],
    };

    const healthy = out.health.filter((h) => h.lang === lang && h.ok).length;
    log(scope, `${lang}: ${healthy}/${feeds.length} feeds healthy · ${deduped.length} items · ${clusters.length} clusters`);
  }

  const dead = out.health.filter((h) => !h.ok);
  if (dead.length) warn(scope, `unhealthy feeds: ${dead.map((d) => `${d.name}(${d.error})`).join(', ')}`);

  return out;
}

/** Drop the same story republished under a near-identical headline. */
function dedupe(items) {
  const seen = new Map();
  const out = [];
  for (const item of items) {
    const key = normalise(item.title).slice(0, 60);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.set(key, true);
    out.push(item);
  }
  return out;
}

/**
 * Greedy single-pass clustering on shared significant tokens. Cheap, and good
 * enough: headlines about the same event reliably share proper nouns.
 */
function clusterStories(items, lang) {
  const recent = items.filter((i) => Date.now() - new Date(i.date).getTime() < 72 * 3600_000);
  const withTokens = recent.map((i) => ({ item: i, tokens: tokenise(i.title, lang) }));
  const clusters = [];

  for (const { item, tokens } of withTokens) {
    if (tokens.size < 2) continue;
    let best = null;
    let bestScore = 0;

    for (const c of clusters) {
      /* Score against each existing MEMBER and take the best match, rather
         than against the cluster's accumulated token union. Comparing to the
         union means every article that joins dilutes the set, so the third
         and fourth outlet covering a story get progressively less likely to
         be recognised as covering it — the opposite of what should happen. */
      let localBest = 0;
      for (const memberTokens of c.memberTokens) {
        const s = overlap(tokens, memberTokens);
        if (s > localBest) localBest = s;
      }
      if (localBest > bestScore) {
        bestScore = localBest;
        best = c;
      }
    }

    if (best && bestScore >= SIM_THRESHOLD) {
      best.items.push(item);
      best.memberTokens.push(tokens);
      for (const t of tokens) best.tokens.add(t);
    } else {
      clusters.push({ tokens: new Set(tokens), memberTokens: [tokens], items: [item] });
    }
  }

  return clusters
    .map((c) => {
      // One outlet republishing itself must not inflate the coverage count.
      const seenPerOutlet = new Set();
      c.items = c.items.filter((i) => {
        const key = `${i.outlet}::${normalise(i.title).slice(0, 60)}`;
        if (seenPerOutlet.has(key)) return false;
        seenPerOutlet.add(key);
        return true;
      });
      const outlets = [...new Set(c.items.map((i) => i.outlet))];
      const newest = c.items.reduce((a, b) => (new Date(a.date) > new Date(b.date) ? a : b));
      const hoursOld = (Date.now() - new Date(newest.date).getTime()) / 3600_000;
      // Recency-decayed heat: coverage breadth matters, but a 4-hour-old story
      // covered by five outlets should outrank a 60-hour-old one covered by six.
      const heat = outlets.length * 10 * Math.exp(-hoursOld / 30) + c.items.length;
      return {
        headline: newest.title,
        image: c.items.find((i) => i.image)?.image ?? null,
        summary: c.items.find((i) => i.summary)?.summary ?? '',
        outletCount: outlets.length,
        outlets,
        heat: Math.round(heat * 10) / 10,
        newest: newest.date,
        keywords: [...c.tokens].slice(0, 8),
        articles: c.items
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .slice(0, 8)
          .map((i) => ({ title: i.title, url: i.link, outlet: i.outlet, date: i.date, official: i.official })),
      };
    })
    .filter((c) => c.outletCount >= 2)
    .sort((a, b) => b.heat - a.heat);
}

function normalise(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenise(title, lang) {
  const norm = normalise(title);
  if (lang === 'ko') {
    // Korean is not space-delimited in a way that maps onto words, so use
    // Hangul character bigrams plus any latin/numeric tokens (game titles,
    // version numbers) that appear alongside them.
    const hangul = norm.replace(/[^가-힣]/g, '');
    const grams = new Set();
    for (let i = 0; i < hangul.length - 1; i++) grams.add(hangul.slice(i, i + 2));
    for (const w of norm.split(' ')) if (keepToken(w)) grams.add(w);
    return grams;
  }
  return new Set(norm.split(' ').filter(keepToken));
}

/**
 * Numbers carry a lot of signal in gaming headlines — "Switch 2", "GTA 6",
 * "Season 5", "$50", "patch 26.16" — so short numeric tokens are kept even
 * though short alphabetic ones are dropped. Bare four-digit years are the
 * exception: they appear in everything and cluster unrelated round-ups.
 */
function keepToken(w) {
  if (!w || STOP.has(w)) return false;
  if (/^\d+$/.test(w)) return !(w.length === 4 && Number(w) >= 1970 && Number(w) <= 2100);
  return w.length > 2;
}

const SIM_THRESHOLD = 0.35;
const MIN_SHARED = 2;

/**
 * Szymkiewicz–Simpson overlap coefficient: intersection over the SMALLER set.
 * Jaccard punishes a terse headline for being paired with a verbose one even
 * when the terse one is fully contained in it, which is common between a wire
 * headline and a feature headline about the same event.
 */
function overlap(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  if (inter < MIN_SHARED) return 0;
  return inter / Math.min(a.size, b.size);
}
