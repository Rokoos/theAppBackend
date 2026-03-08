import axios from 'axios';

const CACHE_MS = 60 * 60 * 1000; // 1 hour

const SKINPORT_APP_IDS = [730, 252490, 570, 440];
const SKINPORT_BASE = 'https://api.skinport.com/v1/items';

const memoryCache = new Map();

function cacheKey(source, gameId) {
  return `${source}:${gameId}`;
}

function isCacheValid(entry) {
  return entry && Date.now() - entry.fetchedAt < CACHE_MS;
}

/**
 * Fetch items from SkinPort for a given app_id. Game mapping: 730 (CS2), 252490 (Rust), 570 (Dota 2), 440 (TF2).
 */
async function fetchSkinPortItems(appId = 730, currency = 'USD') {
  const key = cacheKey('skinport', appId);
  if (memoryCache.has(key) && isCacheValid(memoryCache.get(key))) {
    return memoryCache.get(key).items;
  }
  try {
    const { data } = await axios.get(SKINPORT_BASE, {
      params: { app_id: appId, currency, tradable: 1 },
      headers: { 'Accept-Encoding': 'br' },
      timeout: 20000,
    });
    const items = Array.isArray(data) ? data : [];
    memoryCache.set(key, { items, fetchedAt: Date.now() });
    return items;
  } catch (err) {
    console.warn('SkinPort fetch failed for appId', appId, err.message);
    const stale = memoryCache.get(key);
    if (stale) return stale.items;
    return [];
  }
}

/**
 * DMarket: stub for now (public API may require key or different endpoint).
 */
async function fetchDMarketItems(appId, currency = 'USD') {
  const key = cacheKey('dmarket', appId);
  if (memoryCache.has(key) && isCacheValid(memoryCache.get(key))) {
    return memoryCache.get(key).items;
  }
  try {
    // Placeholder: DMarket public API varies; return empty and cache to avoid rate limits.
    const items = [];
    memoryCache.set(key, { items, fetchedAt: Date.now() });
    return items;
  } catch (err) {
    console.warn('DMarket fetch failed for appId', appId, err.message);
    return [];
  }
}

/**
 * Get latest market prices for a game, from cache or external APIs.
 * Prefer in-memory cache (1h), then DB MarketPrice cache, then fetch.
 */
export async function getMarketPrices(gameId, options = {}) {
  const { currency = 'USD', forceRefresh = false } = options;
  const key = cacheKey('skinport', gameId);
  if (!forceRefresh && memoryCache.has(key) && isCacheValid(memoryCache.get(key))) {
    return memoryCache.get(key).items;
  }
  const items = await fetchSkinPortItems(gameId, currency);
  const dmarket = await fetchDMarketItems(gameId, currency);
  const byName = new Map();
  for (const it of items) {
    byName.set(it.market_hash_name, {
      source: 'skinport',
      ...it,
      marketHashName: it.market_hash_name,
      suggestedPrice: it.suggested_price,
      minPrice: it.min_price,
      maxPrice: it.max_price,
      meanPrice: it.mean_price,
      medianPrice: it.median_price,
    });
  }
  for (const it of dmarket) {
    const name = it.market_hash_name || it.marketHashName;
    if (name && !byName.has(name)) {
      byName.set(name, { source: 'dmarket', ...it, marketHashName: name });
    }
  }
  const result = Array.from(byName.values());
  memoryCache.set(key, { items: result, fetchedAt: Date.now() });
  return result;
}

/**
 * Get price for a single market_hash_name (from cache or first page of results).
 */
export async function getPriceForItem(gameId, marketHashName, currency = 'USD') {
  const items = await getMarketPrices(gameId, { currency });
  const normalized = (marketHashName || '').trim();
  const found = items.find(
    (i) => (i.market_hash_name || i.marketHashName || '').toLowerCase() === normalized.toLowerCase()
  );
  return found
    ? {
        minPrice: found.minPrice ?? found.min_price,
        maxPrice: found.maxPrice ?? found.max_price,
        suggestedPrice: found.suggestedPrice ?? found.suggested_price,
        meanPrice: found.meanPrice ?? found.mean_price,
      }
    : null;
}
