// middlewares/rateLimit.js
const expressRateLimit = require('express-rate-limit');
const rateLimit = expressRateLimit.rateLimit || expressRateLimit; // CJS/ESM compat

// Helper function to safely get IP for IPv6 compatibility
function getClientIP(req) {
  // Extract IP from various sources
  const forwarded = req.headers['x-forwarded-for'];
  const realIP = req.headers['x-real-ip'];
  const cfConnectingIP = req.headers['cf-connecting-ip'];
  
  let ip;
  
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list
    ip = forwarded.split(',')[0].trim();
  } else if (realIP) {
    ip = realIP;
  } else if (cfConnectingIP) {
    ip = cfConnectingIP;
  } else {
    ip = req.connection.remoteAddress || req.socket.remoteAddress || req.ip;
  }
  
  // Handle IPv6-mapped IPv4 addresses
  if (ip && ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  
  return ip || 'unknown';
}

// TIP: in your server entry do this once (before limiters) to make req.ip correct behind proxies:
// app.set('trust proxy', 1);

function retryAfterSecs(req) {
  const rt = req.rateLimit?.resetTime;
  if (rt instanceof Date) {
    const s = Math.ceil((rt.getTime() - Date.now()) / 1000);
    return s > 0 ? s : 1;
  }
  return undefined;
}

// Normalize API key & user identity from request (non-throwing)
function getApiKey(req) {
  // keep your header name, but also accept the conventional one
  return req.headers['data-api-key'] || req.headers['x-api-key'] || null;
}
function getUserId(req) {
  return req.user?.userId || req.user?.id || req.userId || null;
}

// ---- Key generators (IPv6-safe) ----
function generalKey(req) {
  const key = getApiKey(req);
  if (key) {
    console.log(`🔑 Rate limit using API key: key_${key}`);
    return `key_${key}`;
  }
  const uid = getUserId(req);
  if (uid) {
    console.log(`🔑 Rate limit using user ID: user_${uid}`);
    return `user_${uid}`;
  }
  const ipKey = `ip_${getClientIP(req)}`;
  console.log(`🔑 Rate limit using IP: ${ipKey}`);
  return ipKey; // Using custom IPv6-safe IP function
}
const authKey   = (req) => {
  const key = `auth_${generalKey(req)}`;
  console.log(`🔒 Auth rate limit key: ${key}`);
  return key;
};   // still prioritizes user/api key
const publicKey = (req) => {
  const key = `public_ip_${getClientIP(req)}`;
  console.log(`🌐 Public rate limit key: ${key}`);
  return key;
};

// ---- Memory-only limiters ----
const limiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 100,              // 100 req/min
  keyGenerator: generalKey,
  standardHeaders: true, // adds RateLimit-* and Retry-After
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`⚠️ General rate limit exceeded for: ${generalKey(req)}`);
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please slow down.',
      retryAfter: retryAfterSecs(req),
      limit: req.rateLimit?.limit,
      remaining: req.rateLimit?.remaining,
    });
  },
});

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20,                  // stricter for auth
  keyGenerator: authKey,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`⚠️ Auth rate limit exceeded for: ${authKey(req)}`);
    res.status(429).json({
      success: false,
      message: 'Too many authentication attempts. Please try again later.',
      retryAfter: retryAfterSecs(req),
    });
  },
});

const publicLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 800,               // More reasonable for public endpoints
  keyGenerator: publicKey,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`⚠️ Public rate limit exceeded for: ${publicKey(req)}`);
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
      retryAfter: retryAfterSecs(req),
    });
  },
});


module.exports = { limiter, authLimiter, publicLimiter };
