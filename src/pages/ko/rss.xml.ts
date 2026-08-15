import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { SITE } from '../../config';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = (await getCollection('posts', (p: any) => p.data.lang === 'ko' && !p.data.draft)).sort(
    (a: any, b: any) => new Date(b.data.pubDate).getTime() - new Date(a.data.pubDate).getTime()
  );

  return rss({
    title: `${SITE.name} — ${SITE.tagline.ko}`,
    description: SITE.description.ko,
    site: context.site ?? SITE.url,
    trailingSlash: false,
    items: posts.map((post: any) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: new Date(post.data.pubDate),
      link: `/ko/posts/${String(post.id).replace(/^ko\//, '')}`,
      categories: [post.data.category, ...(post.data.games ?? [])],
      author: post.data.author,
    })),
    customData: `<language>ko-KR</language><ttl>60</ttl>`,
  });
}
