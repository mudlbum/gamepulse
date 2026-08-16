/**
 * Verified keyless source registry.
 *
 * Every entry here was checked on 2026-08-15. Status notes explain what was
 * confirmed and what was not, so future-you knows which entries to distrust
 * first when something breaks.
 *
 * Deliberately EXCLUDED after verification:
 *  - reddit.com/*.json  — Reddit blocks unauthenticated JSON from datacenter
 *    IPs; GitHub Actions runners are datacenter IPs. It would 403 every run.
 *  - antosik lol-rss mirrors — respond 200 with valid Atom, newest entry is
 *    from May 2024. The classic "looks healthy, is dead" trap.
 *  - genshin-feed.com — valid RSS, zero items.
 *  - thisisgame.com — no working RSS endpoint exists.
 *  - RAWG / IGDB / MobyGames / Giant Bomb — all require API keys.
 */

/* ------------------------------------------------------------------ *
 * 1. Leaderboard — games tracked for live concurrent player counts.
 *    Steam's chart service supplies the ranking; this list adds the
 *    human-readable names and slugs we need for links and article hooks.
 * ------------------------------------------------------------------ */
export const TRACKED_APPS = [
  { appid: 730, name: 'Counter-Strike 2', short: 'CS2' },
  { appid: 570, name: 'Dota 2', short: 'Dota 2' },
  { appid: 1623730, name: 'Palworld', short: 'Palworld' },
  { appid: 578080, name: 'PUBG: Battlegrounds', short: 'PUBG' },
  { appid: 252490, name: 'Rust', short: 'Rust' },
  { appid: 2767030, name: 'Marvel Rivals', short: 'Rivals' },
  { appid: 553850, name: 'Helldivers 2', short: 'Helldivers 2' },
  { appid: 359550, name: "Tom Clancy's Rainbow Six Siege", short: 'R6 Siege' },
  { appid: 1172470, name: 'Apex Legends', short: 'Apex' },
  { appid: 2357570, name: 'Overwatch 2', short: 'Overwatch' },
  { appid: 108600, name: 'Project Zomboid', short: 'Zomboid' },
  { appid: 1938090, name: 'Call of Duty', short: 'Call of Duty' },
  { appid: 271590, name: 'Grand Theft Auto V', short: 'GTA V' },
  { appid: 1085660, name: 'Destiny 2', short: 'Destiny 2' },
  { appid: 238960, name: 'Path of Exile', short: 'PoE' },
  { appid: 2694490, name: 'Path of Exile 2', short: 'PoE 2' },
  { appid: 1245620, name: 'ELDEN RING', short: 'Elden Ring' },
  { appid: 892970, name: 'Valheim', short: 'Valheim' },
  { appid: 431960, name: 'Wallpaper Engine', short: 'Wallpaper Engine' },
  { appid: 1174180, name: 'Red Dead Redemption 2', short: 'RDR2' },
  { appid: 1091500, name: 'Cyberpunk 2077', short: 'Cyberpunk' },
  { appid: 3489700, name: 'Stellar Blade', short: 'Stellar Blade' },
  { appid: 2073850, name: 'THE FINALS', short: 'The Finals' },
  { appid: 1966720, name: 'Lethal Company', short: 'Lethal Company' },
  { appid: 1203220, name: 'NARAKA: BLADEPOINT', short: 'Naraka' },
];

/* ------------------------------------------------------------------ *
 * 2. Patch-note sources for the update tracker.
 *    'steam' entries use the keyless ISteamNews endpoint filtered to
 *    Valve's own update feed types. 'rss' entries use official blogs.
 * ------------------------------------------------------------------ */
