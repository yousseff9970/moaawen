const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit'); // ✅ import helper

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 min
  max: 60,
  keyGenerator: (req, res) => {
    // API key takes priority
    if (req.headers['data-api-key']) {
      return `key_${req.headers['data-api-key']}`;
    }

    // UserId if present
    if (req.userId) {
      return `user_${req.userId}`;
    }

    // Fallback: IP (using helper for IPv6 safety)
    return `ip_${ipKeyGenerator(req)}`;
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please slow down.'
    });
  }
});

module.exports = limiter;
