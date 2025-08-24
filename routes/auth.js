// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');
const axios = require('axios');

const client = new MongoClient(process.env.MONGO_URI);
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key';

const FB_APP_ID = process.env.FB_APP_ID;
const FB_APP_SECRET = process.env.FB_APP_SECRET;
const FB_REDIRECT_URI = process.env.FB_REDIRECT_URI;

// Helper function to get clean frontend URL
const getFrontendUrl = () => {
  return (process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/dashboard$/, '');
};

// Generate Facebook login URL - only basic user permissions
router.get('/facebook/login-url', (req, res) => {
  const scopes = ['public_profile', 'email', 'pages_show_list', 'instagram_basic'].join(',');
  
  // Check if user is authenticated (for connecting existing account)
  const authHeader = req.headers.authorization;
  let stateParam = '';
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      // Verify the token is valid
      jwt.verify(token, JWT_SECRET);
      stateParam = `&state=${encodeURIComponent(token)}`;
    } catch (e) {
      // Invalid token, continue without state
    }
  }

  const fbAuthUrl =
    `https://www.facebook.com/v19.0/dialog/oauth` +
    `?client_id=${FB_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}` +
    `&scope=${scopes}` +
    `&response_type=code` +
    `&auth_type=rerequest` +
    stateParam;

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
    const { code, state } = req.query;
    
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

    // Get user info from Facebook
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

    // Check if this is a connection request from existing user (state parameter can contain user token)
    let existingUser = null;
    if (state) {
      try {
        const decoded = jwt.verify(state, JWT_SECRET);
        existingUser = await usersCol.findOne({ _id: new ObjectId(decoded.userId) });
      } catch (e) {
        // Invalid token in state, continue with normal flow
      }
    }

    if (existingUser) {
      // Existing logged-in user wants to connect Facebook
      
      // Check if Facebook email matches the current user's email
      if (email && email !== existingUser.email) {
        const frontendUrl = getFrontendUrl();
        res.redirect(`${frontendUrl}/dashboard/settings?fbError=${encodeURIComponent('Facebook email does not match your account email')}`);
        return;
      }
      
      // First check if this Facebook ID is already connected to another user
      const fbUser = await usersCol.findOne({ 
        facebookId: facebookId,
        _id: { $ne: existingUser._id } // Exclude current user
      });
      
      if (fbUser) {
        const frontendUrl = getFrontendUrl();
        res.redirect(`${frontendUrl}/dashboard/settings?fbError=${encodeURIComponent('This Facebook account is already connected to another user account')}`);
        return;
      }

      await usersCol.updateOne(
        { _id: existingUser._id },
        {
          $set: {
            facebookId: facebookId,
            facebookAccessToken: access_token,
            profilePicture: existingUser.profilePicture || picture?.data?.url,
            updatedAt: new Date()
          }
        }
      );

      const frontendUrl = getFrontendUrl();
      res.redirect(`${frontendUrl}/dashboard/settings?fbConnected=true`);
      return;
    }

    // Check if user exists by email or Facebook ID
    let user = await usersCol.findOne({
      $or: [
        { email: email },
        { facebookId: facebookId }
      ]
    });

    // Enhanced validation for email and Facebook ID conflicts
    if (!user) {
      // Check if this Facebook ID is connected to a user with different email
      const existingFbUser = await usersCol.findOne({ facebookId: facebookId });
      if (existingFbUser && existingFbUser.email !== email) {
        const frontendUrl = getFrontendUrl();
        res.redirect(`${frontendUrl}/auth/error?message=${encodeURIComponent('This Facebook account is connected to a different email address')}`);
        return;
      }
      
      // Check if this email is already used by a user with different Facebook ID
      const existingEmailUser = await usersCol.findOne({ 
        email: email,
        facebookId: { $exists: true, $ne: null, $ne: facebookId }
      });
      if (existingEmailUser) {
        const frontendUrl = getFrontendUrl();
        res.redirect(`${frontendUrl}/auth/error?message=${encodeURIComponent('This email is already connected to a different Facebook account')}`);
        return;
      }
    }

    if (user) {
      // Update existing user with Facebook info if not already linked
      if (!user.facebookId) {
        // Double-check Facebook ID uniqueness before linking
        const fbConflict = await usersCol.findOne({ 
          facebookId: facebookId,
          _id: { $ne: user._id }
        });
        
        if (fbConflict) {
          const frontendUrl = getFrontendUrl();
          res.redirect(`${frontendUrl}/auth/error?message=${encodeURIComponent('This Facebook account is already connected to another user')}`);
          return;
        }

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
      // Create new user - but first check email uniqueness one more time
      const emailConflict = await usersCol.findOne({ email: email });
      if (emailConflict) {
        const frontendUrl = getFrontendUrl();
        res.redirect(`${frontendUrl}/auth/error?message=${encodeURIComponent('This email is already registered. Please login with your existing account.')}`);
        return;
      }

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
    const frontendUrl = getFrontendUrl();
    res.redirect(`${frontendUrl}/auth/success?token=${token}`);

  } catch (error) {
    console.error('Facebook callback error:', error.message);
    const frontendUrl = getFrontendUrl();
    res.redirect(`${frontendUrl}/auth/error?message=${encodeURIComponent('Facebook login failed')}`);
  }
});

