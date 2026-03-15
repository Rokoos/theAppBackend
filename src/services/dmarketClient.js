/**
 * DMarket API client: signed requests for market data.
 * Docs: https://docs.dmarket.com/v1/swagger.html
 * Auth: X-Api-Key (public), X-Sign-Date (timestamp), X-Request-Sign (Ed25519 hex).
 */
import nacl from "tweetnacl";
import axios from "axios";

const DMARKET_BASE = "https://api.dmarket.com";

/** Steam app_id -> DMarket gameId (CS:GO, TF2, Dota 2, Rust) */
const APP_ID_TO_GAME_ID = {
  730: "a8db", // CS2 / CS:GO
  440: "tf2",
  570: "9a92",
  252490: "rust",
};

/**
 * Build the string that gets signed: (Method)(Path+Query)(Body)(Timestamp)
 * @param {string} method - GET or POST
 * @param {string} pathWithQuery - e.g. /exchange/v1/market/items?gameId=a8db&limit=100
 * @param {string} body - JSON body for POST, "" for GET
 * @param {string} timestamp - Unix time string
 */
function buildSignString(method, pathWithQuery, body, timestamp) {
  return method + pathWithQuery + (body || "") + timestamp;
}

/**
 * Sign a request and return headers for DMarket API.
 * @param {string} method - GET or POST
 * @param {string} pathWithQuery - path including query string
 * @param {string} body - request body or ""
 * @param {string} publicKeyHex - PUBLIC_API_KEY (hex lowercase)
 * @param {string} privateKeyHex - PRIVATE_API_KEY (hex, 64 bytes = 128 chars for NaCl secretKey)
 */
function signRequest(method, pathWithQuery, body, publicKeyHex, privateKeyHex) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signString = buildSignString(method, pathWithQuery, body, timestamp);
  const keyBytes = Buffer.from(privateKeyHex, "hex");
  let secretKey;
  if (keyBytes.length === 32) {
    secretKey = nacl.sign.keyPair.fromSeed(new Uint8Array(keyBytes)).secretKey;
  } else if (keyBytes.length === 64) {
    secretKey = new Uint8Array(keyBytes);
  } else {
    throw new Error(
      `DMarket PRIVATE_API_KEY must be 32 bytes (64 hex) or 64 bytes (128 hex), got ${keyBytes.length}`,
    );
  }
  const signature = nacl.sign.detached(
    Buffer.from(signString, "utf8"),
    secretKey,
  );
  const signatureHex = Buffer.from(signature).toString("hex");
  // DMarket requires this exact prefix for X-Request-Sign (see docs / @cs2/dmarket)
  return {
    "X-Api-Key": publicKeyHex.toLowerCase(),
    "X-Sign-Date": timestamp,
    "X-Request-Sign": `dmar ed25519 ${signatureHex}`,
  };
}

const DMARKET_PAGE_SIZE = 100;
const DMARKET_MAX_CURSOR_PAGES = 100;
const DMARKET_MAX_OFFSET_PAGES = 100;

/**
 * Build query string for market items (cursor-based). Fixed param order for signing.
 */
function buildMarketItemsQuery(gameId, apiCurrency, cursor) {
  const params = new URLSearchParams();
  params.set("currency", apiCurrency);
  if (cursor) params.set("cursor", cursor);
  params.set("gameId", gameId);
  params.set("limit", String(DMARKET_PAGE_SIZE));
  params.set("orderBy", "title");
  params.set("orderDir", "asc");
  return params.toString();
}

/**
 * Build query string for market items (offset-based). Same param order for signing.
 */
function buildMarketItemsQueryWithOffset(gameId, apiCurrency, offset) {
  const params = new URLSearchParams();
  params.set("currency", apiCurrency);
  params.set("gameId", gameId);
  params.set("limit", String(DMARKET_PAGE_SIZE));
  params.set("offset", String(offset));
  params.set("orderBy", "title");
  params.set("orderDir", "asc");
  return params.toString();
}

