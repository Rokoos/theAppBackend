import rateLimit from 'express-rate-limit';

const failedDecryptAttempts = new Map();
const authCycles = new Map();

function getKey(req) {
  return req.ip || req.headers['x-forwarded-for'] || 'unknown';
}

export const authRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

export const decryptRateLimiter = (req, res, next) => {
  const key = getKey(req);
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const entry = failedDecryptAttempts.get(key) || { count: 0, first: now, lockedUntil: 0 };

  if (entry.lockedUntil && entry.lockedUntil > now) {
    return res.status(429).json({ error: 'Too many failed decryptions. Temporarily locked.' });
  }

  req.on('decryption-failed', () => {
    const e = failedDecryptAttempts.get(key) || { count: 0, first: now, lockedUntil: 0 };
    if (now - e.first > windowMs) {
      e.count = 0;
      e.first = now;
    }
    e.count += 1;
    if (e.count >= 5) {
      e.lockedUntil = now + 15 * 60 * 1000;
    }
    failedDecryptAttempts.set(key, e);
  });

  req.on('decryption-success', () => {
    failedDecryptAttempts.delete(key);
  });

  next();
};

export function trackAuthCycle(req, res, next) {
  const key = getKey(req);
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const entry = authCycles.get(key) || { count: 0, first: now, lockedUntil: 0 };

  if (entry.lockedUntil && entry.lockedUntil > now) {
    return res.status(429).json({ error: 'Too many auth attempts. Temporarily locked.' });
  }

  entry.count += 1;
  if (now - entry.first > windowMs) {
    entry.first = now;
    entry.count = 1;
  }

  if (entry.count >= 20) {
    entry.lockedUntil = now + 15 * 60 * 1000;
  }

  authCycles.set(key, entry);

  next();
}

