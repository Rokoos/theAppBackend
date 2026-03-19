import mongoose from 'mongoose';
import { Skin } from '../models/Skin.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/steamapp';

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(MONGODB_URI);

  // Ensure MongoDB Atlas indexes match the current schema and remove duplicates.
  // This is safe to run on startup; it will no-op if indexes are already correct.
  try {
    await Skin.syncIndexes();
  } catch (err) {
    console.warn('Skin.syncIndexes() failed:', err?.message ?? err);
  }
}
