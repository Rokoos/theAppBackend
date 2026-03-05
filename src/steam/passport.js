import passport from 'passport';
import { Strategy as SteamStrategy } from 'passport-steam';

export function configurePassport() {
  // APP_BASE_URL and STEAM_WEB_API_KEY are loaded from process.env (see server.js dotenv.config).
  const {
    APP_BASE_URL = 'http://localhost:4000',
    STEAM_WEB_API_KEY
  } = process.env;

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
      returnURL: `${APP_BASE_URL}/api/auth/steam/return`,
      realm: `${APP_BASE_URL}/`,
      apiKey: STEAM_WEB_API_KEY
    },
    (identifier, profile, done) => {
      process.nextTick(() => done(null, { identifier, profile }));
    }
  ));
}

