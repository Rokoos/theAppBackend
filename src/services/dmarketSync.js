import { Skin } from "../models/Skin.js";
import { fetchDMarketMarketItemsCursorPage } from "./dmarketClient.js";
import axios from "axios";

const ALLOWED_APP_IDS = [730, 252490, 570, 440];
const SKINPORT_BASE = "https://api.skinport.com/v1/items";

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
  console.log("Targeting Collection:", Skin.collection.name);
  const appId = params.appId;
  const currency = params.currency || "USD";

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

      const bulkOps = [];
      for (const obj of objects) {
        fetched += 1;
        if (fetched % 100 === 0) {
          console.log(`[syncDMarket] gid=${gid} fetched=${fetched}`);
        }

        const title = obj?.title ?? obj?.extra?.name;
        const mhn = typeof title === "string" ? title.trim() : "";
        if (!mhn) continue;

        const priceCents = obj?.price?.USD ?? obj?.price?.Usd ?? null;
        const price = centsToDollars(priceCents);
        if (price == null) continue;

        const slug = typeof obj?.slug === "string" ? obj.slug : null;

        bulkOps.push({
          updateOne: {
            filter: {
              mhn,
              gid,
              $or: [{ "dm.price": null }, { "dm.price": { $gt: price } }],
            },
            update: {
              $set: {
                "dm.price": price,
                "dm.lastUpdated": new Date(),
                "dm.slug": slug,
              },
              $setOnInsert: { gid },
            },
            upsert: true,
          },
        });
      }

      if (bulkOps.length > 0) {
        try {
          const result = await Skin.bulkWrite(bulkOps, { ordered: false });
          console.log(
            `[syncDMarket] gid=${gid} bulkWrite upserted=${result.upsertedCount ?? 0} modified=${result.modifiedCount ?? 0} matched=${result.matchedCount ?? 0}`,
          );
        } catch (err) {
          // Surface first write/validation error so schema/data mismatch is visible.
          const firstWriteErr =
            err?.writeErrors?.[0]?.errmsg ||
            err?.writeErrors?.[0]?.message ||
            err?.errors?.[0]?.message ||
            err?.message;
          console.error(
            `[syncDMarket] gid=${gid} bulkWrite failed. firstError=${firstWriteErr}`,
          );
          if (err?.writeErrors?.[0]) {
            console.error(
              "[syncDMarket] firstWriteErrorFull:",
              JSON.stringify(err.writeErrors[0], null, 2),
            );
          }
        }
      }

      if (!nextCursor) {
        console.log(`[syncDMarket] done gid=${gid} fetched=${fetched} (cursor ended)`);
        break;
      }
      cursor = nextCursor;
    }
  }
}

/**
 * Sync SkinPort catalog into Mongo (Skin collection).
 * Stores the lowest available SkinPort price per marketHashName/game.
 */
export async function syncSkinport(params = {}) {
  console.log("Targeting Collection:", Skin.collection.name);
  const appId = params.appId;
  const currency = (params.currency || "USD").toUpperCase();
  const targets = typeof appId === "number" ? [appId] : ALLOWED_APP_IDS;

  for (const gid of targets) {
    if (!ALLOWED_APP_IDS.includes(gid)) continue;
    console.log(`[syncSkinport] start gid=${gid} currency=${currency}`);
    let fetched = 0;
    try {
      const { data } = await axios.get(SKINPORT_BASE, {
        params: { app_id: gid, currency, tradable: 1 },
        timeout: 20000,
        validateStatus: (s) => s === 200,
      });
      const objects = Array.isArray(data) ? data : [];
      for (const obj of objects) {
        fetched += 1;
        if (fetched % 100 === 0) {
          console.log(`[syncSkinport] gid=${gid} fetched=${fetched}`);
        }

        const mhn = typeof obj?.market_hash_name === "string" ? obj.market_hash_name.trim() : "";
        if (!mhn) continue;
        const p =
          typeof obj?.min_price === "number" ? obj.min_price :
          typeof obj?.suggested_price === "number" ? obj.suggested_price : null;
        if (p == null) continue;
        const slug = typeof obj?.slug === "string" ? obj.slug : null;

        await Skin.updateOne(
          {
            mhn,
            gid,
            $or: [{ "sp.price": null }, { "sp.price": { $gt: p } }],
          },
          {
            $set: {
              "sp.price": p,
              "sp.lastUpdated": new Date(),
              "sp.slug": slug,
            },
            $setOnInsert: { gid },
          },
          { upsert: true },
        );
      }
      console.log(`[syncSkinport] done gid=${gid} fetched=${fetched}`);
    } catch (err) {
      console.error(`[syncSkinport] failed gid=${gid}:`, err?.message || err);
    }
  }
}

