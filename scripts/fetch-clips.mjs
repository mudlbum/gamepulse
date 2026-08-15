/**
 * Trending highlight clips.
 *
 * YouTube's per-channel Atom feed embeds a view counter inside media:group,
 * which means we can compute views-per-hour with no API key at all. Ranking on
 * velocity rather than raw views is what surfaces a clip that went up six
 * hours ago and is genuinely exploding, instead of permanently showing the
 * same 40-million-view video from two years back.
 */
import { fetchYouTubeChannel } from './lib/feed.mjs';
import { pool, log, warn } from './lib/http.mjs';
import { YOUTUBE_CHANNELS } from './lib/sources.mjs';

const MAX_AGE_HOURS = 24 * 7;
const MIN_VIEWS = 2_000;

export async function fetchClips() {
  const scope = 'clips';

  const perChannel = await pool(YOUTUBE_CHANNELS, 5, async (ch) => {
    const videos = await fetchYouTubeChannel(ch.id, ch);
    if (!videos.length) warn(scope, `no entries for ${ch.name} (${ch.id})`);
    return videos.map((v) => ({ ...v, channelTags: ch.tags }));
  });

  const all = perChannel.flat().filter(Boolean);
  if (!all.length) {
    warn(scope, 'every YouTube feed came back empty');
    return null;
  }

  const fresh = all.filter((v) => v.ageHours <= MAX_AGE_HOURS && v.views >= MIN_VIEWS);

  // Cap each channel's share so one high-volume publisher (IGN posts dozens of
  // clips a day) cannot monopolise the grid.
  const trending = capPerChannel(
    [...fresh].sort((a, b) => b.velocity - a.velocity),
    3,
    24
  );

  const byTag = {};
  for (const tag of ['esports', 'viral', 'news']) {
    byTag[tag] = capPerChannel(
      fresh.filter((v) => v.channelTags?.includes(tag)).sort((a, b) => b.velocity - a.velocity),
      2,
      8
    );
  }

  const breakout = fresh
    .filter((v) => v.ageHours <= 30)
    .sort((a, b) => b.velocity - a.velocity)
    .slice(0, 6);

  log(scope, `${all.length} videos scanned, ${fresh.length} fresh, top velocity ${trending[0]?.velocity?.toLocaleString()}/hr`);

  return {
    updated: new Date().toISOString(),
    source: 'YouTube channel Atom feeds (public, no key)',
    method: 'Ranked by views per hour since upload, not cumulative views.',
    channelCount: YOUTUBE_CHANNELS.length,
    scanned: all.length,
    trending,
    breakout,
    byTag,
  };
}

function capPerChannel(sorted, perChannel, total) {
  const seen = new Map();
  const out = [];
  for (const v of sorted) {
    const n = seen.get(v.channelId) ?? 0;
    if (n >= perChannel) continue;
    seen.set(v.channelId, n + 1);
    out.push(v);
    if (out.length >= total) break;
  }
  return out;
}
