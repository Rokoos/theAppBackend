import express from 'express';
import passport from 'passport';
import crypto from 'crypto';
import axios from 'axios';
import { fetchTargetInventories } from './inventory.js';
import { saveInventory, loadInventory } from '../db/inventoryStore.js';

const router = express.Router();

const FRONTEND_ORIGIN = process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

// Direct link from frontend: redirect to Steam auth (no JSON so the browser follows the redirect).
router.get('/steam/start', (req, res) => {
  const state = generateState();
  req.session.steamLoginState = state;
  res.redirect('/api/auth/steam?state=' + encodeURIComponent(state));
});

router.get(
  '/steam',
  (req, res, next) => {
    if (!req.query.state || req.query.state !== req.session.steamLoginState) {
      return res.status(400).json({ error: 'Invalid or missing state token' });
    }
    return next();
  },
  passport.authenticate('steam', { session: true })
);

router.get(
  '/steam/return',
  passport.authenticate('steam', { failureRedirect: '/?login=failed' }),
  async (req, res, next) => {
    try {
      const { STEAM_WEB_API_KEY } = process.env;
      const steamid = req.user?.profile?._json?.steamid;
      if (!steamid || !STEAM_WEB_API_KEY) {
        return res.status(500).json({ error: 'Steam verification misconfigured' });
      }

      const bansResp = await axios.get('https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/', {
        params: {
          key: STEAM_WEB_API_KEY,
          steamids: steamid
        }
      });

      const summariesResp = await axios.get('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/', {
        params: {
          key: STEAM_WEB_API_KEY,
          steamids: steamid
        }
      });

      const banInfo = bansResp.data?.players?.[0];
      const summary = summariesResp.data?.response?.players?.[0];

      if (!banInfo || !summary) {
        return res.status(403).json({ error: 'Unable to verify Steam account' });
      }

      if (banInfo.VACBanned || banInfo.NumberOfVACBans > 0) {
        return res.status(403).json({ error: 'VAC-banned accounts are not allowed' });
      }

      if (!summary.communityvisibilitystate || summary.communityvisibilitystate !== 3) {
        return res.status(403).json({ error: 'Steam profile must be public' });
      }

      req.session.user = {
        steamid,
        personaname: summary.personaname,
        avatar: summary.avatarfull
      };
      delete req.session.steamLoginState;

      // Send 200 + HTML redirect so the session cookie is set in a normal response.
      // Firefox often rejects cookies set on a 302 to another origin; 200 + client redirect helps.
      // Meta refresh only (no inline script) so CSP script-src nonce does not block the page.
      req.session.save((err) => {
        if (err) return next(err);
        const front = FRONTEND_ORIGIN.replace(/"/g, '&quot;');
        const redirectUrl = front + (front.includes('?') ? '&' : '?') + 'login=ok';
        const safeUrl = redirectUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        res.status(200).set('Content-Type', 'text/html; charset=utf-8').end(
          `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${safeUrl}"><title>Redirecting</title></head><body><p>Redirecting…</p></body></html>`
        );
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/logout', (req, res) => {
  req.logout?.(() => {});
  req.session.destroy(() => {
    // Clear both production and development cookie names.
    res.clearCookie('__Host-steamapp.sid');
    res.clearCookie('steamapp.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ user: req.session.user });
});

router.get('/me/inventory', async (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const steamid = req.session.user.steamid;

    if (req.session.targetInventories) {
      return res.json(req.session.targetInventories);
    }

    const cached = loadInventory(steamid);
    if (cached) {
      req.session.targetInventories = cached;
      return res.json(cached);
    }

    const { STEAM_WEB_API_KEY } = process.env;
    if (!STEAM_WEB_API_KEY) {
      return res.status(500).json({ error: 'Steam Web API key not configured' });
    }

    const gamesResp = await axios.get('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/', {
      params: {
        key: STEAM_WEB_API_KEY,
        steamid,
        include_appinfo: 1,
        include_played_free_games: 1
      }
    });

    const ownedGames = gamesResp.data?.response?.games ?? [];
    const ownedAppIds = ownedGames.map((g) => g.appid);

    const result = await fetchTargetInventories(steamid, ownedAppIds);

    req.session.targetInventories = result;
    saveInventory(steamid, result);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/me/games', async (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { STEAM_WEB_API_KEY } = process.env;
    if (!STEAM_WEB_API_KEY) {
      return res.status(500).json({ error: 'Steam Web API key not configured' });
    }

    const steamid = req.session.user.steamid;
    const resp = await axios.get('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/', {
      params: {
        key: STEAM_WEB_API_KEY,
        steamid,
        include_appinfo: 1,
        include_played_free_games: 1
      }
    });

    const games = resp.data?.response?.games ?? [];

    const simplified = games.map((g) => ({
      appid: g.appid,
      name: g.name,
      playtimeHours: g.playtime_forever ? Math.round(g.playtime_forever / 60) : 0,
      iconHash: g.img_icon_url
    }));

    res.json({ games: simplified });
  } catch (err) {
    next(err);
  }
});

export default router;

