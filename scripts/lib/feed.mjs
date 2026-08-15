/**
 * Feed parsing + health checking.
 *
 * The health check is the important part. During source research we found two
 * feeds that respond 200 with structurally valid XML but serve content from
 * 2024, and one that returns a valid RSS document with zero items. A naive
 * "status === 200" check ingests all three happily. So: every feed is judged
 * on the age of its newest item, and stale feeds are reported, not silently
 * merged into the site.
 */
import { XMLParser } from 'fast-xml-parser';
import { getText, warn, log, toPlainText } from './http.mjs';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  // Anything that can legally repeat must always be an array, or a
  // single-item feed silently becomes an object and breaks .map().
  isArray: (name) => ['item', 'entry', 'link', 'category', 'media:content'].includes(name),
});

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const txt = (v) => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v['#text'] ?? v['@_href'] ?? '';
  return String(v);
};

/**
 * Fetch and normalise an RSS 2.0 / RSS 1.0 (RDF) / Atom feed.
 * Returns { ok, items, staleDays, error }.
 */
export async function fetchFeed(url, { scope = 'feed', maxAgeDays = 21, limit = 30 } = {}) {
  const xml = await getText(url, { scope, headers: { accept: 'application/rss+xml, application/xml, text/xml, */*' } });
  if (!xml) return { ok: false, items: [], error: 'unreachable' };

  let doc;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    warn(scope, `XML parse failed for ${url}: ${err.message}`);
    return { ok: false, items: [], error: 'unparseable' };
  }

  // RSS 2.0 | RSS 1.0/RDF | Atom
  const channel = doc?.rss?.channel ?? doc?.['rdf:RDF'] ?? doc?.feed ?? null;
  if (!channel) return { ok: false, items: [], error: 'no-channel' };

  const rawItems = arr(channel.item ?? channel.entry ?? doc?.['rdf:RDF']?.item);
  if (!rawItems.length) {
    warn(scope, `feed has ZERO items (valid XML, no content): ${url}`);
    return { ok: false, items: [], error: 'empty' };
  }

  const sourceTitle = toPlainText(txt(channel.title), 80);

  const items = rawItems
    .map((it) => {
      /* Link extraction has to cope with three shapes at once:
         RSS 2.0  -> <link>https://…</link>            (plain string)
         Atom     -> <link rel="alternate" href="…"/>  (attributes only)
         RSS 1.0  -> <link>https://…</link>            (string, but rdf:about too)
         Because `link` is forced into an array by isArray (Atom entries can
         carry several), a plain RSS string arrives as ['https://…'] — which is
         an object to typeof, so it must be unwrapped before reading @_href. */
      let link = '';
      const rawLink = it.link;
      if (typeof rawLink === 'string') {
        link = rawLink;
      } else if (Array.isArray(rawLink)) {
        const stringLink = rawLink.find((l) => typeof l === 'string' && l.trim());
        if (stringLink) {
          link = stringLink;
        } else {
          const alt =
            rawLink.find((l) => l && typeof l === 'object' && l['@_rel'] === 'alternate') ??
            rawLink.find((l) => l && typeof l === 'object' && !l['@_rel']) ??
            rawLink[0];
          link = alt?.['@_href'] ?? alt?.['#text'] ?? '';
        }
      } else if (rawLink && typeof rawLink === 'object') {
        link = rawLink['@_href'] ?? rawLink['#text'] ?? '';
      }
      if (!link) link = txt(it.guid) || txt(it['@_rdf:about']) || '';
      link = String(link).trim();

      const dateStr =
        txt(it.pubDate) || txt(it.published) || txt(it.updated) || txt(it['dc:date']) || '';
      const date = dateStr ? new Date(dateStr) : null;

      const body =
        txt(it['content:encoded']) || txt(it.content) || txt(it.description) || txt(it.summary) || '';

      // Look for a usable image in the common syndication extensions.
      let image =
        it['media:thumbnail']?.['@_url'] ||
        arr(it['media:content']).find((m) => (m?.['@_medium'] ?? m?.['@_type'] ?? '').includes('image'))?.['@_url'] ||
        (it.enclosure?.['@_type']?.startsWith('image') ? it.enclosure['@_url'] : null) ||
        null;
      if (!image) {
        const m = body.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (m) image = m[1];
      }

      return {
        title: toPlainText(txt(it.title), 160),
        link,
        date: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
        summary: toPlainText(body, 260),
        image,
        author: toPlainText(txt(it['dc:creator']) || txt(it.author?.name) || txt(it.author), 60) || null,
        categories: arr(it.category).map((c) => toPlainText(txt(c), 40)).filter(Boolean).slice(0, 5),
        source: sourceTitle,
      };
    })
    .filter((i) => i.title && i.link)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, limit);

  if (!items.length) return { ok: false, items: [], error: 'no-valid-items' };

  // --- Freshness gate ---
  const newest = items.find((i) => i.date)?.date;
  if (!newest) {
    warn(scope, `no parseable dates in ${url} — accepting but cannot verify freshness`);
    return { ok: true, items, staleDays: null, unverifiedAge: true };
  }
  const staleDays = (Date.now() - new Date(newest).getTime()) / 86_400_000;
  if (staleDays > maxAgeDays) {
    warn(
      scope,
      `STALE feed rejected — newest item is ${staleDays.toFixed(0)} days old (limit ${maxAgeDays}): ${url}`
    );
    return { ok: false, items, staleDays, error: 'stale' };
  }

  return { ok: true, items, staleDays };
}

/** Extract a YouTube video id from a watch/short/embed URL. */
export function youTubeId(url) {
  if (!url) return null;
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

/**
 * YouTube channel feeds are plain Atom, but they carry a media:group with
 * a view counter — which is what makes velocity ranking possible without
 * the Data API and a key.
 */
export async function fetchYouTubeChannel(channelId, meta = {}) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const xml = await getText(url, { scope: 'youtube', retries: 1 });
  if (!xml) return [];

  let doc;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }
  const entries = arr(doc?.feed?.entry);
  if (!entries.length) return [];

  const channelTitle = toPlainText(txt(doc.feed.title), 60) || meta.name || '';

  return entries
    .map((e) => {
      const group = e['media:group'] ?? {};
      const community = group['media:community'] ?? {};
      const views = Number(community['media:statistics']?.['@_views'] ?? 0);
      const rating = community['media:starRating'] ?? {};
      const videoId = txt(e['yt:videoId']);
      const published = txt(e.published);
      const pubMs = published ? new Date(published).getTime() : 0;
      if (!videoId || !pubMs) return null;

      const ageHours = Math.max(1, (Date.now() - pubMs) / 3_600_000);

      return {
        videoId,
        title: toPlainText(txt(group['media:title']) || txt(e.title), 140),
        url: `https://www.youtube.com/watch?v=${videoId}`,
        channelId,
        channel: channelTitle,
        channelUrl: `https://www.youtube.com/channel/${channelId}`,
        published: new Date(pubMs).toISOString(),
        ageHours: Math.round(ageHours * 10) / 10,
        views,
        // Views per hour since upload. Far better than raw views at surfacing
        // something posted 6 hours ago that is genuinely taking off.
        velocity: Math.round(views / ageHours),
        likes: Number(rating['@_count'] ?? 0) || null,
        thumb: group['media:thumbnail']?.['@_url'] ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        description: toPlainText(txt(group['media:description']), 200),
        tags: meta.tags ?? [],
      };
    })
    .filter(Boolean);
}

export { log, warn };
