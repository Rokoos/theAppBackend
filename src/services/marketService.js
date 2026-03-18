import axios from 'axios';
import { DMarketCatalogItem } from '../models/DMarketCatalogItem.js';

const CACHE_MS = 60 * 60 * 1000; // 1 hour

const SKINPORT_APP_IDS = [730, 252490, 570, 440];
const SKINPORT_BASE = 'https://api.skinport.com/v1/items';
const SKINPORT_HISTORY_BASE = 'https://api.skinport.com/v1/sales/history';

const memoryCache = new Map();
const DMARKET_CATALOG_CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours
const DMARKET_CATALOG_MIN_ITEMS = 200; // if we have fewer, refresh (avoid stuck underfilled snapshots)

function cacheKey(source, gameId, currency = '') {
  return `${source}:${gameId}:${currency}`;
}

function isCacheValid(entry) {
  return entry && Date.now() - entry.fetchedAt < CACHE_MS;
}

/** Parse DMarket price (cents string) to number in dollars. */
function dmarketCentsToDollars(centsStr) {
  if (centsStr == null) return null;
  const n = parseFloat(String(centsStr), 10);
  if (Number.isNaN(n)) return null;
  return n / 100;
}

/**
 * Fetch items from SkinPort for a given app_id. Game mapping: 730 (CS2), 252490 (Rust), 570 (Dota 2), 440 (TF2).
 */
async function fetchSkinPortItems(appId = 730, currency = 'USD') {
  const key = cacheKey('skinport', appId, currency);
  if (memoryCache.has(key) && isCacheValid(memoryCache.get(key))) {
    return memoryCache.get(key).items;
  }
  const requestConfig = {
    params: { app_id: appId, currency, tradable: 1 },
    // Lower timeout so the UI doesn't hang too long on slow/limited SkinPort.
    timeout: 7000,
    validateStatus: (status) => status === 200,
  };

  try {
    const { data } = await axios.get(SKINPORT_BASE, {
      ...requestConfig,
      headers: { 'Accept-Encoding': 'br' },
    });
    const items = Array.isArray(data) ? data : [];
    if (items.length > 0) {
      memoryCache.set(key, { items, fetchedAt: Date.now() });
    }
    return items;
  } catch (err) {
    const status = err.response?.status;
    const msg = status ? `status ${status}` : err.message;
    console.warn('SkinPort fetch failed for appId', appId, msg);
    const stale = memoryCache.get(key);
    if (stale?.items?.length) return stale.items;
    if (status === 429) {
      console.warn('SkinPort rate limit (8 req/5 min). Using empty SkinPort data.');
    }
    // Fail fast: no second retry with different encoding. Caller can still
    // combine this with DMarket data and avoid long hangs.
    return [];
  }
}

/**
 * Fetch DMarket market items and aggregate by title to one row per item (min/max/suggested).
 * DMarket API only accepts USD or DMC; we request in that currency and label items accordingly.
 */
async function fetchDMarketItems(appId, currency = 'USD') {
  const dmarketCurrency =
    (currency && String(currency).toUpperCase() === 'DMC') ? 'DMC' : 'USD';
  const key = cacheKey('dmarket', appId, dmarketCurrency);
  if (memoryCache.has(key) && isCacheValid(memoryCache.get(key))) {
    return memoryCache.get(key).items;
  }

  // If we already synced a catalog snapshot into MongoDB, serve from there
  // BUT refresh if it looks underfilled (e.g. previous fetch only captured 74).
  try {
    const cutoff = new Date(Date.now() - DMARKET_CATALOG_CACHE_MS);
    const cached = await DMarketCatalogItem.find({
      gameId: appId,
      currency: dmarketCurrency === "USD" ? "USD" : "DMC",
      fetchedAt: { $gte: cutoff },
    })
      .sort({ marketHashName: 1 })
      .lean();
    if (Array.isArray(cached) && cached.length >= DMARKET_CATALOG_MIN_ITEMS) {
      return cached.map((doc) => ({
        market_hash_name: doc.marketHashName,
        marketHashName: doc.marketHashName,
        source: 'dmarket',
        currency: doc.currency,
        minPrice: doc.minPrice,
        maxPrice: doc.maxPrice,
        suggestedPrice: doc.suggestedPrice,
      }));
    }
  } catch (err) {
    // If Mongo lookup fails, fall back to live fetch.
    console.warn('DMarket catalog Mongo lookup failed:', err.message);
  }

  try {
    const { fetchDMarketMarketItems } = await import('./dmarketClient.js');
    // Fetch a much larger set to cover all skins for that game.
    // NOTE: this is only done on the first request when Mongo doesn't have a snapshot.
    const raw = await fetchDMarketMarketItems(appId, dmarketCurrency, 5000);

    // Use market_hash_name as the real unique key to avoid collapsing distinct skins.
    const byMarketHashName = new Map();
    const priceKey = dmarketCurrency;
    for (const obj of raw) {
      const marketHashName = String(
        obj?.market_hash_name ??
          obj?.marketHashName ??
          obj?.title ??
          obj?.extra?.name ??
          '',
      ).trim();
      if (!marketHashName) continue;

      const priceVal = obj?.price?.[priceKey] ?? obj?.price?.USD ?? obj?.price?.Usd;
      const suggestedVal =
        obj?.suggestedPrice?.[priceKey] ??
        obj?.suggestedPrice?.USD ??
        obj?.suggestedPrice?.Usd;
      const priceUsd = dmarketCentsToDollars(priceVal);
      const suggestedUsd = dmarketCentsToDollars(suggestedVal);
      const amount = priceUsd ?? suggestedUsd ?? null;

      const existing = byMarketHashName.get(marketHashName);
      if (!existing) {
        byMarketHashName.set(marketHashName, {
          marketHashName,
          market_hash_name: marketHashName,
          source: 'dmarket',
          currency: dmarketCurrency,
          minPrice: amount,
          maxPrice: amount,
          suggestedPrice: amount,
        });
      }
    }

    const items = Array.from(byMarketHashName.values());

    // Persist snapshot into Mongo for subsequent fast reads.
    if (items.length > 0) {
      const docs = items.map((it) => ({
        gameId: appId,
        marketHashName: it.marketHashName,
        currency: it.currency,
        minPrice: it.minPrice ?? null,
        maxPrice: it.maxPrice ?? null,
        suggestedPrice: it.suggestedPrice ?? null,
        fetchedAt: new Date(),
      }));

      try {
        const ops = docs.map((d) => ({
          updateOne: {
            filter: { gameId: d.gameId, marketHashName: d.marketHashName },
            update: { $set: d },
            upsert: true,
          },
        }));
        if (ops.length > 0) await DMarketCatalogItem.bulkWrite(ops, { ordered: false });
      } catch (dbErr) {
        console.warn('DMarket catalog bulkWrite failed:', dbErr.message);
      }
    }

    if (items.length > 0) {
      memoryCache.set(key, { items, fetchedAt: Date.now() });
    }
    return items;
  } catch (err) {
    console.warn('DMarket fetch failed for appId', appId, err.message);
    return [];
  }
}

