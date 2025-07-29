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

const app = express();
app.use(cors());
app.use(rateLimiter); // 🌟 Apply globally

// Static + view engine
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// Routes
app.use('/dashboard', require('./routes/dashboard'));
app.use('/shopify', require('./routes/shopify'));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Secure the widget API endpoint with API key
app.use('/api', apiKeyMiddleware, require('./routes/chat')); // ✅

app.use('/webhook', require('./routes/webhook'));
app.use('/whatsapp', require('./routes/whatsapp'));
app.use(session({
  secret: 'moaawen_super_secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } 
}));
app.use('/admin', require('./routes/admin'));
app.use(require('./routes/logs'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
