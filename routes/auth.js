// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');
const axios = require('axios');

const client = new MongoClient(process.env.MONGO_URI);
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key';

const FB_APP_ID = process.env.FB_APP_ID;
const FB_APP_SECRET = process.env.FB_APP_SECRET;
const FB_REDIRECT_URI = process.env.FB_REDIRECT_URI;

// Generate Facebook login URL - only basic user permissions
router.get('/facebook/login-url', (req, res) => {
  const scopes = ['public_profile', 'email'].join(',');

  const fbAuthUrl =
    `https://www.facebook.com/v19.0/dialog/oauth` +
    `?client_id=${FB_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}` +
    `&scope=${scopes}` +
    `&response_type=code` +
    `&auth_type=rerequest`;

  res.json({ url: fbAuthUrl });
});

// Add this route to handle the base /facebook path
router.get('/facebook', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /auth/facebook/login-url - Get Facebook login URL',
      'GET /auth/facebook/callback - Facebook callback handler',
      'POST /auth/facebook/callback - Facebook login for SPA/mobile'
    ]
  });
});

// Handle Facebook callback - exchange code for access token and get user info
router.get('/facebook/callback', async (req, res) => {
  try {
    const { code } = req.query;
    
    if (!code) {
      return res.status(400).json({ error: 'Authorization code not provided' });
    }

    // Exchange code for access token
    const tokenResponse = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        redirect_uri: FB_REDIRECT_URI,
        code: code
      }
    });

    const { access_token } = tokenResponse.data;

    // Get user info
    const userResponse = await axios.get('https://graph.facebook.com/v19.0/me', {
      params: {
        fields: 'id,name,email,picture',
        access_token: access_token
      }
    });

    const { id: facebookId, name, email, picture } = userResponse.data;

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');

    // Check if user exists by email or Facebook ID
    let user = await usersCol.findOne({
      $or: [
        { email: email },
        { facebookId: facebookId }
      ]
    });

    if (user) {
      // Update existing user with Facebook info if not already linked
      if (!user.facebookId) {
        await usersCol.updateOne(
          { _id: user._id },
          {
            $set: {
              facebookId: facebookId,
              facebookAccessToken: access_token,
              profilePicture: picture?.data?.url,
              updatedAt: new Date()
            }
          }
        );
      }
    } else {
      // Create new user
      const userDoc = {
        email: email,
        name: name,
        facebookId: facebookId,
        facebookAccessToken: access_token,
        profilePicture: picture?.data?.url,
        password: null, // Facebook users don't have passwords
        businesses: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      const result = await usersCol.insertOne(userDoc);
      user = { ...userDoc, _id: result.insertedId };
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Redirect to frontend with token (adjust URL as needed)
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    res.redirect(`${frontendUrl}/auth/success?token=${token}`);

  } catch (error) {
    console.error('Facebook callback error:', error.message);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    res.redirect(`${frontendUrl}/auth/error?message=${encodeURIComponent('Facebook login failed')}`);
  }
});

// Alternative POST endpoint for mobile/SPA applications
router.post('/facebook/callback', async (req, res) => {
  try {
    const { code, accessToken } = req.body;
    
    let userAccessToken = accessToken;
    
    // If code provided, exchange for access token
    if (code && !accessToken) {
      const tokenResponse = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
        params: {
          client_id: FB_APP_ID,
          client_secret: FB_APP_SECRET,
          redirect_uri: FB_REDIRECT_URI,
          code: code
        }
      });
      userAccessToken = tokenResponse.data.access_token;
    }

    if (!userAccessToken) {
      return res.status(400).json({ error: 'Access token or authorization code required' });
    }

    // Get user info
    const userResponse = await axios.get('https://graph.facebook.com/v19.0/me', {
      params: {
        fields: 'id,name,email,picture',
        access_token: userAccessToken
      }
    });

    const { id: facebookId, name, email, picture } = userResponse.data;

    if (!email) {
      return res.status(400).json({ error: 'Email permission required' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');

    // Check if user exists by email or Facebook ID
    let user = await usersCol.findOne({
      $or: [
        { email: email },
        { facebookId: facebookId }
      ]
    });

    if (user) {
      // Update existing user with Facebook info if not already linked
      if (!user.facebookId) {
        await usersCol.updateOne(
          { _id: user._id },
          {
            
            $set: {
              facebookId: facebookId,
              facebookAccessToken: userAccessToken,
              profilePicture: picture?.data?.url,
              updatedAt: new Date()
            }
          }
        );
        user.facebookId = facebookId;
      }
    } else {
      // Create new user
      const userDoc = {
        email: email,
        name: name,
        facebookId: facebookId,
        facebookAccessToken: userAccessToken,
        profilePicture: picture?.data?.url,
        password: null, // Facebook users don't have passwords
        businesses: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      const result = await usersCol.insertOne(userDoc);
      user = { ...userDoc, _id: result.insertedId };
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: 'Facebook login successful',
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        facebookId: user.facebookId,
        profilePicture: user.profilePicture,
        businesses: user.businesses
      }
    });

  } catch (error) {
    console.error('Facebook login error:', error.message);
    return res.status(500).json({ error: 'Facebook login failed' });
  }
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