// Helper: run a promise with a hard timeout and return [] on failure/timeout.
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), ms);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve([]);
      });
  });
}

/**
 * Get latest market prices for a game, from cache or external APIs.
 * Prefer in-memory cache (1h), then DB MarketPrice cache, then fast fetch.
 * We cap external wait time per source so the user never waits too long.
 */
export async function getMarketPrices(gameId, options = {}) {
  const { currency = 'USD', forceRefresh = false } = options;
  const key = cacheKey('market', gameId, currency);
  if (!forceRefresh && memoryCache.has(key) && isCacheValid(memoryCache.get(key))) {
    return memoryCache.get(key).items;
  }
  // Fetch SkinPort and DMarket in parallel. We cap SkinPort more aggressively,
  // but give DMarket a bit more time since it can page through more data.
  const [items, dmarket] = await Promise.all([
    withTimeout(fetchSkinPortItems(gameId, currency), 2500),
    // Allow longer only for the initial Mongo-less catalog fill.
    // Subsequent requests should be served instantly from Mongo.
    withTimeout(fetchDMarketItems(gameId, currency), 30000),
  ]);
  const result = [];
  for (const it of items) {
    result.push({
      source: 'skinport',
      ...it,
      marketHashName: it.market_hash_name,
      market_hash_name: it.market_hash_name,
      suggestedPrice: it.suggested_price,
      minPrice: it.min_price,
      maxPrice: it.max_price,
      meanPrice: it.mean_price,
      medianPrice: it.median_price,
      currency: it.currency || currency,
    });
  }
  for (const it of dmarket) {
    const name = it.market_hash_name || it.marketHashName;
    if (!name) continue;
    result.push({
      source: 'dmarket',
      ...it,
      marketHashName: name,
      market_hash_name: name,
      currency: it.currency || currency,
    });
  }
  if (result.length > 0) {
    memoryCache.set(key, { items: result, fetchedAt: Date.now() });
  }
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

/**
 * Fetch historical sales for a specific item from SkinPort.
 * Uses SkinPort /v1/sales/history. Returns an array of points:
 * [{ time: Date ISO string, median: number }, ...].
 */
export async function getSkinportHistory(gameId, marketHashName, days = 30) {
  if (!SKINPORT_APP_IDS.includes(gameId)) {
    // SkinPort does not support this game; let caller show "no data".
    return { points: [], warning: 'unsupported-game' };
  }
  const app_id = gameId;
  const historyWindow = days || 30;
  try {
    const { data } = await axios.get(SKINPORT_HISTORY_BASE, {
      params: {
        app_id,
        market_hash_name: marketHashName,
        days: historyWindow,
      },
      timeout: 5000,
      validateStatus: (status) => status === 200,
    });
    const raw = Array.isArray(data) ? data : [];
    const points = raw
      .map((row) => {
        const t = row?.time || row?.timestamp;
        const m = row?.median_price ?? row?.median;
        if (!t || m == null) return null;
        const ts = typeof t === 'number' ? t * 1000 : Date.parse(String(t));
        if (Number.isNaN(ts)) return null;
        const price = Number(m);
        if (!Number.isFinite(price)) return null;
        return { time: new Date(ts).toISOString(), median: price };
      })
      .filter(Boolean);
    return { points, warning: points.length ? null : 'no-points' };
  } catch (err) {
    console.warn('SkinPort history fetch failed for', app_id, marketHashName, err.message);
    return { points: [], warning: 'error' };
  }
}