export const PATCH_SOURCES = [
  { id: 'cs2', game: 'Counter-Strike 2', type: 'steam', appid: 730, platforms: ['pc'], official: 'https://www.counter-strike.net/news/updates' },
  { id: 'dota2', game: 'Dota 2', type: 'steam', appid: 570, platforms: ['pc'], official: 'https://www.dota2.com/news' },
  { id: 'helldivers2', game: 'Helldivers 2', type: 'steam', appid: 553850, platforms: ['pc', 'playstation'], official: 'https://store.steampowered.com/news/app/553850' },
  { id: 'marvel-rivals', game: 'Marvel Rivals', type: 'steam', appid: 2767030, platforms: ['pc', 'playstation', 'xbox'], official: 'https://www.marvelrivals.com/gameupdate/' },
  { id: 'palworld', game: 'Palworld', type: 'steam', appid: 1623730, platforms: ['pc', 'xbox', 'playstation'], official: 'https://store.steampowered.com/news/app/1623730' },
  { id: 'pubg', game: 'PUBG: Battlegrounds', type: 'steam', appid: 578080, platforms: ['pc', 'playstation', 'xbox'], official: 'https://pubg.com/en/news' },
  { id: 'rust', game: 'Rust', type: 'steam', appid: 252490, platforms: ['pc'], official: 'https://rust.facepunch.com/news' },
  { id: 'poe2', game: 'Path of Exile 2', type: 'steam', appid: 2694490, platforms: ['pc', 'playstation', 'xbox'], official: 'https://www.pathofexile.com/forum/view-forum/2212' },
  { id: 'destiny2', game: 'Destiny 2', type: 'steam', appid: 1085660, platforms: ['pc', 'playstation', 'xbox'], official: 'https://www.bungie.net/7/en/News' },
  { id: 'apex', game: 'Apex Legends', type: 'steam', appid: 1172470, platforms: ['pc', 'playstation', 'xbox', 'switch'], official: 'https://www.ea.com/games/apex-legends/apex-legends/news' },
  { id: 'the-finals', game: 'THE FINALS', type: 'steam', appid: 2073850, platforms: ['pc', 'playstation', 'xbox'], official: 'https://www.reachthefinals.com/news' },
  { id: 'naraka', game: 'NARAKA: BLADEPOINT', type: 'steam', appid: 1203220, platforms: ['pc', 'playstation', 'xbox'], official: 'https://www.narakathegame.com/news/' },

  // VERIFIED live 2026-08-15.
  { id: 'poe', game: 'Path of Exile', type: 'rss', url: 'https://www.pathofexile.com/news/rss', platforms: ['pc', 'playstation', 'xbox'], official: 'https://www.pathofexile.com/news' },
  { id: 'bungie', game: 'Destiny 2 / Marathon', type: 'rss', url: 'https://www.bungie.net/en/rss/News', platforms: ['pc', 'playstation', 'xbox'], official: 'https://www.bungie.net/7/en/News' },

  // Blizzard publishes NO official RSS. news.blizzard.com/*/feed/* are HTML
  // pages that masquerade as feeds in search results. Their forums run
  // Discourse, which does expose real RSS — filter to blue posts.
  { id: 'overwatch', game: 'Overwatch 2', type: 'rss', url: 'https://us.forums.blizzard.com/en/overwatch/latest.rss', platforms: ['pc', 'playstation', 'xbox', 'switch'], official: 'https://overwatch.blizzard.com/news/patch-notes/', noisy: true },
  { id: 'wow', game: 'World of Warcraft', type: 'rss', url: 'https://us.forums.blizzard.com/en/wow/latest.rss', platforms: ['pc'], official: 'https://worldofwarcraft.blizzard.com/news', noisy: true },
];

/**
 * Riot ships no patch RSS. These two keyless JSON endpoints expose the live
 * build version, so we can detect a new patch the moment it deploys and link
 * to the official notes page rather than scraping it.
 */
export const VERSION_PROBES = [
  {
    id: 'lol',
    game: 'League of Legends',
    url: 'https://ddragon.leagueoflegends.com/api/versions.json',
    pick: (json) => (Array.isArray(json) && json[0]) || null,
    notesUrl: (v) => {
      const [maj, min] = String(v).split('.');
      return `https://www.leagueoflegends.com/en-us/news/game-updates/patch-${maj}-${min}-notes/`;
    },
    platforms: ['pc'],
    official: 'https://www.leagueoflegends.com/en-us/news/tags/patch-notes/',
  },
  {
    id: 'valorant',
    game: 'VALORANT',
    url: 'https://valorant-api.com/v1/version',
    pick: (json) => json?.data?.branch?.replace(/^release-/, '') || null,
    notesUrl: (v) => `https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-${String(v).replace('.', '-')}/`,
    platforms: ['pc', 'playstation', 'xbox'],
    official: 'https://playvalorant.com/en-us/news/tags/patch-notes/',
  },
];

