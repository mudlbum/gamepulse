/**
 * Free games and discounts.
 *
 * Epic's promotions endpoint is the single best keyless source on the whole
 * site — it returns current AND upcoming giveaways with exact start/end
 * timestamps. CheapShark supplies cross-store discounts, also keyless.
 */
import { getJson, log, warn } from './lib/http.mjs';
import { ENDPOINTS } from './lib/sources.mjs';

export async function fetchDeals() {
  const scope = 'deals';
  const [epic, cheap, stores] = await Promise.all([
    getJson(ENDPOINTS.epicFree, { scope, retries: 2 }),
    getJson(ENDPOINTS.cheapSharkDeals, { scope, retries: 2 }),
    getJson(ENDPOINTS.cheapSharkStores, { scope, retries: 1 }),
  ]);

  const freeNow = [];
  const freeSoon = [];

  const elements = epic?.data?.Catalog?.searchStore?.elements ?? [];
  for (const el of elements) {
    const promos = el.promotions;
    if (!promos) continue;

    const image =
      pickImage(el.keyImages, ['OfferImageWide', 'DieselStoreFrontWide', 'Thumbnail', 'OfferImageTall']) || null;
    const slug =
      el.productSlug || el.urlSlug || el.catalogNs?.mappings?.[0]?.pageSlug || el.offerMappings?.[0]?.pageSlug;
    const base = {
      title: el.title,
      description: (el.description || '').slice(0, 200),
      image,
      store: 'Epic Games Store',
      url: slug
        ? `https://store.epicgames.com/en-US/p/${String(slug).replace(/\/home$/, '')}`
        : 'https://store.epicgames.com/en-US/free-games',
      originalPrice: el.price?.totalPrice?.fmtPrice?.originalPrice ?? null,
      offerType: el.offerType ?? null,
    };

    const current = promos.promotionalOffers?.[0]?.promotionalOffers?.[0];
    if (current && el.price?.totalPrice?.discountPrice === 0) {
      freeNow.push({ ...base, startDate: current.startDate, endDate: current.endDate, isFree: true });
      continue;
    }
    const upcoming = promos.upcomingPromotionalOffers?.[0]?.promotionalOffers?.[0];
    if (upcoming && upcoming.discountSetting?.discountPercentage === 0) {
      freeSoon.push({ ...base, startDate: upcoming.startDate, endDate: upcoming.endDate, isFree: false });
    }
  }

  const storeMap = new Map((stores ?? []).map((s) => [String(s.storeID), s.storeName]));

  const discounts = (Array.isArray(cheap) ? cheap : [])
    .filter((d) => Number(d.savings) >= 50 && Number(d.salePrice) > 0)
    .map((d) => ({
      title: d.title,
      store: storeMap.get(String(d.storeID)) || 'Store',
      salePrice: Number(d.salePrice),
      normalPrice: Number(d.normalPrice),
      savings: Math.round(Number(d.savings)),
      thumb: d.thumb,
      steamAppId: d.steamAppID || null,
      steamRating: d.steamRatingPercent ? Number(d.steamRatingPercent) : null,
      steamRatingText: d.steamRatingText || null,
      metacritic: d.metacriticScore && d.metacriticScore !== '0' ? Number(d.metacriticScore) : null,
      url: `https://www.cheapshark.com/redirect?dealID=${d.dealID}`,
      image: d.steamAppID
        ? `https://cdn.akamai.steamstatic.com/steam/apps/${d.steamAppID}/header.jpg`
        : d.thumb,
    }))
    .sort((a, b) => b.savings - a.savings)
    .slice(0, 24);

  if (!freeNow.length && !discounts.length) {
    warn(scope, 'no deals retrieved from either source');
    return null;
  }

  log(scope, `${freeNow.length} free now, ${freeSoon.length} free soon, ${discounts.length} discounts`);

  return {
    updated: new Date().toISOString(),
    sources: [
      { name: 'Epic Games Store promotions', url: 'https://store.epicgames.com/free-games' },
      { name: 'CheapShark', url: 'https://www.cheapshark.com/' },
    ],
    freeNow: freeNow.sort((a, b) => new Date(a.endDate) - new Date(b.endDate)),
    freeSoon: freeSoon.sort((a, b) => new Date(a.startDate) - new Date(b.startDate)),
    discounts,
  };
}

function pickImage(keyImages, preferences) {
  if (!Array.isArray(keyImages)) return null;
  for (const type of preferences) {
    const hit = keyImages.find((k) => k.type === type);
    if (hit?.url) return hit.url;
  }
  return keyImages[0]?.url ?? null;
}
