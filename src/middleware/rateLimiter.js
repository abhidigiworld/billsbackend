// In-memory rate limiting cache for AI chat
const rateLimitCache = new Map();

const aiRateLimiter = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 5;

  if (!rateLimitCache.has(ip)) {
    rateLimitCache.set(ip, []);
  }

  const timestamps = rateLimitCache.get(ip).filter(t => now - t < windowMs);
  timestamps.push(now);
  rateLimitCache.set(ip, timestamps);

  if (timestamps.length > maxRequests) {
    return res.status(429).json({
      error: 'You have reached the limit of 5 queries per minute. Please wait a moment before sending another message.'
    });
  }

  next();
};

module.exports = aiRateLimiter;
