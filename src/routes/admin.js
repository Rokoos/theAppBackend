import express from "express";
import mongoose from "mongoose";
import { syncDMarket } from "../services/dmarketSync.js";

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session?.user?.steamid) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

function requireDb(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database unavailable" });
  }
  next();
}

// Temporary admin route for manual sync testing.
// Visit /api/admin/force-sync in browser; logs will appear in Railway terminal.
router.get("/force-sync", requireAuth, requireDb, async (req, res) => {
  const appId = req.query.appId ? parseInt(String(req.query.appId), 10) : undefined;
  const currency = req.query.currency ? String(req.query.currency) : "USD";

  // Kick off sync without blocking the HTTP request.
  void syncDMarket({
    appId: typeof appId === "number" && Number.isFinite(appId) ? appId : undefined,
    currency,
  }).catch((err) => {
    console.error("[admin] force-sync failed:", err);
  });

  res.json({ ok: true, started: true, appId: appId ?? null, currency });
});

export default router;

