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
const DMARKET_MAX_PAGES = 15; // cap to avoid too many requests (~1500 items max)

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
    timeout: 15000,
    validateStatus: (s) => s === 200,
  });
  return {
    objects: Array.isArray(data?.objects) ? data.objects : [],
    cursor: data?.cursor ?? null,
  };
}

/**
 * Fetch market items from DMarket for a game, following cursor until no more pages or cap.
 * GET /exchange/v1/market/items?gameId=...&limit=100&currency=...&cursor=...
 * Response: { objects: [{ title, price: { USD }, ... }], cursor }
 * Prices are in cents (coins).
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
  let page = 0;

  try {
    do {
      const params = new URLSearchParams({
        gameId,
        limit: String(DMARKET_PAGE_SIZE),
        currency: apiCurrency,
        orderBy: "title",
        orderDir: "asc",
      });
      if (cursor) params.set("cursor", cursor);
      const pathWithQuery = `${path}?${params.toString()}`;
      const url = `${DMARKET_BASE}${pathWithQuery}`;

      const { objects, cursor: nextCursor } =
        await fetchDMarketMarketItemsPage(
          pathWithQuery,
          url,
          publicKey,
          privateKey,
        );
      all.push(...objects);
      cursor =
        nextCursor && String(nextCursor).trim() ? String(nextCursor).trim() : null;
      page += 1;
    } while (cursor && page < DMARKET_MAX_PAGES);
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
