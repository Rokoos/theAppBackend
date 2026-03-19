import express from "express";
import mongoose from "mongoose";
import { syncDMarket, syncSkinport } from "../services/dmarketSync.js";

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
  const source = req.query.source ? String(req.query.source).toLowerCase() : "all";

  // Kick off sync without blocking the HTTP request.
  const syncParams = {
    appId: typeof appId === "number" && Number.isFinite(appId) ? appId : undefined,
    currency,
  };

  if (source === "dmarket") {
    void syncDMarket(syncParams).catch((err) => {
      console.error("[admin] force-sync dmarket failed:", err);
    });
  } else if (source === "skinport") {
    void syncSkinport(syncParams).catch((err) => {
      console.error("[admin] force-sync skinport failed:", err);
    });
  } else {
    void (async () => {
      await syncDMarket(syncParams);
      await syncSkinport(syncParams);
    })().catch((err) => {
      console.error("[admin] force-sync all failed:", err);
    });
  }

  res.json({ ok: true, started: true, appId: appId ?? null, currency, source });
});

export default router;