/**
 * Fetch one page of market items (signed request).
 * @returns {{ objects: array, cursor?: string }}
 */
async function fetchDMarketMarketItemsPage(
  pathWithQuery,
  url,
  publicKey,
  privateKey,
) {
  const headers = signRequest("GET", pathWithQuery, "", publicKey, privateKey);
  headers["Accept"] = "application/json";
  const { data } = await axios.get(url, {
    headers,
    timeout: 20000,
    validateStatus: (s) => s === 200,
  });
  const objects = Array.isArray(data?.objects) ? data.objects : [];
  const nextCursor =
    data?.cursor ?? data?.nextCursor ?? data?.Cursor ?? null;
  const cursorStr =
    nextCursor != null && String(nextCursor).trim()
      ? String(nextCursor).trim()
      : null;
  return { objects, cursor: cursorStr };
}

/**
 * Fetch market items from DMarket for a game.
 * Uses cursor pagination first; if the API returns no cursor or stops early,
 * falls back to offset pagination to fetch more pages (up to thousands of items).
 * Response: { objects: [...], cursor?: string }. Prices in cents.
 */
export async function fetchDMarketMarketItems(
  appId,
  currency = "USD",
  limit = 100,
) {
  const publicKey =
    process.env.PUBLIC_API_KEY ?? process.env.DM_PUBLIC_API_KEY;
  const privateKey =
    process.env.PRIVATE_API_KEY ?? process.env.DM_PRIVATE_API_KEY;
  if (!publicKey || !privateKey) {
    console.warn(
      "DMarket: PUBLIC_API_KEY/PRIVATE_API_KEY (or DM_* variants) not set, skipping.",
    );
    return [];
  }

  const gameId = APP_ID_TO_GAME_ID[appId];
  if (!gameId) {
    return [];
  }

  const apiCurrency =
    (currency && String(currency).toUpperCase() === "DMC") ? "DMC" : "USD";

  const path = "/exchange/v1/market/items";
  const all = [];
  let cursor = null;

  try {
    // 1) Cursor-based pagination: keep going while we have a cursor (don't stop on short page)
    for (let page = 0; page < DMARKET_MAX_CURSOR_PAGES; page++) {
      const query = buildMarketItemsQuery(gameId, apiCurrency, cursor);
      const pathWithQuery = `${path}?${query}`;
      const url = `${DMARKET_BASE}${pathWithQuery}`;

      const { objects, cursor: nextCursor } =
        await fetchDMarketMarketItemsPage(
          pathWithQuery,
          url,
          publicKey,
          privateKey,
        );
      all.push(...objects);
      if (!nextCursor) break;
      cursor = nextCursor;
    }

    // 2) If we got very few items, API may not be returning cursor; try offset-based pages
    if (all.length < 500) {
      for (let offsetPage = 1; offsetPage < DMARKET_MAX_OFFSET_PAGES; offsetPage++) {
        const offset = offsetPage * DMARKET_PAGE_SIZE;
        const query = buildMarketItemsQueryWithOffset(
          gameId,
          apiCurrency,
          offset,
        );
        const pathWithQuery = `${path}?${query}`;
        const url = `${DMARKET_BASE}${pathWithQuery}`;
        try {
          const { objects } = await fetchDMarketMarketItemsPage(
            pathWithQuery,
            url,
            publicKey,
            privateKey,
          );
          if (objects.length === 0) break;
          all.push(...objects);
          if (objects.length < DMARKET_PAGE_SIZE) break;
        } catch {
          break;
        }
      }
    }

    return all;
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;
    console.warn(
      "DMarket fetch failed for appId",
      appId,
      status ?? err.message,
      body != null ? JSON.stringify(body) : "",
    );
    return [];
  }
}

export { APP_ID_TO_GAME_ID };
