import mongoose from "mongoose";

// Optimized catalog schema for the lowest available price per marketHashName.
// Short keys to reduce MongoDB Atlas storage:
// - mhn: marketHashName
// - gid: gameId (Steam appid)
// - sp: SkinPort data snapshot (lowest price)
// - dm: DMarket data snapshot (lowest price)
const skinSchema = new mongoose.Schema(
  {
    // Unique market identifier (across all supported games in your app).
    mhn: { type: String, required: true, unique: true },

    // Game identifier (indexed for fast lookup/filtering).
    gid: { type: Number, required: true, index: true },

    // SkinPort lowest price snapshot.
    sp: {
      price: { type: Number, default: null },
      lastUpdated: { type: Date, default: null },
      slug: { type: String, default: null }, // url part
    },

    // DMarket lowest price snapshot.
    dm: {
      price: { type: Number, default: null },
      lastUpdated: { type: Date, default: null },
      slug: { type: String, default: null }, // url part
    },
  },
  {
    versionKey: false,
    timestamps: false,
  },
);

// Explicit indexes per request:
skinSchema.index({ mhn: 1 }, { unique: true });
skinSchema.index({ gid: 1 });

export const Skin = mongoose.model("Skin", skinSchema);

