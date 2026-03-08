import express from 'express';
import { getMarketPrices } from '../services/marketService.js';

const router = express.Router();

const ALLOWED_GAME_IDS = [730, 252490, 570, 440];

function requireAuth(req, res, next) {
  if (!req.session?.user?.steamid) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

/**
 * GET /api/market/prices?gameId=730&currency=USD
 * Returns items from SkinPort (and DMarket when implemented) for the given game.
 * Cached 1 hour.
 */
router.get('/prices', requireAuth, async (req, res, next) => {
  try {
    const gameId = parseInt(req.query.gameId, 10);
    const currency = (req.query.currency || 'USD').toUpperCase();
    if (!Number.isInteger(gameId) || !ALLOWED_GAME_IDS.includes(gameId)) {
      return res.status(400).json({
        error: 'Invalid or missing gameId. Use 730 (CS2), 252490 (Rust), 570 (Dota 2), 440 (TF2).',
      });
    }
    const items = await getMarketPrices(gameId, { currency });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

export default router;
