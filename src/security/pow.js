export function powMiddleware(area) {
  return (req, res, next) => {
    const { POW_PROVIDER = 'disabled' } = process.env;

    // When disabled, never require a token; abuse protection relies on rate limiting.
    if (POW_PROVIDER === 'disabled') {
      return next();
    }

    const token = req.headers['x-pow-token'] || req.body?.powToken;
    if (!token) {
      return res.status(429).json({ error: 'Proof-of-Work token required', area });
    }

    next();
  };
}