/* ------------------------------------------------------------------ *
 * 3. YouTube channels — every UC id below was resolved from the channel's
 *    own page HTML and then round-tripped through /channel/<id> to confirm
 *    it points back at the same channel. A wrong id = a silently dead feed.
 * ------------------------------------------------------------------ */
export const YOUTUBE_CHANNELS = [
  // News & reviews
  { id: 'UCKy1dAqELo0zrOtPkf0eTMw', name: 'IGN', tags: ['news'] },
  { id: 'UCbu2SsF-Or3Rsn3NxqODImw', name: 'GameSpot', tags: ['news'] },
  { id: 'UCNvzD7Z-g64bPXxGzaQaa4g', name: 'gameranx', tags: ['news', 'features'] },
  { id: 'UCk2ipH2l8RvLG0dr-rsBiZw', name: 'GamesRadar', tags: ['news'] },
  { id: 'UCciKycgzURdymx-GRSY2_dA', name: 'Eurogamer', tags: ['news'] },
  { id: 'UCgaPRP68bbyHnfkPhWWBrNw', name: 'PC Gamer', tags: ['news', 'pc'] },
  { id: 'UC9PBzalIcEQCsiIkq36PyUA', name: 'Digital Foundry', tags: ['tech', 'analysis'] },

  // Esports
  { id: 'UCvqRdlKsE5Q8mf8YXbdIJLw', name: 'LoL Esports', tags: ['esports', 'lol'] },
  { id: 'UC8CX0LD98EDXl4UYX1MDCXg', name: 'VALORANT', tags: ['esports', 'valorant'] },
  { id: 'UCPq2ETz4aAGo2Z-8JisDPIA', name: 'ESL Counter-Strike', tags: ['esports', 'cs2'] },
  { id: 'UC9k--dE_UE0Faxzgb_DDkYQ', name: 'BLAST Premier', tags: ['esports', 'cs2'] },
  { id: 'UCTQKT5QqO3h7y32G8VzuySQ', name: 'Dota 2', tags: ['esports', 'dota'] },
  { id: 'UCSCoziKHqjqbox3Fv3Pb4BA', name: 'theScore esports', tags: ['esports'] },
  { id: 'UCJEGvSZnQ1pkVfHO8s5G8hA', name: 'Riot Games', tags: ['esports'] },

  // Platform holders — low volume, huge spikes
  { id: 'UC-2Y8dQb0S6DtpxNgAKoJKA', name: 'PlayStation', tags: ['playstation'] },
  { id: 'UCjBp_7RuDBUYbd1LegWEJ8g', name: 'Xbox', tags: ['xbox'] },
  { id: 'UCGIY_O-8vW4rfX98KlMkvRg', name: 'Nintendo of America', tags: ['switch'] },
  { id: 'UC6VcWc1rAoWdBCM0JxrRQ3A', name: 'Rockstar Games', tags: ['news'] },

  // Creators — where viral clips actually surface
  { id: 'UCq6VFHwMzcMXbuKyG7SQYIg', name: 'penguinz0', tags: ['viral', 'commentary'] },
  { id: 'UCKqH_9mk1waLgBiL2vT5b9g', name: 'VanossGaming', tags: ['viral', 'funny'] },
  { id: 'UCYzPXprvl5Y-Sf0g4vX-m6g', name: 'jacksepticeye', tags: ['viral', 'letsplay'] },
  { id: 'UC_q5WZtFp36adwqhKpZzxwQ', name: 'SypherPK', tags: ['viral', 'fortnite'] },
];