// Check for and fix duplicate Facebook connections (admin utility)
router.post('/facebook/fix-duplicates', async (req, res) => {
  try {
    // This should be protected - only allow for admin or specific conditions
    const { adminKey } = req.body;
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');

    // Find all users with Facebook IDs
    const fbUsers = await usersCol.find({ facebookId: { $exists: true, $ne: null } }).toArray();
    
    // Group by Facebook ID to find duplicates
    const fbGroups = {};
    fbUsers.forEach(user => {
      if (!fbGroups[user.facebookId]) {
        fbGroups[user.facebookId] = [];
      }
      fbGroups[user.facebookId].push(user);
    });

    const duplicates = [];
    const fixes = [];

    // Process duplicates
    for (const [fbId, users] of Object.entries(fbGroups)) {
      if (users.length > 1) {
        duplicates.push({ facebookId: fbId, users: users.length });
        
        // Keep the first user (or the one with password), remove Facebook from others
        const sortedUsers = users.sort((a, b) => {
          if (a.password && !b.password) return -1;
          if (!a.password && b.password) return 1;
          return new Date(a.createdAt) - new Date(b.createdAt);
        });

        const keepUser = sortedUsers[0];
        const removeUsers = sortedUsers.slice(1);

        for (const user of removeUsers) {
          await usersCol.updateOne(
            { _id: user._id },
            {
              $unset: {
                facebookId: '',
                facebookAccessToken: ''
              },
              $set: {
                updatedAt: new Date()
              }
            }
          );
          fixes.push({
            userId: user._id,
            email: user.email,
            action: 'removed_facebook_connection'
          });
        }
      }
    }

    res.json({
      success: true,
      duplicatesFound: duplicates.length,
      duplicates,
      fixesApplied: fixes.length,
      fixes
    });

  } catch (error) {
    console.error('Fix duplicates error:', error);
    res.status(500).json({ error: 'Failed to fix duplicates' });
  }
});

