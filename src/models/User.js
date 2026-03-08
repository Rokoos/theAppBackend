import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    steamid: { type: String, required: true, unique: true },
    tier: { type: String, enum: ['free', 'pro'], default: 'free' },
    alertLimit: { type: Number, default: 3 },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
