import { defineConfig } from 'astro/config';
import { thinGameSlugs } from './src/lib/games.ts';
import sitemap from '@astrojs/sitemap';
import { rehypeBasePath } from './src/lib/rehype-base-path.mjs';

// SITE_URL is set by the GitHub Actions workflow. Change the fallback to your own domain.
const SITE = process.env.SITE_URL || 'https://example.github.io';
// BASE_PATH is '/' for a user site (user.github.io) or '/repo-name/' for a project site.
const BASE = process.env.BASE_PATH || '/';

const THIN_GAMES = thinGameSlugs();

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  compressHTML: true,
  prefetch: { prefetchAll: true, defaultStrategy: 'viewport' },
  markdown: {
    // Article bodies link to /leaderboards and friends; Astro does not rewrite
    // markdown hrefs for the base path, so this does it at build time.
    rehypePlugins: [[rehypeBasePath, { base: BASE }]],
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en-US', ko: 'ko-KR' },
      },
      /* Thin game pages ship with robots noindex, so listing them here would
         earn a "Submitted URL marked noindex" warning for every one. The set
         comes from the same index the pages are built from — never a second
         hand-maintained list. */
      filter: (page) => {
        if (page.includes('/404') || page.includes('/search')) return false;
        const m = page.match(/\/games\/([^/]+)\/?$/);
        return !(m && THIN_GAMES.has(m[1]));
      },
      serialize(item) {
        if (item.url.match(/\/(leaderboards|games|clips|updates|deals)/)) {
          item.changefreq = 'hourly';
          item.priority = 0.9;
        } else if (item.url.match(/\/(posts|cosplay|news)/)) {
          item.changefreq = 'daily';
          item.priority = 0.8;
        } else {
          item.changefreq = 'weekly';
          item.priority = 0.6;
        }
        return item;
      },
    }),
  ],
  vite: {
    build: { cssMinify: 'lightningcss' },
  },
});
