import express from 'express';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Alert } from '../models/Alert.js';

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session?.user?.steamid) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

function requireDb(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Database unavailable' });
  }
  next();
}

async function getOrCreateUser(steamid) {
  let user = await User.findOne({ steamid });
  if (!user) {
    user = await User.create({ steamid, tier: 'free', alertLimit: 3 });
  }
  return user;
}

/**
 * GET /api/alerts – fetch the current user's active watchlist.
 */
router.get('/', requireAuth, requireDb, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.session.user.steamid);
    const alerts = await Alert.find({ userId: user._id, isActive: true })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ alerts, tier: user.tier, alertLimit: user.alertLimit });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/alerts – create an alert. Enforcer: free tier max 3 active alerts.
 */
router.post('/', requireAuth, requireDb, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.session.user.steamid);
    const { marketHashName, gameId, targetPrice, condition } = req.body;

    if (!marketHashName || gameId == null || targetPrice == null || !condition) {
      return res.status(400).json({
        error: 'Missing fields: marketHashName, gameId, targetPrice, condition (below|above)',
      });
    }
    if (!['below', 'above'].includes(condition)) {
      return res.status(400).json({ error: 'condition must be "below" or "above"' });
    }

    const activeCount = await Alert.countDocuments({ userId: user._id, isActive: true });
    const limit = user.alertLimit ?? 3;
    if (user.tier === 'free' && activeCount >= limit) {
      return res.status(403).json({
        error: 'Limit reached. Upgrade to Pro.',
        code: 'ALERT_LIMIT_REACHED',
      });
    }

    const alert = await Alert.create({
      userId: user._id,
      marketHashName: String(marketHashName).trim(),
      gameId: Number(gameId),
      targetPrice: Number(targetPrice),
      condition,
      isActive: true,
    });
    res.status(201).json(alert);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/alerts/:id – deactivate an alert (or toggle isActive).
 */
router.patch('/:id', requireAuth, requireDb, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.session.user.steamid);
    const alert = await Alert.findOne({ _id: req.params.id, userId: user._id });
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    alert.isActive = req.body.isActive !== false;
    await alert.save();
    res.json(alert);
  } catch (err) {
    next(err);
  }
});

export default router;
