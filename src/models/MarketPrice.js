import mongoose from 'mongoose';

const marketPriceSchema = new mongoose.Schema(
  {
    source: { type: String, required: true },
    gameId: { type: Number, required: true },
    marketHashName: { type: String, required: true },
    currency: { type: String, default: 'USD' },
    minPrice: Number,
    maxPrice: Number,
    meanPrice: Number,
    medianPrice: Number,
    suggestedPrice: Number,
    quantity: Number,
    raw: mongoose.Schema.Types.Mixed,
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

marketPriceSchema.index({ source: 1, gameId: 1, marketHashName: 1 }, { unique: true });
marketPriceSchema.index({ fetchedAt: 1 });

export const MarketPrice = mongoose.model('MarketPrice', marketPriceSchema);
