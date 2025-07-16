const express = require('express');
const router = express.Router();
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const client = new MongoClient(process.env.MONGO_URI);

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@moaawen.ai';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Show login page
router.get('/login', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../admin/login.html'));
});

router.get('/businesses', (req, res) => {
  res.sendFile(path.join(__dirname, '../admin/businesses.html'));
});


router.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../admin/dashboard.html'));
});

// Handle login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect('/admin/dashboard');
  }

  res.send('Invalid credentials');
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// Middleware to protect admin routes
router.use((req, res, next) => {
  if (!req.session.isAdmin) return res.redirect('/admin/login');
  next();
});

// Example protected route
router.get('/api/businesses', async (req, res) => {
  await client.connect();
  const businesses = await client.db().collection('businesses').find().toArray();
  res.json(businesses);
});

router.post('/api/businesses', async (req, res) => {
  const { name, domain, phone_number_id, page_id } = req.body;
  const doc = {
    name,
    channels: {
      website: domain,
      whatsapp: { phone_number_id },
      instagram: { page_id },
      messenger: { page_id }
    }
  };

  await client.connect();
  await client.db().collection('businesses').insertOne(doc);
  res.json({ success: true });
});

router.delete('/api/businesses/:id', async (req, res) => {
  await client.connect();
  await client.db().collection('businesses').deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ success: true });
});

module.exports = router;
