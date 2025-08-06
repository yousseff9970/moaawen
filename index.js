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
const authMiddleware = require('./middlewares/authMiddleware');

// Routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const shopifyRoutes = require('./routes/shopify');
const chatRoutes = require('./routes/chat');
const webhookRoutes = require('./routes/webhook');
const whatsappRoutes = require('./routes/whatsapp');
const adminRoutes = require('./routes/admin');
const logsRoutes = require('./routes/logs');

const app = express();

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

// Authentication routes
app.use('/auth', authRoutes);

// Protected test route (check JWT auth flow)
app.get('/dashboard/data', authMiddleware, (req, res) => {
  res.json({ message: `Hello ${req.user.email}, you have access.` });
});

// Business & dashboard routes
app.use('/dashboard', dashboardRoutes);
app.use('/shopify', shopifyRoutes);

// Chat API (secured with API key)
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
