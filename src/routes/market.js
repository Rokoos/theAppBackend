import express from 'express';
import { getMarketPrices } from '../services/marketService.js';

const router = express.Router();

const ALLOWED_GAME_IDS = [730, 252490, 570, 440];
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function requireAuth(req, res, next) {
  if (!req.session?.user?.steamid) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

/**
 * GET /api/market/prices?gameId=730&currency=USD&limit=50&offset=0
 * Returns items from SkinPort (and DMarket when implemented) for the given game.
 * limit: default 50; offset: default 0. Response: { items, total }.
 * Cached 1 hour.
 */
router.get('/prices', requireAuth, async (req, res, next) => {
  try {
    const gameId = parseInt(req.query.gameId, 10);
    const currency = (req.query.currency || 'USD').toUpperCase();
    const rawLimit = parseInt(req.query.limit, 10);
    const rawOffset = parseInt(req.query.offset, 10);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
    const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    if (!Number.isInteger(gameId) || !ALLOWED_GAME_IDS.includes(gameId)) {
      return res.status(400).json({
        error: 'Invalid or missing gameId. Use 730 (CS2), 252490 (Rust), 570 (Dota 2), 440 (TF2).',
      });
    }
    const all = await getMarketPrices(gameId, { currency });
    const list = Array.isArray(all) ? all : [];
    const total = list.length;
    const start = Math.min(offset, total);
    const end = Math.min(start + limit, total);
    const page = list.slice(start, end);
    const items = page.slice(0, limit);
    res.json({ items, total });
  } catch (err) {
    next(err);
  }
});

export default router;
