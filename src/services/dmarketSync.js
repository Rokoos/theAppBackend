import { Skin } from "../models/Skin.js";
import { fetchDMarketMarketItemsCursorPage } from "./dmarketClient.js";

const ALLOWED_APP_IDS = [730, 252490, 570, 440];

function centsToDollars(centsStr) {
  if (centsStr == null) return null;
  const n = parseFloat(String(centsStr), 10);
  if (Number.isNaN(n) || !Number.isFinite(n)) return null;
  return n / 100;
}

/**
 * Sync DMarket catalog into Mongo (Skin collection).
 * We store the lowest available price per marketHashName (mhn).
 * We do NOT store listing/offer IDs.
 *
 * @param {{ appId?: number, currency?: string, maxObjects?: number }} params
 */
export async function syncDMarket(params = {}) {
  const appId = params.appId;
  const currency = params.currency || "USD";
  const maxObjects = params.maxObjects ?? 20000; // safety cap

  const targets = typeof appId === "number" ? [appId] : ALLOWED_APP_IDS;
  for (const gid of targets) {
    if (!ALLOWED_APP_IDS.includes(gid)) continue;

    let cursor = null;
    let fetched = 0;

    console.log(`[syncDMarket] start gid=${gid} currency=${currency}`);
    while (true) {
      const { objects, cursor: nextCursor } =
        await fetchDMarketMarketItemsCursorPage(gid, currency, cursor);

      if (!Array.isArray(objects) || objects.length === 0) {
        console.log(`[syncDMarket] done gid=${gid} fetched=${fetched} (no more objects)`);
        break;
      }

      for (const obj of objects) {
        fetched += 1;
        if (fetched % 100 === 0) {
          console.log(`[syncDMarket] gid=${gid} fetched=${fetched}`);
        }
        if (fetched >= maxObjects) {
          console.log(`[syncDMarket] gid=${gid} reached maxObjects=${maxObjects}`);
          break;
        }

        const title = obj?.title ?? obj?.extra?.name;
        const mhn = typeof title === "string" ? title.trim() : "";
        if (!mhn) continue;

        const priceCents = obj?.price?.USD ?? obj?.price?.Usd ?? null;
        const price = centsToDollars(priceCents);
        if (price == null) continue;

        const slug = typeof obj?.slug === "string" ? obj.slug : null;

        // Update only if the existing price is null or higher.
        await Skin.updateOne(
          {
            mhn,
            gid,
            $or: [{ "dm.price": null }, { "dm.price": { $gt: price } }],
          },
          {
            $set: {
              "dm.price": price,
              "dm.lastUpdated": new Date(),
              "dm.slug": slug,
            },
            $setOnInsert: { gid: gid },
          },
          { upsert: true },
        );
      }

      if (fetched >= maxObjects) break;
      if (!nextCursor) {
        console.log(`[syncDMarket] done gid=${gid} fetched=${fetched} (cursor ended)`);
        break;
      }
      cursor = nextCursor;
    }
  }
}

