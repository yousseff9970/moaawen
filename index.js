const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');

// Middlewares
const rateLimiter = require('./middlewares/rateLimit');
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
// Temporary CORS fix
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); 
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200); // stop here for preflight
  }

  next();
});

// -------------------- GLOBAL MIDDLEWARES --------------------
app.use(cors());
app.use(rateLimiter); // Apply rate limiting globally
app.use(bodyParser.json()); // Parse JSON body
app.use(express.urlencoded({ extended: true })); 
app.use(express.json()); // Parse additional JSON (alternative to bodyParser)
app.use(cookieParser());

// Static files & view engine
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// -------------------- ROUTES --------------------

// Root route handler
app.get('/', (req, res) => {
  // Default root response
  res.json({ 
    message: 'Moaawen AI Backend API',
    version: '1.0.0',
    status: 'running'
  });
});

// Authentication routes
app.use('/auth', authRoutes);

// Protected test route (check JWT auth flow)
app.get('/dashboard/data', authMiddleware, (req, res) => {
  res.json({ message: `Hello ${req.user.email}, you have access.` });
});

// Business & dashboard routes
app.use('/dashboard', dashboardRoutes);
app.use('/shopify', shopifyRoutes);
app.use('/businesses', businessRoutes);


app.use('/api', apiKeyMiddleware, chatRoutes);

// Webhooks
app.use('/webhook', webhookRoutes);
app.use('/whatsapp', whatsappRoutes);

// Admin panel
app.use('/admin', adminRoutes);

// Logs
app.use(logsRoutes);

// -------------------- SESSION --------------------
app.use(session({
  secret: 'moaawen_super_secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } 
}));

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
