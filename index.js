const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');


//routes
const dashboardRoutes = require('./routes/dashboard');
const webhookRoutes = require('./routes/webhook');
const logsRoute = require('./routes/logs');
const chatRoute = require('./routes/chat');
const shopifyRoutes = require('./routes/shopify');




const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.use('/dashboard', dashboardRoutes);
app.use('/shopify', shopifyRoutes);
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/api', chatRoute);
app.use('/webhook', webhookRoutes);
app.use('/whatsapp', require('./routes/whatsapp'));
app.use(session({
  secret: 'moaawen_super_secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } 
}));
app.use('/admin', require('./routes/admin'));
app.use(logsRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
