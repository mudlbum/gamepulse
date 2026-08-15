/**
 * Realistic fixtures matching the exact response shapes verified on
 * 2026-08-15. These let the whole pipeline run offline in CI, and they double
 * as regression tests: if an upstream ever changes shape, updating the fixture
 * here immediately shows what breaks downstream.
 */

/**
 * GetGamesByConcurrentPlayers — the LIVE board. Carries concurrent_in_game.
 */
export const steamConcurrent = {
  response: {
    ranks: [
      { rank: 1, appid: 730, concurrent_in_game: 746368, peak_in_game: 902114, last_week_rank: 1 },
      { rank: 2, appid: 570, concurrent_in_game: 561816, peak_in_game: 690012, last_week_rank: 2 },
      { rank: 3, appid: 1623730, concurrent_in_game: 216218, peak_in_game: 298440, last_week_rank: 5 },
      { rank: 4, appid: 578080, concurrent_in_game: 128209, peak_in_game: 331020, last_week_rank: 3 },
      { rank: 5, appid: 252490, concurrent_in_game: 111715, peak_in_game: 140338, last_week_rank: 4 },
      { rank: 6, appid: 2767030, concurrent_in_game: 107713, peak_in_game: 155900, last_week_rank: 8 },
      { rank: 7, appid: 553850, concurrent_in_game: 80874, peak_in_game: 121455, last_week_rank: 14 },
      { rank: 8, appid: 359550, concurrent_in_game: 74433, peak_in_game: 98220, last_week_rank: 7 },
      { rank: 9, appid: 1172470, concurrent_in_game: 71785, peak_in_game: 95610, last_week_rank: 6 },
      { rank: 10, appid: 108600, concurrent_in_game: 84102, peak_in_game: 99001, last_week_rank: 11 },
    ],
  },
};

/**
 * GetMostPlayedGames — the WEEKLY chart, captured verbatim from production on
 * 2026-08-15. Note what is NOT here: `concurrent_in_game`. Only `peak_in_game`
 * and `last_week_rank`. Reading a live player count out of this shape returns
 * undefined for every row, which is exactly how the first deploy shipped a
 * leaderboard of zeros. Do not "helpfully" add the field back.
 */
export const steamChart = {
  response: {
    rollup_date: 1786492800,
    ranks: [
      { rank: 1, appid: 730, peak_in_game: 1182329, last_week_rank: 1 },
      { rank: 2, appid: 570, peak_in_game: 862382, last_week_rank: 3 },
      { rank: 3, appid: 578080, peak_in_game: 761017, last_week_rank: 2 },
      { rank: 4, appid: 431960, peak_in_game: 111986, last_week_rank: 4 },
      { rank: 5, appid: 1172470, peak_in_game: 273241, last_week_rank: 6 },
      { rank: 6, appid: 1623730, peak_in_game: 293465, last_week_rank: 5 },
      { rank: 7, appid: 3527290, peak_in_game: 104362, last_week_rank: 45 },
      { rank: 8, appid: 553850, peak_in_game: 112107, last_week_rank: 28 },
      { rank: 9, appid: 2767030, peak_in_game: 126218, last_week_rank: 7 },
      { rank: 10, appid: 108600, peak_in_game: 91490, last_week_rank: 14 },
    ],
  },
};

