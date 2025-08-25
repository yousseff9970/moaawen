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
  const { businessId } = req.query; // Support business connection parameter
  let stateParam = '';
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      // Verify the token is valid
      jwt.verify(token, JWT_SECRET);
      // Encode both token and businessId in state if businessId provided
      const stateData = businessId ? JSON.stringify({ token, businessId }) : token;
      stateParam = `&state=${encodeURIComponent(stateData)}`;
    } catch (e) {
      // Invalid token, continue without state
    }
  } else if (businessId) {
    // If no auth but businessId provided, just pass businessId
    stateParam = `&state=${encodeURIComponent(JSON.stringify({ businessId }))}`;
  }

  const fbAuthUrl =
    `https://www.facebook.com/v23.0/dialog/oauth` +
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
    const tokenResponse = await axios.get('https://graph.facebook.com/v23.0/oauth/access_token', {
      params: {
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        redirect_uri: FB_REDIRECT_URI,
        code: code
      }
    });

    const { access_token } = tokenResponse.data;

    // Get user info from Facebook
    const userResponse = await axios.get('https://graph.facebook.com/v23.0/me', {
      params: {
        fields: 'id,name,email,picture',
        access_token: access_token
      }
    });

    const { id: facebookId, name, email, picture } = userResponse.data;

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');
    const businessCol = db.collection('businesses');

    // Parse state parameter to check for business connection request
    let existingUser = null;
    let businessId = null;
    
    if (state) {
      try {
        // Try to parse as JSON (new format with businessId)
        const stateData = JSON.parse(state);
        if (stateData.token) {
          const decoded = jwt.verify(stateData.token, JWT_SECRET);
          existingUser = await usersCol.findOne({ _id: new ObjectId(decoded.userId) });
        }
        businessId = stateData.businessId;
      } catch (e) {
        // Fallback to old format (just token)
        try {
          const decoded = jwt.verify(state, JWT_SECRET);
          existingUser = await usersCol.findOne({ _id: new ObjectId(decoded.userId) });
        } catch (e2) {
          // Invalid token in state, continue with normal flow
        }
      }
    }

    // Handle business channel connection
    if (businessId && existingUser) {
      // This is a business channel connection request
      console.log('🔵 Processing Facebook Business connection for businessId:', businessId);
      
      try {
        // 1. Save Facebook channel info with user token
        await businessCol.updateOne(
          { _id: new ObjectId(businessId) },
          {
            $set: {
              'channels.facebook': {
                account_id: facebookId,
                access_token: access_token,
                user_id: facebookId,
                name: name,
                email: email,
                connected_at: new Date()
              },
              updatedAt: new Date()
            }
          }
        );
        console.log('✅ Saved Facebook channel info');

        // 2. Fetch user's Facebook Pages
        const pagesResponse = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
          params: {
            access_token: access_token,
            fields: 'id,name,access_token'
          }
        });

        const pages = pagesResponse.data.data || [];
        console.log(`📄 Found ${pages.length} Facebook Pages`);

        // 3. For each page, get page access token and fetch Instagram accounts
        const connectedInstagramAccounts = [];
        const facebookPages = {};

        for (const page of pages) {
          console.log(`\n📄 Processing Page: ${page.name} (ID: ${page.id})`);
          
          // Save page info
          facebookPages[page.id] = {
            id: page.id,
            name: page.name,
            access_token: page.access_token,
            connected_at: new Date()
          };

          // 4. Use page access token to fetch Instagram Business accounts
          try {
            console.log(`🔍 Fetching Instagram accounts for page: ${page.id}`);
            const instagramResponse = await axios.get(`https://graph.facebook.com/v23.0/${page.id}/instagram_accounts`, {
              params: {
                fields: 'id,username,profile_picture_url,ig_id',
                access_token: page.access_token
              }
            });

            console.log(`📱 Instagram API response for page ${page.name}:`, JSON.stringify(instagramResponse.data, null, 2));

            if (instagramResponse.data.data && instagramResponse.data.data.length > 0) {
              // Process each Instagram account connected to this page
              for (const igAccount of instagramResponse.data.data) {
                console.log(`📱 Found Instagram Account: @${igAccount.username}`);
                console.log(`🔍 Instagram Account ID: ${igAccount.id}`);
                console.log(`🔍 Instagram IG_ID: ${igAccount.ig_id}`);
                console.log(`🔍 Facebook Page ID: ${page.id}`);
                console.log(`🔍 Are they different? ${igAccount.id !== page.id}`);

                // Save Instagram account info - use ig_id as the main identifier for webhooks
                const instagramAccount = {
                  instagram_business_account_id: igAccount.ig_id || igAccount.id, // Use ig_id for webhook matching
                  instagram_account_id: igAccount.id, // Keep the regular ID for API calls
                  username: igAccount.username,
                  profile_picture_url: igAccount.profile_picture_url,
                  facebook_page_id: page.id,
                  page_name: page.name,
                  page_access_token: page.access_token,
                  connected_at: new Date()
                };

                connectedInstagramAccounts.push(instagramAccount);
                console.log(`💾 Saved Instagram account: ${igAccount.username} (Webhook ID: ${igAccount.ig_id}, API ID: ${igAccount.id})`);
              }
            } else {
              console.log(`❌ No Instagram Business Accounts found for page: ${page.name}`);
            }
          } catch (igError) {
            console.error(`❌ Error fetching Instagram for page ${page.name}:`, igError.response?.data || igError.message);
          }
        }

        console.log(`✅ Processed all ${pages.length} Facebook Pages, found ${connectedInstagramAccounts.length} Instagram accounts`);

        // Check for duplicate Instagram account IDs
        const igIds = connectedInstagramAccounts.map(acc => acc.instagram_business_account_id);
        const uniqueIgIds = [...new Set(igIds)];
        if (igIds.length !== uniqueIgIds.length) {
          console.warn(`⚠️ Found duplicate Instagram account IDs:`, igIds);
        }

        // 5. Build the complete facebook_business object with all Instagram accounts
        const facebookBusinessData = {
          connected: true,
          master_access_token: access_token,
          user_id: facebookId,
          name: name,
          email: email,
          connected_at: new Date(),
          pages: facebookPages,
          instagram_accounts: {}
        };

        // Add all Instagram accounts to the structure
        connectedInstagramAccounts.forEach(igAccount => {
          facebookBusinessData.instagram_accounts[igAccount.instagram_business_account_id] = igAccount;
        });

        // Build the complete update object
        const updateData = {
          'channels.facebook_business': facebookBusinessData,
          updatedAt: new Date()
        };

        // Add direct Instagram channel references for webhook lookup
        connectedInstagramAccounts.forEach(igAccount => {
          updateData[`channels.instagram_${igAccount.instagram_business_account_id}`] = {
            connected: true,
            connection_type: 'facebook_business',
            instagram_business_account_id: igAccount.instagram_business_account_id,
            username: igAccount.username,
            facebook_page_id: igAccount.facebook_page_id,
            page_access_token: igAccount.page_access_token,
            connected_at: new Date()
          };
        });

        console.log(`💾 Prepared update data for ${connectedInstagramAccounts.length} Instagram accounts`);
        console.log(`🔍 Instagram accounts being saved:`, connectedInstagramAccounts.map(acc => ({
          id: acc.instagram_business_account_id,
          username: acc.username,
          page: acc.page_name
        })));

        // Save all data to database
        await businessCol.updateOne(
          { _id: new ObjectId(businessId) },
          { $set: updateData }
        );

        console.log(`✅ Successfully saved ${connectedInstagramAccounts.length} Instagram accounts for business ${businessId}`);

        // Also update user's Facebook info if not already connected
        if (!existingUser.facebookId) {
          await usersCol.updateOne(
            { _id: existingUser._id },
            {
              $set: {
                facebookId: facebookId,
                facebookAccessToken: access_token,
                facebookEmail: email,
                profilePicture: existingUser.profilePicture || picture?.data?.url,
                updatedAt: new Date()
              }
            }
          );
        }

        // Return success response for business connection
        const frontendUrl = getFrontendUrl();
        res.send(`
          <html>
            <script>
              if (window.opener) {
                window.opener.postMessage({
                  type: 'FACEBOOK_AUTH_SUCCESS',
                  data: {
                    account_id: '${facebookId}',
                    name: '${name}',
                    email: '${email}',
                    pages_count: ${pages.length},
                    instagram_accounts_count: ${connectedInstagramAccounts.length},
                    instagram_accounts: ${JSON.stringify(connectedInstagramAccounts.map(acc => ({
                      id: acc.instagram_business_account_id,
                      username: acc.username,
                      page_name: acc.page_name
                    })))}
                  }
                }, '*');
                window.close();
              } else {
                window.location.href = '${frontendUrl}/dashboard/businesses/${businessId}/settings?tab=channels&fbConnected=true&igAccounts=${connectedInstagramAccounts.length}';
              }
            </script>
          </html>
        `);

      } catch (connectionError) {
        console.error('❌ Error during Facebook business connection:', connectionError.message);
        
        const frontendUrl = getFrontendUrl();
        res.send(`
          <html>
            <script>
              if (window.opener) {
                window.opener.postMessage({
                  type: 'FACEBOOK_AUTH_ERROR',
                  error: 'Failed to fetch Instagram accounts: ${connectionError.message}'
                }, '*');
                window.close();
              } else {
                window.location.href = '${frontendUrl}/dashboard/businesses/${businessId}/settings?tab=channels&fbError=${encodeURIComponent(connectionError.message)}';
              }
            </script>
          </html>
        `);
      }
      return;
    }

    if (existingUser) {
      // Existing logged-in user wants to connect Facebook
      
      // Only check if this Facebook ID is already connected to another user
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
            facebookEmail: email, // Store Facebook email separately
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

    // Enhanced validation - only check Facebook ID uniqueness
    if (!user) {
      // Check if this Facebook ID is already connected to another user
      const existingFbUser = await usersCol.findOne({ facebookId: facebookId });
      if (existingFbUser) {
        // Facebook ID already exists, log them in with the existing account
        user = existingFbUser;
      }
    }

    if (user) {
      // Update existing user with Facebook info if not already linked
      if (!user.facebookId) {
        // Only check Facebook ID uniqueness, not email matching
        const fbConflict = await usersCol.findOne({ 
          facebookId: facebookId,
          _id: { $ne: user._id }
        });
        
        if (fbConflict) {
          const frontendUrl = getFrontendUrl();
          res.redirect(`${frontendUrl}/auth/error?message=${encodeURIComponent('This Facebook account is already connected to another user')}`);
          return;
        }

        // Link Facebook to existing user account
        await usersCol.updateOne(
          { _id: user._id },
          {
            $set: {
              facebookId: facebookId,
              facebookAccessToken: access_token,
              facebookEmail: email, // Store Facebook email separately
              profilePicture: picture?.data?.url,
              updatedAt: new Date()
            }
          }
        );
      }
    } else {
      // Create new user with Facebook info
      const userDoc = {
        email: email,
        name: name,
        facebookId: facebookId,
        facebookAccessToken: access_token,
        facebookEmail: email,
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
    if (req.query.state && req.query.state.includes('businessId')) {
      // This was a business connection request, send popup response
      res.send(`
        <html>
          <script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'FACEBOOK_AUTH_ERROR',
                error: 'Failed to connect Facebook account'
              }, '*');
              window.close();
            } else {
              alert('Failed to connect Facebook account');
              window.history.back();
            }
          </script>
        </html>
      `);
    } else {
      res.redirect(`${frontendUrl}/auth/error?message=${encodeURIComponent('Facebook login failed')}`);
    }
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
      const tokenResponse = await axios.get('https://graph.facebook.com/v23.0/oauth/access_token', {
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
    const userResponse = await axios.get('https://graph.facebook.com/v23.0/me', {
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
      facebookEmail: user.facebookEmail,
      profilePicture: user.profilePicture,
      facebookAccessToken: user.facebookAccessToken,
      hasPassword: !!user.password, // Indicate if user has a password set
      businesses: user.businesses || [], // Include user's businesses
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





// Get Facebook pages for business channel connections
router.get('/facebook/pages/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessCol = db.collection('businesses');

    const business = await businessCol.findOne({ _id: new ObjectId(businessId) });
    if (!business || !business.channels?.facebook?.access_token) {
      return res.status(400).json({ error: 'Facebook account not connected' });
    }

    const access_token = business.channels.facebook.access_token;

    // Get user's Facebook pages
    const pagesResponse = await axios.get('https://graph.facebook.com/v23.0/me/accounts', {
      params: {
        access_token: access_token,
        fields: 'id,name,access_token,instagram_business_account'
      }
    });

    const pages = pagesResponse.data.data || [];

    res.json({
      success: true,
      pages: pages
    });

  } catch (error) {
    console.error('Error fetching Facebook pages:', error);
    res.status(500).json({ error: 'Failed to fetch Facebook pages' });
  }
});

// Get connected Instagram accounts for a business
router.get('/facebook/instagram-accounts/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessCol = db.collection('businesses');

    const business = await businessCol.findOne({ _id: new ObjectId(businessId) });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Get Instagram accounts from facebook_business channel
    const facebookBusiness = business.channels?.facebook_business;
    const instagramAccounts = facebookBusiness?.instagram_accounts || {};

    // Also get direct Instagram channel references
    const directChannels = {};
    Object.keys(business.channels || {}).forEach(channelKey => {
      if (channelKey.startsWith('instagram_')) {
        const igId = channelKey.replace('instagram_', '');
        directChannels[igId] = business.channels[channelKey];
      }
    });

    // Format Instagram accounts for display
    const formattedAccounts = Object.keys(instagramAccounts).map(igId => {
      const account = instagramAccounts[igId];
      return {
        webhook_id: account.instagram_business_account_id, // This is the ig_id for webhook matching
        api_id: account.instagram_account_id, // This is the regular ID for API calls
        username: account.username,
        page_name: account.page_name,
        facebook_page_id: account.facebook_page_id,
        connected_at: account.connected_at
      };
    });

    res.json({
      success: true,
      facebook_connection: {
        connected: !!facebookBusiness?.connected,
        master_token_exists: !!facebookBusiness?.master_access_token,
        pages_count: Object.keys(facebookBusiness?.pages || {}).length,
        instagram_accounts_count: Object.keys(instagramAccounts).length
      },
      instagram_accounts: formattedAccounts,
      direct_channel_references: directChannels,
      total_instagram_connections: Object.keys(instagramAccounts).length
    });

  } catch (error) {
    console.error('Error fetching Instagram accounts:', error);
    res.status(500).json({ error: 'Failed to fetch Instagram accounts' });
  }
});

// Test Instagram API endpoint (for debugging)
router.get('/facebook/test-instagram/:pageId', async (req, res) => {
  try {
    const { pageId } = req.params;
    const { access_token } = req.query;

    if (!access_token) {
      return res.status(400).json({ error: 'access_token query parameter required' });
    }

    // Test the exact API call we're using
    const instagramResponse = await axios.get(`https://graph.facebook.com/v19.0/${pageId}/instagram_accounts`, {
      params: {
        fields: 'id,username,profile_picture_url,ig_id',
        access_token: access_token
      }
    });

    res.json({
      success: true,
      page_id: pageId,
      api_response: instagramResponse.data,
      accounts_found: instagramResponse.data.data?.length || 0
    });

  } catch (error) {
    console.error('Test Instagram API error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to test Instagram API',
      details: error.response?.data || error.message
    });
  }
});

module.exports = router;
