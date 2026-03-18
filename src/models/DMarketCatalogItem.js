import mongoose from "mongoose";

// DMarket catalog snapshot (per game) to allow fast browsing without
// repeatedly hitting the live DMarket API.
const dmarketCatalogItemSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true },
    marketHashName: { type: String, required: true },

    // DMarket API uses USD internally in this app; we store the USD prices
    // we get from the provider (or null if missing).
    currency: { type: String, default: "USD" },
    minPrice: { type: Number, default: null },
    maxPrice: { type: Number, default: null },
    suggestedPrice: { type: Number, default: null },

    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

dmarketCatalogItemSchema.index(
  { gameId: 1, marketHashName: 1 },
  { unique: true },
);
dmarketCatalogItemSchema.index({ gameId: 1, fetchedAt: -1 });

export const DMarketCatalogItem = mongoose.model(
  "DMarketCatalogItem",
  dmarketCatalogItemSchema,
);

