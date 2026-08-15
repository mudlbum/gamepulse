/**
 * Single source of truth for site-wide identity, monetisation and feature flags.
 * Edit this file rather than hunting through components.
 */
export const SITE = {
  name: 'GamePulse',
  tagline: {
    en: 'Live game data, honest coverage.',
    ko: '실시간 게임 데이터, 솔직한 기사.',
  },
  description: {
    en: 'Live player-count leaderboards, patch note digests, viral highlight clips and researched gaming coverage across PC, console and mobile.',
    ko: 'PC·콘솔·모바일 전반의 실시간 동시접속 순위, 패치노트 요약, 화제의 하이라이트 영상과 심층 게임 기사.',
  },
  // Set these before going live.
  url: process.env.SITE_URL || 'https://example.github.io',
  locales: ['en', 'ko'] as const,
  defaultLocale: 'en' as const,
  author: {
    name: 'GamePulse Desk',
    url: '/about',
  },
  /* Published on the Contact page and checked by AdSense reviewers, so it has
     to be an address a human actually reads. The +tag is deliberate: it filters
     cleanly in Gmail, and if it is ever harvested and spammed it can be
     abandoned without touching the main inbox. */
  contactEmail: 'mudlbum+gamepulse@gmail.com',
  social: {
    bluesky: '',
    youtube: '',
    discord: '',
    github: '',
  },
  // AdSense: leave blank until approved. Setting the client ID activates the
  // loader script and the ad slots; leaving it blank ships a clean, ad-free site.
  adsense: {
    clientId: '', // e.g. 'ca-pub-0000000000000000'
    enabled: false,
    slots: {
      inArticle: '',
      sidebar: '',
      footer: '',
    },
  },
  analytics: {
    // Privacy-friendly, cookieless. Leave blank to disable.
    plausibleDomain: '',
    googleAnalyticsId: '',
  },
  // How often client-side JS re-polls the JSON data files, in milliseconds.
  livePollMs: 90_000,
} as const;

export type Locale = (typeof SITE.locales)[number];
