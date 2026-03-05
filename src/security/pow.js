export function powMiddleware(area) {
  return (req, res, next) => {
    const { POW_PROVIDER = 'disabled', NODE_ENV = 'development' } = process.env;

    if (POW_PROVIDER === 'disabled' && NODE_ENV === 'development') {
      return next();
    }

    const token = req.headers['x-pow-token'] || req.body?.powToken;
    if (!token) {
      return res.status(429).json({ error: 'Proof-of-Work token required', area });
    }

    next();
  };
}

