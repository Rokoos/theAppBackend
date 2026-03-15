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
  const secretKeyBytes = Buffer.from(privateKeyHex, "hex");
  if (secretKeyBytes.length !== 64) {
    throw new Error(
      `DMarket PRIVATE_API_KEY must be 64 bytes (128 hex chars), got ${secretKeyBytes.length}`,
    );
  }
  const signature = nacl.sign.detached(
    Buffer.from(signString, "utf8"),
    new Uint8Array(secretKeyBytes),
  );
  const signatureHex = Buffer.from(signature).toString("hex");
  return {
    "X-Api-Key": publicKeyHex.toLowerCase(),
    "X-Sign-Date": timestamp,
    "X-Request-Sign": signatureHex,
  };
}

/**
 * Fetch market items from DMarket for a game.
 * GET /exchange/v1/market/items?gameId=...&limit=...&currency=...
 * Response: { objects: [{ title, price: { USD }, suggestedPrice: { USD }, ... }], cursor }
 * Prices are in cents (coins).
 */
export async function fetchDMarketMarketItems(
  appId,
  currency = "USD",
  limit = 100,
) {
  const publicKey = process.env.DM_PUBLIC_API_KEY;
  const privateKey = process.env.DM_PRIVATE_API_KEY;
  if (!publicKey || !privateKey) {
    console.warn(
      "DMarket: PUBLIC_API_KEY or PRIVATE_API_KEY not set, skipping.",
    );
    return [];
  }

  const gameId = APP_ID_TO_GAME_ID[appId];
  if (!gameId) {
    return [];
  }

  const path = "/exchange/v1/market/items";
  const params = new URLSearchParams({
    gameId,
    limit: String(limit),
    currency,
    orderBy: "title",
    orderDir: "asc",
  });
  const pathWithQuery = `${path}?${params.toString()}`;
  const url = `${DMARKET_BASE}${pathWithQuery}`;

  // DMarket sign string uses path+query (no leading slash in some docs; try with it)
  const headers = signRequest("GET", pathWithQuery, "", publicKey, privateKey);
  headers["Accept"] = "application/json";

  try {
    const { data } = await axios.get(url, {
      headers,
      timeout: 15000,
      validateStatus: (s) => s === 200,
    });
    const objects = data?.objects ?? [];
    return Array.isArray(objects) ? objects : [];
  } catch (err) {
    const status = err.response?.status;
    console.warn(
      "DMarket fetch failed for appId",
      appId,
      status ?? err.message,
    );
    return [];
  }
}

export { APP_ID_TO_GAME_ID };