export const steamAppDetails = (appid) => ({
  [String(appid)]: {
    success: true,
    data: {
      type: 'game',
      name: { 730: 'Counter-Strike 2', 570: 'Dota 2', 1623730: 'Palworld' }[appid] || `Game ${appid}`,
      steam_appid: Number(appid),
      is_free: [730, 570].includes(Number(appid)),
      header_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
      capsule_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg`,
      developers: ['Valve'],
      publishers: ['Valve'],
      genres: [{ description: 'Action' }, { description: 'Free To Play' }],
      release_date: { coming_soon: false, date: '21 Aug, 2012' },
    },
  },
});

export const steamNews = (appid) => ({
  appnews: {
    appid: Number(appid),
    newsitems: [
      {
        gid: '703276586134143012',
        title: 'Devoid of Liberty — Update 7.0.0',
        url: 'https://store.steampowered.com/news/app/553850/view/703276586134143012',
        is_external_url: true,
        author: 'Arrowhead',
        contents:
          '[h1]Level cap raised to 300[/h1] Two new Illuminate enemies join the fight: the [b]Wretch[/b] and the [b]Crusher[/b]. A Warhammer 40,000 crossover Warbond, "Castellan\'s Creed", is now available for 1,500 Super Credits.',
        feedlabel: 'Community Announcements',
        date: Math.floor(Date.now() / 1000) - 3 * 86400,
        feedname: 'steam_community_announcements',
        feed_type: 1,
        appid: Number(appid),
      },
      {
        gid: '703276586134143011',
        title: 'Patch 1.4.2 — stability fixes',
        url: 'https://store.steampowered.com/news/app/553850/view/703276586134143011',
        is_external_url: true,
        author: 'Arrowhead',
        contents: 'Fixed a crash when joining a game in progress. Improved matchmaking reliability.',
        feedlabel: 'Community Announcements',
        date: Math.floor(Date.now() / 1000) - 9 * 86400,
        feedname: 'steam_community_announcements',
        feed_type: 1,
        appid: Number(appid),
      },
    ],
  },
});

/** Atom with media:group, exactly as YouTube serves channel feeds. */
export const youtubeFeed = (channelId, channelTitle = 'Test Channel', titles = null) => {
  const now = Date.now();
  const T = titles ?? [
    'INSANE 1v5 clutch to win the Major',
    'Every secret in the new patch',
    'Two-year-old video that should not trend',
  ];
  const vid = (id, title, hoursAgo, views) => `
  <entry>
    <id>yt:video:${id}</id>
    <yt:videoId>${id}</yt:videoId>
    <yt:channelId>${channelId}</yt:channelId>
    <title>${title}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/>
    <published>${new Date(now - hoursAgo * 3600_000).toISOString()}</published>
    <updated>${new Date(now - hoursAgo * 3600_000).toISOString()}</updated>
    <media:group>
      <media:title>${title}</media:title>
      <media:content url="https://www.youtube.com/v/${id}?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
      <media:thumbnail url="https://i4.ytimg.com/vi/${id}/hqdefault.jpg" width="480" height="360"/>
      <media:description>An absolutely unreal clutch in the grand final.</media:description>
      <media:community>
        <media:starRating count="${Math.round(views / 30)}" average="4.94" min="1" max="5"/>
        <media:statistics views="${views}"/>
      </media:community>
    </media:group>
  </entry>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <id>yt:channel:${channelId}</id>
  <yt:channelId>${channelId}</yt:channelId>
  <title>${channelTitle}</title>
  <link rel="alternate" href="https://www.youtube.com/channel/${channelId}"/>
  ${vid('dQw4w9WgXcQ', T[0], 6, 480000)}
  ${vid('aBcDeFgHiJk', T[1], 30, 210000)}
  ${vid('zYxWvUtSrQp', T[2], 17000, 9400000)}
</feed>`;
};

export const rssFeed = ({ title = 'Test Outlet', ageHoursOfNewest = 2, count = 5, headlines = null } = {}) => {
  const items = Array.from({ length: count }, (_, i) => {
    const h = headlines?.[i] ?? `Sample gaming headline number ${i + 1}`;
    const d = new Date(Date.now() - (ageHoursOfNewest + i * 3) * 3600_000).toUTCString();
    return `
    <item>
      <title><![CDATA[${h}]]></title>
      <link>https://example.com/article-${i + 1}</link>
      <pubDate>${d}</pubDate>
      <dc:creator>Staff Writer</dc:creator>
      <description><![CDATA[<p>A summary of the story with <b>markup</b> that needs stripping.</p>]]></description>
      <media:thumbnail url="https://example.com/img-${i + 1}.jpg"/>
      <category>News</category>
    </item>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${title}</title>
    <link>https://example.com</link>
    <description>Test feed</description>
    ${items}
  </channel>
</rss>`;
};

/** The "looks healthy, is dead" case: valid RSS, newest item is from 2024. */
export const staleFeed = rssFeed({ title: 'Abandoned Mirror', ageHoursOfNewest: 24 * 800, count: 4 });

/** Valid RSS document containing zero items — the other trap we found. */
export const emptyFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Empty Feed</title><link>https://example.com</link>
<description>Nothing here</description></channel></rss>`;

export const epicFree = {
  data: {
    Catalog: {
      searchStore: {
        elements: [
          {
            title: 'Caravan SandWitch',
            id: 'abc123',
            description: 'A chill exploration game about finding your sister on a post-collapse planet.',
            offerType: 'BASE_GAME',
            productSlug: 'caravan-sandwitch',
            urlSlug: 'caravan-sandwitch',
            keyImages: [
              { type: 'OfferImageWide', url: 'https://cdn1.epicgames.com/wide.jpg' },
              { type: 'Thumbnail', url: 'https://cdn1.epicgames.com/thumb.jpg' },
            ],
            price: {
              totalPrice: {
                discountPrice: 0,
                originalPrice: 1999,
                fmtPrice: { originalPrice: '$19.99', discountPrice: '0' },
              },
            },
            promotions: {
              promotionalOffers: [
                {
                  promotionalOffers: [
                    {
                      startDate: new Date(Date.now() - 2 * 86400_000).toISOString(),
                      endDate: new Date(Date.now() + 5 * 86400_000).toISOString(),
                      discountSetting: { discountType: 'PERCENTAGE', discountPercentage: 0 },
                    },
                  ],
                },
              ],
              upcomingPromotionalOffers: [],
            },
          },
          {
            title: 'Next Week Freebie',
            id: 'def456',
            description: 'Coming soon to the weekly giveaway.',
            offerType: 'BASE_GAME',
            productSlug: 'next-week-freebie',
            keyImages: [{ type: 'OfferImageWide', url: 'https://cdn1.epicgames.com/wide2.jpg' }],
            price: { totalPrice: { discountPrice: 2999, originalPrice: 2999, fmtPrice: { originalPrice: '$29.99' } } },
            promotions: {
              promotionalOffers: [],
              upcomingPromotionalOffers: [
                {
                  promotionalOffers: [
                    {
                      startDate: new Date(Date.now() + 5 * 86400_000).toISOString(),
                      endDate: new Date(Date.now() + 12 * 86400_000).toISOString(),
                      discountSetting: { discountType: 'PERCENTAGE', discountPercentage: 0 },
                    },
                  ],
                },
              ],
            },
          },
          {
            title: 'Just A Discount, Not Free',
            id: 'ghi789',
            description: 'Should be excluded from both lists.',
            offerType: 'BASE_GAME',
            productSlug: 'not-free',
            keyImages: [],
            price: { totalPrice: { discountPrice: 1500, originalPrice: 3000, fmtPrice: { originalPrice: '$30.00' } } },
            promotions: {
              promotionalOffers: [
                {
                  promotionalOffers: [
                    {
                      startDate: new Date().toISOString(),
                      endDate: new Date(Date.now() + 86400_000).toISOString(),
                      discountSetting: { discountType: 'PERCENTAGE', discountPercentage: 50 },
                    },
                  ],
                },
              ],
              upcomingPromotionalOffers: [],
            },
          },
        ],
      },
    },
  },
};

export const cheapSharkDeals = [
  {
    internalName: 'DEEPROCKGALACTIC',
    title: 'Deep Rock Galactic',
    dealID: 'deal1',
    storeID: '1',
    salePrice: '7.49',
    normalPrice: '29.99',
    isOnSale: '1',
    savings: '75.025008',
    metacriticScore: '85',
    steamRatingText: 'Overwhelmingly Positive',
    steamRatingPercent: '96',
    steamAppID: '548430',
    thumb: 'https://cdn.cloudflare.steamstatic.com/steam/apps/548430/capsule_sm_120.jpg',
  },
  {
    internalName: 'HADES',
    title: 'Hades',
    dealID: 'deal2',
    storeID: '7',
    salePrice: '9.99',
    normalPrice: '24.99',
    isOnSale: '1',
    savings: '60.024010',
    metacriticScore: '93',
    steamRatingText: 'Overwhelmingly Positive',
    steamRatingPercent: '98',
    steamAppID: '1145360',
    thumb: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/capsule_sm_120.jpg',
  },
  {
    internalName: 'BARELYDISCOUNTED',
    title: 'Barely Discounted Game',
    dealID: 'deal3',
    storeID: '1',
    salePrice: '27.00',
    normalPrice: '30.00',
    isOnSale: '1',
    savings: '10.000000',
    metacriticScore: '0',
    steamAppID: '999999',
    thumb: 'https://example.com/t.jpg',
  },
];

export const cheapSharkStores = [
  { storeID: '1', storeName: 'Steam', isActive: 1 },
  { storeID: '7', storeName: 'GOG', isActive: 1 },
  { storeID: '8', storeName: 'Origin', isActive: 1 },
];

export const bskyAuthorFeed = (handle, displayName) => ({
  feed: [
    {
      post: {
        uri: `at://did:plc:example/app.bsky.feed.post/3abcxyz`,
        cid: 'bafy...',
        author: {
          did: 'did:plc:example',
          handle,
          displayName,
          avatar: 'https://cdn.bsky.app/img/avatar/plain/did:plc:example/abc@jpeg',
        },
        record: {
          $type: 'app.bsky.feed.post',
          text: 'Finished my Cryo Traveler build just in time for 7.0! Photos by @ikemaphoto.',
          createdAt: new Date(Date.now() - 20 * 3600_000).toISOString(),
        },
        embed: {
          $type: 'app.bsky.embed.images#view',
          images: [
            {
              thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:example/img1@jpeg',
              fullsize: 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:example/img1@jpeg',
              alt: 'Cryo Traveler cosplay, full body shot',
              aspectRatio: { width: 1500, height: 2000 },
            },
          ],
        },
        likeCount: 1421,
        repostCount: 143,
        replyCount: 37,
        indexedAt: new Date(Date.now() - 20 * 3600_000).toISOString(),
      },
    },
    {
      // A repost — must be filtered out.
      reason: { $type: 'app.bsky.feed.defs#reasonRepost' },
      post: {
        uri: `at://did:plc:other/app.bsky.feed.post/3zzz`,
        author: { did: 'did:plc:other', handle: 'someone.else', displayName: 'Someone Else' },
        record: { text: 'reposted content', createdAt: new Date().toISOString() },
        embed: {
          $type: 'app.bsky.embed.images#view',
          images: [{ thumb: 't', fullsize: 'f', alt: 'x', aspectRatio: { width: 1, height: 1 } }],
        },
        likeCount: 10,
        repostCount: 1,
        replyCount: 0,
      },
    },
    {
      // A text-only post — no images, must be filtered out.
      post: {
        uri: `at://did:plc:example/app.bsky.feed.post/3textonly`,
        author: { did: 'did:plc:example', handle, displayName },
        record: { text: 'Con crunch is real, see you all Saturday', createdAt: new Date().toISOString() },
        likeCount: 88,
        repostCount: 2,
        replyCount: 4,
      },
    },
  ],
});

export const ddragonVersions = ['26.16.1', '26.15.1', '26.14.1', '26.13.1'];

export const valorantVersion = {
  status: 200,
  data: {
    manifestId: '0C3A9B330E17EA5B',
    branch: 'release-13.02',
    version: '13.02.00.5277781',
    buildVersion: '17',
    buildDate: '2026-08-10T20:40:19Z',
  },
};
