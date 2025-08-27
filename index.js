// server.js
const express = require('express');
require('dotenv').config();
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');

// Middlewares
const { limiter, authLimiter, publicLimiter } = require('./middlewares/rateLimit');
const apiKeyMiddleware = require('./middlewares/apiKey');
const { authMiddleware, requireVerified, requireAdmin } = require('./middlewares/authMiddleware');

// Routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const shopifyRoutes = require('./routes/shopify');
const chatRoutes = require('./routes/chat');
const webhookRoutes = require('./routes/webhook');
const whatsappRoutes = require('./routes/whatsapp');
const adminRoutes = require('./routes/admin');
const logsRoutes = require('./routes/logs');
const businessRoutes = require('./routes/business');

const app = express();

// --- Security & IP correctness ---
app.disable('x-powered-by');
app.set('trust proxy', 1);                 // behind 1 proxy (NGINX/Cloudflare/Render/etc.)
app.use(helmet());                         // sensible security headers

// --- CORS Configuration ---
const defaultOrigins = [
  'https://moaawen.ai',
  'https://moaawen.netlify.app',
  'https://moaawen.onrender.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:8080',
];
const envOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const allowedOrigins = envOrigins.length ? envOrigins : defaultOrigins;

// Flexible CORS for different route types
const corsOptions = {
  // Default restrictive CORS for admin/auth routes
  restrictive: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);   // allow Postman/cURL
      return allowedOrigins.includes(origin) ? cb(null, true) : cb(new Error('CORS blocked'), false);
    },
    credentials: true,
    methods: ['GET','POST','PUT','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'X-Requested-With'],
  },
  
  // Permissive CORS for widget/API endpoints (protected by API keys)
  permissive: {
    origin: true, // Allow all origins
    credentials: false, // No credentials needed for API key auth
    methods: ['GET','POST','OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
  }
};

// --- Static & views with permissive CORS for widget files ---
app.use('/public', cors(corsOptions.permissive), express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));
// Widget static files - also need permissive CORS
app.get('/widget.js', cors(corsOptions.permissive), (req, res, next) => {
  res.setHeader('Content-Type', 'application/javascript');
  next();
});

// Apply default restrictive CORS
app.use(cors(corsOptions.restrictive));

// --- Parsers ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '1mb' }));  // single JSON parser (drop bodyParser)
app.use(cookieParser());


app.set('view engine', 'ejs');

// -------------------- ROUTES --------------------

// Health/root (apply general rate limiter)
app.get('/', limiter, (req, res) => {
  res.json({ message: 'Moaawen AI Backend API', version: '1.0.0', status: 'running' });
});

// Webhooks
// If you verify HMAC (Shopify/Stripe), mount RAW parser before handlers for that path.
// Example for Shopify ONLY if you verify signature inside webhookRoutes:
// const shopifyWebhook = require('./routes/webhookShopify');
// app.use('/webhook/shopify', express.raw({ type: 'application/json' }), shopifyWebhook);
app.use('/webhook', publicLimiter, webhookRoutes);

// Auth (stricter limits)
app.use('/auth', authLimiter, authRoutes);

// Protected quick check
app.get('/dashboard/data', authMiddleware, (req, res) => {
  res.json({ message: `Hello ${req.user.email}, you have access.` });
});

// Protected areas
app.use('/admin',     authMiddleware, requireAdmin,    adminRoutes);
app.use('/dashboard', publicLimiter, authMiddleware, requireVerified, dashboardRoutes);
app.use('/businesses', authMiddleware, businessRoutes);

// Shopify integration (protect if it exposes sensitive actions)
app.use('/shopify', authMiddleware, shopifyRoutes);

// API (API key first, then rate limit) - Permissive CORS for widget usage
app.use('/api', cors(corsOptions.permissive), apiKeyMiddleware, limiter, chatRoutes);


// WhatsApp & Logs (relaxed/public limits as appropriate)
app.use('/whatsapp', publicLimiter, whatsappRoutes);
app.use(publicLimiter, logsRoutes);

// 404
app.use((req, res) => res.status(404).json({ success: false, message: 'Not found' }));

// Error handler (last)
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (process.env.NODE_ENV !== 'production') console.error(err);
  res.status(status).json({
    success: false,
    message: status === 500 ? 'Internal server error' : err.message,
  });
});

// -------------------- SESSION (optional; only if you really use it) --------------------
// If you must keep sessions, prefer Redis store and secure cookies.
// Otherwise, remove this whole block to reduce attack surface.
if (process.env.SESSION_SECRET) {
  const session = require('express-session');
  const useSecureCookie = process.env.NODE_ENV === 'production';
  app.use(require('express-session')({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,            // don't create sessions until needed
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: useSecureCookie,           // needs trust proxy to work on HTTPS behind proxy
      maxAge: 1000 * 60 * 60 * 12,       // 12h
    }
  }));
}

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});