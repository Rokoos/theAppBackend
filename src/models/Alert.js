import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    marketHashName: { type: String, required: true },
    gameId: { type: Number, required: true },
    targetPrice: { type: Number, required: true },
    condition: { type: String, enum: ['below', 'above'], required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

alertSchema.index({ userId: 1, isActive: 1 });

export const Alert = mongoose.model('Alert', alertSchema);
