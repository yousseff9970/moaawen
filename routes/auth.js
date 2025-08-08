// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');

const client = new MongoClient(process.env.MONGO_URI);
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key';



const FB_APP_ID = process.env.FB_APP_ID;
const FB_REDIRECT_URI = process.env.FB_REDIRECT_URI;

router.get('/facebook/login-url', (req, res) => {
  const scopes = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_metadata',
    'instagram_basic',
    'public_profile',
    'email'
  ].join(',');

  const fbAuthUrl =
    `https://www.facebook.com/v19.0/dialog/oauth` +
    `?client_id=${FB_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}` +
    `&scope=${scopes}` +
    `&response_type=code` +
    `&auth_type=rerequest`;

  res.json({ url: fbAuthUrl });
});


// /auth/facebook/callback or /auth/facebook/link
router.post('/facebook/callback', async (req, res) => {
  const { email, name, fbId, pages } = req.body; // pages = [{ pageId, name, accessToken, igBusinessId }]
  if (!email || !pages?.length) return res.status(400).json({ error: 'Missing info' });

  await client.connect();
  const db = client.db(process.env.DB_NAME || 'moaawen');
  const usersCol = db.collection('users');
  const businessesCol = db.collection('businesses');

  // 1. Find or create user
  let user = await usersCol.findOne({ email });
  if (!user) {
    const userDoc = {
      email,
      name,
      password: null, // since using FB OAuth
      businesses: [],
      createdAt: new Date(),
      facebookId: fbId
    };
    const result = await usersCol.insertOne(userDoc);
    user = { ...userDoc, _id: result.insertedId };
  }

  // 2. For each selected page/account, create business entry if not exists
  const businessIds = [];
  for (const page of pages) {
    let business = await businessesCol.findOne({ 'channels.messenger.page_id': page.pageId });
    if (!business) {
      const businessDoc = {
        name: page.name,
        owner: user._id,
        channels: {
          messenger: { page_id: page.pageId, accessToken: page.accessToken },
          instagram: page.igBusinessId
            ? { page_id: page.igBusinessId, fb_page_id: page.pageId }
            : undefined
        },
        createdAt: new Date(),
        users: [user._id]
      };
      const { insertedId } = await businessesCol.insertOne(businessDoc);
      businessIds.push(insertedId);
    } else {
      // Add user to business if not already
      if (!business.users?.includes(user._id)) {
        await businessesCol.updateOne(
          { _id: business._id },
          { $addToSet: { users: user._id } }
        );
      }
      businessIds.push(business._id);
    }
  }

  // 3. Update user's businesses list
  await usersCol.updateOne(
    { _id: user._id },
    { $addToSet: { businesses: { $each: businessIds } } }
  );

  return res.json({ success: true, businesses: businessIds });
});

// -------------------- REGISTER --------------------
router.post('/register', async (req, res) => {
  try {
    const { businessName, email, phone, password } = req.body;

    if (!businessName || !email || !phone || !password) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');

    const existingUser = await usersCol.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const userDoc = {
      email,
      phone,
      password: hashedPassword,
      businesses: [],
      createdAt: new Date()
    };

    const result = await usersCol.insertOne(userDoc);

    return res.json({
      message: 'Registration successful!',
      userId: result.insertedId
    });
  } catch (err) {
    console.error('Register error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// -------------------- LOGIN --------------------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');

    const user = await usersCol.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid email or password.' });
    }

    // Generate JWT token (expires in 7 days)
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      message: 'Login successful!',
      token,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        businesses: user.businesses
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
