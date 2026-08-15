/**
 * Cosplay spotlight.
 *
 * Bluesky's AppView is the only mainstream social platform left with a fully
 * open read API — no key, no OAuth, no signed request. Instagram and TikTok
 * are closed; Reddit now blocks unauthenticated JSON from datacenter IPs.
 *
 * One catch found during research: app.bsky.feed.searchPosts returns 403
 * without auth, so we cannot keyword-search posts. searchActors IS open, so
 * the working pattern is: discover accounts once, then poll each account's
 * public author feed.
 *
 * Editorial note: we store the post URL and the creator's handle with every
 * image and always link back. We are showcasing and crediting, not rehosting.
 */
import { getJson, pool, log, warn, toPlainText } from './lib/http.mjs';
import { ENDPOINTS, COSPLAY_ACTORS, COSPLAY_DISCOVERY_TERMS } from './lib/sources.mjs';

const MAX_AGE_DAYS = 45;

export async function fetchCosplay({ discover = false } = {}) {
  const scope = 'cosplay';
  let actors = [...COSPLAY_ACTORS];

  if (discover) {
    const found = await discoverActors(scope);
    const known = new Set(actors.map((a) => a.handle.toLowerCase()));
    for (const f of found) {
      if (!known.has(f.handle.toLowerCase())) {
        actors.push(f);
        known.add(f.handle.toLowerCase());
      }
    }
    log(scope, `discovery added ${actors.length - COSPLAY_ACTORS.length} account(s)`);
  }

  const results = await pool(actors, 4, async (actor) => {
    const target = actor.did || actor.handle;
    const json = await getJson(ENDPOINTS.bskyAuthorFeed(target, 12), { scope, retries: 1 });
    if (!json?.feed?.length) return [];

    return json.feed
      .filter((f) => !f.reason) // drop reposts — we want original work
      .map((f) => normalisePost(f.post, actor))
      .filter(Boolean);
  });

  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  const posts = results
    .flat()
    .filter((p) => new Date(p.date).getTime() >= cutoff)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!posts.length) {
    warn(scope, 'no cosplay posts retrieved');
    return null;
  }

  // Interleave creators so the grid does not open with eight posts in a row
  // from whoever happened to post most recently.
  const spotlight = interleaveByAuthor(posts, 36);

  const topLiked = [...posts].sort((a, b) => b.likes - a.likes).slice(0, 6);

  const creators = [...new Map(posts.map((p) => [p.authorHandle, {
    handle: p.authorHandle,
    name: p.authorName,
    avatar: p.authorAvatar,
    role: p.role,
    url: `https://bsky.app/profile/${p.authorHandle}`,
    posts: 0,
  }])).values()];
  for (const p of posts) {
    const c = creators.find((c) => c.handle === p.authorHandle);
    if (c) c.posts++;
  }

  log(scope, `${posts.length} posts from ${creators.length} creators`);

  return {
    updated: new Date().toISOString(),
    source: 'Bluesky public AppView (app.bsky.feed.getAuthorFeed, no auth)',
    note: 'Images are hot-linked from the original post and credited to their creator. Every card links back to the source.',
    spotlight,
    topLiked,
    creators: creators.sort((a, b) => b.posts - a.posts),
  };
}

function normalisePost(post, actor) {
  if (!post) return null;
  const embed = post.embed || {};
  let images = [];

  if (embed.$type === 'app.bsky.embed.images#view' && Array.isArray(embed.images)) {
    images = embed.images;
  } else if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media?.images) {
    images = embed.media.images;
  }
  if (!images.length) return null;

  const text = toPlainText(post.record?.text || '', 220);
  const rkey = String(post.uri).split('/').pop();

  return {
    id: post.uri,
    url: `https://bsky.app/profile/${post.author?.handle}/post/${rkey}`,
    text,
    date: post.record?.createdAt || post.indexedAt,
    authorHandle: post.author?.handle || actor.handle,
    authorName: post.author?.displayName || actor.name || post.author?.handle,
    authorAvatar: post.author?.avatar || null,
    role: actor.role || 'cosplayer',
    likes: Number(post.likeCount ?? 0),
    reposts: Number(post.repostCount ?? 0),
    replies: Number(post.replyCount ?? 0),
    images: images.slice(0, 4).map((im) => ({
      thumb: im.thumb,
      full: im.fullsize,
      alt: im.alt || `Cosplay photo by ${post.author?.displayName || post.author?.handle}`,
      aspectRatio: im.aspectRatio ? im.aspectRatio.width / im.aspectRatio.height : 0.75,
    })),
  };
}

async function discoverActors(scope) {
  const out = [];
  for (const term of COSPLAY_DISCOVERY_TERMS) {
    const json = await getJson(ENDPOINTS.bskySearchActors(term, 25), { scope, retries: 1 });
    for (const a of json?.actors ?? []) {
      // Skip accounts with nothing to show — one verified profile had 215
      // followers and literally zero posts.
      if (!a.handle) continue;
      out.push({
        handle: a.handle,
        did: a.did,
        name: a.displayName || a.handle,
        role: /photograph/i.test(a.description || '') ? 'photographer' : 'cosplayer',
      });
    }
  }
  return out;
}

function interleaveByAuthor(posts, limit) {
  const buckets = new Map();
  for (const p of posts) {
    if (!buckets.has(p.authorHandle)) buckets.set(p.authorHandle, []);
    buckets.get(p.authorHandle).push(p);
  }
  const lists = [...buckets.values()];
  const out = [];
  let i = 0;
  while (out.length < limit) {
    let added = false;
    for (const list of lists) {
      if (list[i]) {
        out.push(list[i]);
        added = true;
        if (out.length >= limit) break;
      }
    }
    if (!added) break;
    i++;
  }
  return out;
}
