import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const sourceSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  publisher: z.string().optional(),
  accessed: z.string().optional(),
});

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().max(120),
      /* Editorial headlines run long because they read better on the page.
         Google truncates the <title> around 60 characters, so a long headline
         gets cut mid-clause in search results. seoTitle carries a short version
         for <title> and OG; the page still shows the full headline as its H1. */
      seoTitle: z.string().max(65).optional(),
      description: z.string().min(50).max(300),
      lang: z.enum(['en', 'ko']),
      // Ties an EN post to its KO counterpart for hreflang + language switching.
      translationKey: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      category: z.enum([
        'news',
        'guide',
        'review',
        'opinion',
        'esports',
        'patch-notes',
        'hardware',
        'mobile',
        'console',
        'pc',
      ]),
      platforms: z.array(z.enum(['pc', 'playstation', 'xbox', 'switch', 'mobile', 'vr'])).default([]),
      games: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
      heroImage: image().optional(),
      heroImageUrl: z.string().url().optional(),
      heroImageAlt: z.string().optional(),
      heroImageCredit: z.string().optional(),
      author: z.string().default('GamePulse Desk'),
      // Editorial transparency — surfaced on the page and in JSON-LD.
      aiAssisted: z.boolean().default(false),
      reviewedBy: z.string().optional(),
      factChecked: z.boolean().default(false),
      sources: z.array(sourceSchema).default([]),
      videoIds: z.array(z.string()).default([]),
      faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
      // The one-paragraph answer AI engines lift. Core GEO surface.
      keyTakeaway: z.string().optional(),
      draft: z.boolean().default(false),
      featured: z.boolean().default(false),
      readingTime: z.number().optional(),
    }),
});

export const collections = { posts };
