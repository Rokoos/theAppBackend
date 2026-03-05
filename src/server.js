import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import session from 'express-session';
import passport from 'passport';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cors from 'cors';

import { configurePassport } from './steam/passport.js';
import { cspMiddleware } from './security/csp.js';
import { powMiddleware } from './security/pow.js';
import { authRateLimiter, decryptRateLimiter } from './security/rateLimit.js';
import authRouter from './steam/routes.js';
import cryptoRouter from './crypto/routes.js';

// Resolve directory for explicit .env loading so we can support
// a single .env at the project root as well as backend/.env.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load backend/.env first (optional)...
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
// ...then override with project root .env if present.
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const app = express();

const {
  BACKEND_PORT = 4000,
  SESSION_SECRET,
  FRONTEND_ORIGIN = 'http://localhost:5173',
  NODE_ENV = 'development'
} = process.env;

if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in environment');
}

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(cspMiddleware);

app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true
}));

app.use(compression());
app.use(express.json());
app.use(morgan(NODE_ENV === 'development' ? 'dev' : 'combined'));

const sessionCookieName = NODE_ENV === 'development' ? 'steamapp.sid' : '__Host-steamapp.sid';

app.use(session({
  name: sessionCookieName,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: NODE_ENV !== 'development',
    sameSite: 'strict',
    path: '/'
  }
}));

configurePassport();
app.use(passport.initialize());
app.use(passport.session());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRateLimiter, powMiddleware('auth'), authRouter);
app.use('/api/crypto', decryptRateLimiter, powMiddleware('crypto'), cryptoRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(BACKEND_PORT, () => {
  console.log(`Backend listening on port ${BACKEND_PORT}`);
});

