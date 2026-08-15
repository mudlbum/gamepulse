import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { SITE } from '../config';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = (await getCollection('posts', (p: any) => p.data.lang === 'en' && !p.data.draft)).sort(
    (a: any, b: any) => new Date(b.data.pubDate).getTime() - new Date(a.data.pubDate).getTime()
  );

  return rss({
    title: `${SITE.name} — ${SITE.tagline.en}`,
    description: SITE.description.en,
    site: context.site ?? SITE.url,
    trailingSlash: false,
    items: posts.map((post: any) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: new Date(post.data.pubDate),
      link: `/posts/${String(post.id).replace(/^en\//, '')}`,
      categories: [post.data.category, ...(post.data.games ?? [])],
      author: post.data.author,
      customData: post.data.updatedDate
        ? `<atom:updated>${new Date(post.data.updatedDate).toISOString()}</atom:updated>`
        : undefined,
    })),
    xmlns: { atom: 'http://www.w3.org/2005/Atom' },
    customData: `<language>en-US</language><ttl>60</ttl>`,
  });
}
