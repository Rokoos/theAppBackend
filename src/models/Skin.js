import mongoose from "mongoose";

// Optimized catalog schema for the lowest available price per marketHashName.
// Short keys to reduce MongoDB Atlas storage:
// - mhn: marketHashName
// - gid: gameId (Steam appid)
// - sp: SkinPort data snapshot (lowest price)
// - dm: DMarket data snapshot (lowest price)

const SkinSchema = new mongoose.Schema(
  {
    mhn: { type: String, required: true, unique: true }, // Market Hash Name
    gid: { type: String, required: true }, // Game ID (e.g., 730)
    img: String, // Image URL
    sp: {
      // Skinport Data
      p: Number, // Price
      u: Date, // Updated At
    },
    dm: {
      // DMarket Data
      p: Number, // Price
      u: Date, // Updated At
    },
  },
  { timestamps: false },
); // Disable timestamps to save even more bytes
export const Skin = mongoose.model("Skin", SkinSchema);