/* ------------------------------------------------------------------ *
 * 4. News feeds. Korean set confirmed live with same-day items.
 *    VG247 deliberately omitted — its last recorded update was ~1 June 2026
 *    while every peer shows same-day activity, and several editors left to
 *    found a separate publication. Re-add only after confirming it publishes.
 * ------------------------------------------------------------------ */
export const NEWS_FEEDS = {
  en: [
    { name: 'IGN', url: 'https://feeds.feedburner.com/ign/games-all', weight: 1 },
    { name: 'PC Gamer', url: 'https://www.pcgamer.com/rss/', weight: 1 },
    { name: 'Kotaku', url: 'https://kotaku.com/rss', weight: 0.9 },
    { name: 'Destructoid', url: 'https://www.destructoid.com/feed/', weight: 0.8 },
    { name: 'PCGamesN', url: 'https://www.pcgamesn.com/mainrss.xml', weight: 0.8 },
    { name: 'Game Developer', url: 'https://www.gamedeveloper.com/rss.xml', weight: 0.7 },
    { name: 'Eurogamer', url: 'https://www.eurogamer.net/feed', weight: 1 },
    { name: 'Rock Paper Shotgun', url: 'https://www.rockpapershotgun.com/feed', weight: 0.9 },
    { name: 'Polygon', url: 'https://www.polygon.com/rss/index.xml', weight: 0.9 },
    { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/mashup/', weight: 0.9 },
    { name: 'Push Square', url: 'https://www.pushsquare.com/feeds/latest', weight: 0.8 },
    { name: 'Nintendo Life', url: 'https://www.nintendolife.com/feeds/latest', weight: 0.8 },
    { name: 'Pure Xbox', url: 'https://www.purexbox.com/feeds/latest', weight: 0.7 },
    { name: 'PlayStation Blog', url: 'https://blog.playstation.com/feed/', weight: 1, official: true },
    { name: 'Xbox Wire', url: 'https://news.xbox.com/en-us/feed/', weight: 1, official: true },
    { name: 'Nintendo', url: 'https://www.nintendo.com/en-gb/news.xml', weight: 1, official: true },
  ],
  ko: [
    { name: '인벤', url: 'https://feeds.feedburner.com/inven', weight: 1 },
    { name: '인벤 주요뉴스', url: 'https://feeds.feedburner.com/inven/mainnews/1', weight: 1 },
    { name: '루리웹', url: 'https://bbs.ruliweb.com/news/rss', weight: 1 },
    { name: '루리웹 비디오게임', url: 'https://bbs.ruliweb.com/news/523/rss', weight: 0.9 },
    { name: '루리웹 PC/온라인', url: 'https://bbs.ruliweb.com/news/529/rss', weight: 0.9 },
    { name: '게임메카', url: 'https://www.gamemeca.com/rss.php', weight: 0.9 },
  ],
};

/* ------------------------------------------------------------------ *
 * 5b. Mobile games.
 *
 * WHY THERE IS NO CHART HERE. Apple's marketing RSS
 * (rss.marketingtools.apple.com/api/v2/<cc>/apps/top-free/<n>/apps.json) mirrors
 * the App Store's *Apps* chart, and on the App Store "Apps" and "Games" are
 * separate top-chart tabs — the Apps chart structurally contains no games. The
 * first version of this pipeline fetched that chart and filtered to
 * primaryGenreName === 'Games', which is why the mobile section was silently
 * empty in production for every run: the filter was correct and the source had
 * nothing to filter. `?genre=6014` is accepted and ignored, `/games.json` and
 * `/<cc>/games/...` both 404, and `top-grossing` 404s for apps entirely.
 * Google Play has no public API of any kind, so Android is absent and the page
 * says so.
 *
 * WHAT WE DO INSTEAD. iTunes Lookup is keyless, documented, per-storefront, and
 * returns real numbers for a game we name ourselves: lifetime rating count,
 * average rating, current version and its release date, and the release notes.
 * Ranking by rating count is a popularity proxy, NOT a player count, and every
 * surface that shows it must say so. Sampling the count over time turns it into
 * something better — new ratings per week is genuine live activity.
 *
 * The roster is editorial and deliberately mixes global hits with the Korean
 * market, because half this site's readers are Korean and the KR storefront's
 * top games are not the US storefront's.
 */
export const MOBILE_GAMES = [
  // Global
  'Roblox',
  'Honor of Kings',
  'Genshin Impact',
  'Honkai: Star Rail',
  'Zenless Zone Zero',
  'PUBG MOBILE',
  'Call of Duty: Mobile',
  'Free Fire',
  'Clash of Clans',
  'Clash Royale',
  'Brawl Stars',
  'Pokémon GO',
  'Monopoly GO!',
  'Royal Match',
  'Candy Crush Saga',
  'Subway Surfers',
  'Among Us!',
  'Stumble Guys',
  'Minecraft',
  'Marvel Snap',
  'Diablo Immortal',
  'Whiteout Survival',
  'Last War: Survival',
  'eFootball',
  'EA SPORTS FC Mobile Soccer',
  'League of Legends: Wild Rift',
  'Teamfight Tactics',
  'Arknights',
  'Fate/Grand Order',
  'Umamusume: Pretty Derby',
  // Korea-heavy
  'Blue Archive',
  'NIKKE',
  'Epic Seven',
  'Cookie Run: Kingdom',
  'Summoners War',
  'Lineage M',
  'Lineage W',
  'ODIN: Valhalla Rising',
  'Seven Knights',
  'DUNGEON&FIGHTER MOBILE',
];

export const MOBILE_STOREFRONTS = [
  { cc: 'us', label: 'United States', labelKo: '미국' },
  { cc: 'kr', label: 'South Korea', labelKo: '대한민국' },
];


export const ENDPOINTS = {
  /* LIVE concurrents. This is the one that carries `concurrent_in_game`.
     Verified against production 2026-08-15. */
  steamConcurrent: 'https://api.steampowered.com/ISteamChartsService/GetGamesByConcurrentPlayers/v1/',
  /* Weekly top chart. Despite the name it does NOT report live players — each
     rank has `peak_in_game` (the week's peak) and `last_week_rank`, and no
     `concurrent_in_game` at all. Reading a live figure out of this endpoint
     silently yields 0 for every game. Kept only as a ranking fallback. */
  steamMostPlayed: 'https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/',
  steamPlayers: (appid) =>
    `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`,
  steamNews: (appid, count = 6) =>
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${appid}&count=${count}&maxlength=1200&format=json`,
  steamAppDetails: (appid, cc = 'us', lang = 'en') =>
    `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${cc}&l=${lang}`,
  steamSpyTop: 'https://steamspy.com/api.php?request=top100in2weeks',
  epicFree:
    'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US',
  cheapSharkDeals:
    'https://www.cheapshark.com/api/1.0/deals?storeID=1,7,8,11,25&upperPrice=60&pageSize=40&sortBy=Savings&onSale=1',
  cheapSharkStores: 'https://www.cheapshark.com/api/1.0/stores',
  /* speedrun.com v1. Keyless reads, 100 req/min per IP, rate-limit status is
     420 (not 429). Content is CC-BY-NC 4.0 — attribution required. */
  speedrunBase: 'https://www.speedrun.com/api/v1',

  /* Bulk id lookup. The whole mobile section is built on this one endpoint.
     Deliberately minimal: `entity` and `limit` are NOT passed. On a lookup-by-id
     `entity` changes what Apple returns rather than filtering it, and `limit`
     defaults to 50 and can silently truncate a longer id list. Both were in the
     first version and the whole mobile section came back empty in production. */
  itunesLookup: (ids, cc = 'us') =>
    `https://itunes.apple.com/lookup?id=${ids.join(',')}&country=${cc}`,
  /* Name -> trackId resolution. `entity=software` is correct HERE (it scopes a
     text search to iPhone apps); it is only harmful on /lookup. */
  itunesSearch: (term, cc = 'us') =>
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${cc}&entity=software&limit=8`,

};

/** Steam news feed types that represent actual game updates, not press blurbs. */
export const STEAM_UPDATE_FEEDS = new Set([
  'steam_updates',
  'steam_community_announcements',
  'steam_community_blog',
]);
