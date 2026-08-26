import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { SITE } from '../../config';
import type { APIContext } from 'astro';

// @astrojs/rss resolves each item link against `site` and never against
// `base`, so a root-relative link publishes https://<host>/posts/... and
// 404s on a project page. Prefix it ourselves.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export async function GET(context: APIContext) {
  const posts = (await getCollection('posts', (p: any) => p.data.lang === 'ko' && !p.data.draft)).sort(
    (a: any, b: any) => new Date(b.data.pubDate).getTime() - new Date(a.data.pubDate).getTime()
  );

  return rss({
    title: `${SITE.name} — ${SITE.tagline.ko}`,
    description: SITE.description.ko,
    // The channel link is the feed's idea of "the site". Left as bare
    // `site` it points at the domain root rather than the project page.
    site: new URL(`${BASE}/`, context.site ?? SITE.url).href,
    trailingSlash: false,
    items: posts.map((post: any) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: new Date(post.data.pubDate),
      link: `${BASE}/ko/posts/${String(post.id).replace(/^ko\//, '')}`,
      categories: [post.data.category, ...(post.data.games ?? [])],
      author: post.data.author,
    })),
    customData: `<language>ko-KR</language><ttl>60</ttl>`,
  });
}
