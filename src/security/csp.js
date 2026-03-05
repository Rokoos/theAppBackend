import crypto from 'crypto';

export function cspMiddleware(req, res, next) {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;

  const { FRONTEND_ORIGIN = 'http://localhost:5173', NODE_ENV = 'development' } = process.env;

  const connectSrc = ["'self'"];
  if (FRONTEND_ORIGIN) {
    connectSrc.push(FRONTEND_ORIGIN);
  }

  if (NODE_ENV === 'development') {
    // Allow Vite dev server & HMR in development only.
    connectSrc.push('ws://localhost:5173', 'http://localhost:5173');
  }

  const csp = [
    "default-src 'self'",
    "script-src 'self' 'strict-dynamic' 'nonce-" + nonce + "'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSrc.join(' ')}`,
    "upgrade-insecure-requests"
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  next();
}