// Disconnect Facebook account
router.post('/facebook/disconnect', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');

    const user = await usersCol.findOne({ _id: new ObjectId(decoded.userId) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has password - they need at least one login method
    if (!user.password) {
      return res.status(400).json({ 
        error: 'Cannot disconnect Facebook. Please set a password first to maintain account access.' 
      });
    }

    // Remove Facebook data
    await usersCol.updateOne(
      { _id: user._id },
      {
        $unset: {
          facebookId: '',
          facebookAccessToken: ''
        },
        $set: {
          updatedAt: new Date()
        }
      }
    );

    res.json({
      success: true,
      message: 'Facebook account disconnected successfully'
    });

  } catch (error) {
    console.error('Facebook disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Facebook account' });
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

    // Check if this Facebook ID is connected to a different email account
    if (!user) {
      const existingFbUser = await usersCol.findOne({ facebookId: facebookId });
      if (existingFbUser && existingFbUser.email !== email) {
        return res.status(400).json({ 
          error: 'This Facebook account is connected to a different email address' 
        });
      }
    }

    if (user) {
      // Update existing user with Facebook info if not already linked
      if (!user.facebookId) {
        // Check if this Facebook ID is already used by another user
        const fbConflict = await usersCol.findOne({ 
          facebookId: facebookId,
          _id: { $ne: user._id }
        });
        
        if (fbConflict) {
          return res.status(400).json({ 
            error: 'This Facebook account is already connected to another user' 
          });
        }

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

    // Generate JWT token for auto-login
    const token = jwt.sign(
      { userId: result.insertedId, email: email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      message: 'Registration successful!',
      token,
      user: {
        id: result.insertedId,
        email: email,
        phone: phone,
        businesses: []
      }
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

// -------------------- GET PROFILE --------------------
router.get('/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = require('jsonwebtoken').verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');

    const user = await usersCol.findOne({ _id: new ObjectId(decoded.userId) });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Return user info (without password)
    const userInfo = {
      id: user._id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      facebookId: user.facebookId,
      profilePicture: user.profilePicture,
      facebookAccessToken: user.facebookAccessToken,
      hasPassword: !!user.password, // Indicate if user has a password set
      notifications: user.notifications || {
        email: true,
        push: true,
        marketing: false,
      },
      privacy: user.privacy || {
        showEmail: false,
        showPhone: false,
        profileVisible: true,
      }
    };

    return res.json({
      success: true,
      user: userInfo
    });

  } catch (err) {
    console.error('Get profile error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// -------------------- UPDATE PROFILE --------------------
router.put('/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = require('jsonwebtoken').verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    const { name, phone, currentPassword, newPassword, notifications, privacy } = req.body;

    if (!name && !phone && !newPassword && !notifications && !privacy) {
      return res.status(400).json({ success: false, message: 'At least one field must be provided for update.' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');

    const user = await usersCol.findOne({ _id: new ObjectId(decoded.userId) });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const updateFields = {};

    // Update name if provided
    if (name) {
      updateFields.name = name;
    }

    // Update phone if provided
    if (phone) {
      updateFields.phone = phone;
    }

    // Update notifications if provided
    if (notifications) {
      updateFields.notifications = notifications;
    }

    // Update privacy settings if provided
    if (privacy) {
      updateFields.privacy = privacy;
    }

    // Handle password change
    if (newPassword) {
      if (!currentPassword && user.password) {
        return res.status(400).json({ success: false, message: 'Current password is required to change password.' });
      }

      // Verify current password (only for users with passwords - not Facebook users)
      if (user.password && currentPassword) {
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isCurrentPasswordValid) {
          return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
        }
      }

      // Hash new password
      const hashedNewPassword = await bcrypt.hash(newPassword, 10);
      updateFields.password = hashedNewPassword;
    }

    // Add updated timestamp
    updateFields.updatedAt = new Date();

    // Update user in database
    await usersCol.updateOne(
      { _id: user._id },
      { $set: updateFields }
    );

    // Return updated user info (without password)
    const updatedUser = {
      id: user._id,
      email: user.email,
      name: updateFields.name || user.name,
      phone: updateFields.phone || user.phone,
      facebookId: user.facebookId,
      profilePicture: user.profilePicture,
      hasPassword: !!updateFields.password || !!user.password,
      notifications: updateFields.notifications || user.notifications,
      privacy: updateFields.privacy || user.privacy
    };

    return res.json({
      success: true,
      message: 'Profile updated successfully!',
      user: updatedUser
    });

  } catch (err) {
    console.error('Update profile error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
