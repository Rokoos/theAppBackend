import passport from 'passport';
import { Strategy as SteamStrategy } from 'passport-steam';

export function configurePassport() {
  // APP_BASE_URL and STEAM_WEB_API_KEY are loaded from process.env (see server.js dotenv.config).
  const {
    APP_BASE_URL = 'http://localhost:4000',
    STEAM_WEB_API_KEY
  } = process.env;

  // Use origin only (no path) so returnURL/realm are never duplicated (e.g. .../return/api/auth/steam/return).
  const baseOrigin = (() => {
    try {
      const u = new URL(APP_BASE_URL);
      return u.origin;
    } catch {
      return APP_BASE_URL.replace(/\/+$/, '').replace(/\/(?:api\/auth\/steam\/return)?\/?$/, '') || APP_BASE_URL;
    }
  })();

  if (!STEAM_WEB_API_KEY) {
    console.warn('STEAM_WEB_API_KEY is not set. Steam Web API verification will fail.');
  }

  passport.serializeUser((user, done) => {
    done(null, user);
  });

  passport.deserializeUser((obj, done) => {
    done(null, obj);
  });

  passport.use(new SteamStrategy(
    {
      returnURL: `${baseOrigin}/api/auth/steam/return`,
      realm: `${baseOrigin}/`,
      apiKey: STEAM_WEB_API_KEY
    },
    (identifier, profile, done) => {
      process.nextTick(() => done(null, { identifier, profile }));
    }
  ));
}

