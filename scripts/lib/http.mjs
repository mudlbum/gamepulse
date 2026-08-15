/**
 * Resilient HTTP helpers for the data pipeline.
 *
 * Design rules learned the hard way while researching these sources:
 *  - Never let one dead endpoint fail the whole build. Every fetch is
 *    individually recoverable and the caller decides what to do with a null.
 *  - A 200 with valid XML is NOT proof a feed is alive. Two of the feeds we
 *    evaluated (a Riot RSS mirror, a Genshin aggregator) return perfectly
 *    well-formed documents containing content from 2024, or nothing at all.
 *    Freshness is checked separately, in feed.mjs.
 */

export const UA =
  'GamePulseBot/1.0 (+https://github.com/; automated gaming data aggregator; contact via site)';

const DEFAULT_TIMEOUT = 20_000;

export function log(scope, ...args) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${scope.padEnd(12)} `, ...args);
}

export function warn(scope, ...args) {
  const ts = new Date().toISOString().slice(11, 19);
  console.warn(`[${ts}] ${scope.padEnd(12)} ⚠ `, ...args);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch with timeout, retries and exponential backoff.
 * Returns the Response, or null after exhausting retries.
 */
export async function request(url, opts = {}) {
  const {
    retries = 2,
    timeout = DEFAULT_TIMEOUT,
    headers = {},
    scope = 'http',
    ...rest
  } = opts;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        ...rest,
        signal: ctrl.signal,
        headers: { 'user-agent': UA, accept: '*/*', ...headers },
        redirect: 'follow',
      });
      clearTimeout(timer);

      if (res.ok) return res;

      /* 420 is speedrun.com's rate-limit status (100 req/min per IP). It is not
         429 and not in any RFC, so a generic "retry only on 429" rule treats it
         as fatal and silently drops the whole leaderboard. */
      if (res.status === 420) {
        warn(scope, `rate limited (420) on attempt ${attempt + 1}/${retries + 1} — backing off`);
        if (attempt < retries) await sleep(4000 * (attempt + 1));
        continue;
      }
      // 4xx other than 408/429 will not succeed on retry — bail immediately.
      if (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408) {
        warn(scope, `${res.status} ${res.statusText} — ${short(url)} (not retrying)`);
        return null;
      }
      warn(scope, `${res.status} on attempt ${attempt + 1}/${retries + 1} — ${short(url)}`);
    } catch (err) {
      clearTimeout(timer);
      const reason = err.name === 'AbortError' ? `timeout after ${timeout}ms` : err.message;
      warn(scope, `${reason} on attempt ${attempt + 1}/${retries + 1} — ${short(url)}`);
    }
    if (attempt < retries) await sleep(700 * Math.pow(2, attempt) + Math.random() * 300);
  }
  return null;
}

export async function getJson(url, opts = {}) {
  const res = await request(url, { headers: { accept: 'application/json' }, ...opts });
  if (!res) return null;
  try {
    return await res.json();
  } catch (err) {
    warn(opts.scope || 'http', `invalid JSON from ${short(url)}: ${err.message}`);
    return null;
  }
}

export async function getText(url, opts = {}) {
  const res = await request(url, opts);
  if (!res) return null;
  try {
    return await res.text();
  } catch (err) {
    warn(opts.scope || 'http', `body read failed for ${short(url)}: ${err.message}`);
    return null;
  }
}

/** Run tasks with bounded concurrency so we do not hammer any one host. */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = null;
      }
    }
  });
  await Promise.all(runners);
  return results;
}

function short(url) {
  try {
    const u = new URL(url);
    return u.host + u.pathname.slice(0, 48);
  } catch {
    return String(url).slice(0, 64);
  }
}

/** Strip HTML/BBCode down to readable plain text and clamp the length. */
export function toPlainText(input, maxLen = 400) {
  if (!input) return '';
  let s = String(input)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    // Steam news uses BBCode rather than HTML.
    .replace(/\[\/?[a-z0-9=*_\-.:/? ]+\]/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > maxLen) {
    s = s.slice(0, maxLen);
    const cut = s.lastIndexOf(' ');
    if (cut > maxLen * 0.6) s = s.slice(0, cut);
    s += '…';
  }
  return s;
}

export function slugify(str) {
  return (
    String(str)
      .toLowerCase()
      /* NFD splits accented Latin into base + combining mark so the marks can
         be dropped. It also decomposes Hangul syllables into conjoining jamo,
         which is why NFC has to put them back — an NFKD-then-strip approach
         silently destroys Korean titles. */
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .normalize('NFC')
      // Keep letters (any script), numbers, whitespace and hyphens.
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80)
  );
}
