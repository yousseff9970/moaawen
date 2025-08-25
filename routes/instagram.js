const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const qs = require('qs');
const { MongoClient, ObjectId } = require('mongodb');
const authMiddleware = require('../middlewares/authMiddleware');

const client = new MongoClient(process.env.MONGO_URI);

// Instagram OAuth configuration
const IG_APP_ID = process.env.IG_APP_ID || '698492099473419';
const IG_APP_SECRET = process.env.IG_APP_SECRET || '1868912bb8d53cf59499a605367f3eee';
const IG_REDIRECT_URI = process.env.IG_REDIRECT_URI || 'https://moaawen.onrender.com/auth/instagram/callback';
const IG_SCOPES = process.env.IG_SCOPES || [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
  'instagram_business_content_publish',
  'instagram_business_manage_insights'
].join(',');

// Store state in memory (in production, use Redis or database)
const authStates = new Map();

// 1) Initiate Instagram OAuth - get authorization URL
router.get('/auth/url', authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.query;
    
    if (!businessId) {
      return res.status(400).json({ error: 'businessId is required' });
    }

    // Verify business ownership
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const usersCol = db.collection('users');

    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    const business = await businessesCol.findOne({ _id: new ObjectId(businessId) });

    if (!business || !user) {
      return res.status(404).json({ error: 'Business or user not found' });
    }

    // Check ownership
    let isOwner = false;
    if (user.businesses && user.businesses.includes(businessId)) {
      isOwner = true;
    } else if (business.userId && business.userId.toString() === req.user.userId) {
      isOwner = true;
    } else if (business.contact?.email && business.contact.email === user.email) {
      isOwner = true;
    }

    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied. You do not own this business.' });
    }

    // Generate state and store it
    const state = crypto.randomBytes(16).toString('hex');
    authStates.set(state, {
      businessId,
      userId: req.user.userId,
      timestamp: Date.now()
    });

    // Clean old states (older than 10 minutes)
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    for (const [key, value] of authStates.entries()) {
      if (value.timestamp < tenMinutesAgo) {
        authStates.delete(key);
      }
    }

    // Build Instagram OAuth URL
    const authUrl = new URL('https://www.instagram.com/oauth/authorize');
    authUrl.searchParams.set('client_id', IG_APP_ID);
    authUrl.searchParams.set('redirect_uri', IG_REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', IG_SCOPES);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('force_reauth', 'true');

    res.json({
      success: true,
      authUrl: authUrl.toString(),
      state
    });

  } catch (error) {
    console.error('Instagram auth URL error:', error);
    res.status(500).json({ error: 'Failed to generate Instagram auth URL' });
  }
});

// 2) Handle Instagram OAuth callback
router.get('/auth/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    // Check for OAuth errors
    if (error) {
      console.error('Instagram OAuth error:', error);
      return res.status(400).send(`
        <html><body>
          <h2>Instagram Connection Failed</h2>
          <p>Error: ${error}</p>
          <p>You can close this window and try again.</p>
        </body></html>
      `);
    }

    if (!code || !state) {
      return res.status(400).send(`
        <html><body>
          <h2>Instagram Connection Failed</h2>
          <p>Missing authorization code or state parameter.</p>
          <p>You can close this window and try again.</p>
        </body></html>
      `);
    }

    // Verify state
    const stateData = authStates.get(state);
    if (!stateData) {
      return res.status(400).send(`
        <html><body>
          <h2>Instagram Connection Failed</h2>
          <p>Invalid or expired state parameter.</p>
          <p>You can close this window and try again.</p>
        </body></html>
      `);
    }

    // Clean up state
    authStates.delete(state);

    const { businessId, userId } = stateData;

    // Exchange authorization code for short-lived token
    console.log('Exchanging code for token...');
    const tokenResponse = await axios({
      method: 'post',
      url: 'https://api.instagram.com/oauth/access_token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: qs.stringify({
        client_id: IG_APP_ID,
        client_secret: IG_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: IG_REDIRECT_URI,
        code,
      }),
      timeout: 15000,
    });

    const shortToken = tokenResponse.data.access_token;
    console.log('Short-lived token obtained');

    // Exchange short-lived token for long-lived token
    console.log('Exchanging for long-lived token...');
const longTokenResponse = await axios.get('https://graph.instagram.com/access_token', {
  params: {
    grant_type: 'ig_exchange_token',
    client_secret: IG_APP_SECRET,
    access_token: shortToken,
  },
  timeout: 15000,
});

    const longToken = longTokenResponse.data.access_token;
    const expiresInSec = longTokenResponse.data.expires_in; // ~5184000 (60 days)
    console.log('Long-lived token obtained, expires in:', expiresInSec, 'seconds');

    // Fetch Instagram business user info
    console.log('Fetching user info...');
    const userInfoResponse = await axios.get('https://graph.instagram.com/me', {
      params: {
        fields: 'id,username,account_type,media_count',
        access_token: longToken,
      },
      timeout: 15000,
    });

    const { id: instagramUserId, username, account_type, media_count } = userInfoResponse.data;
    console.log('Instagram user info:', { instagramUserId, username, account_type });

    // Save to database
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + (expiresInSec * 1000));

    const result = await businessesCol.updateOne(
      { _id: new ObjectId(businessId) },
      {
        $set: {
          'channels.instagram': {
            connected: true,
            username: username,
            account_id: instagramUserId,
            access_token: longToken,
            user_id: instagramUserId,
            connection_type: 'direct',
            account_type: account_type,
            media_count: media_count,
            token_expires_at: expiresAt,
            connected_at: now
          },
          updatedAt: now
        }
      }
    );

    if (result.modifiedCount === 0) {
      throw new Error('Failed to save Instagram connection to database');
    }

    console.log('Instagram connection saved to database for business:', businessId);

    // Success response
    res.send(`
      <html>
        <head>
          <title>Instagram Connected Successfully</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
            .success { color: #28a745; }
            .info { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <h2 class="success">✅ Instagram Connected Successfully!</h2>
          <div class="info">
            <p><strong>Account:</strong> @${username}</p>
            <p><strong>Type:</strong> ${account_type}</p>
            <p><strong>Instagram ID:</strong> ${instagramUserId}</p>
            <p><strong>Token expires:</strong> ${expiresAt.toLocaleDateString()}</p>
          </div>
          <p>You can now close this window and return to your dashboard.</p>
          <script>
            // Notify parent window if this is a popup
            if (window.opener) {
              window.opener.postMessage({ 
                type: 'INSTAGRAM_AUTH_SUCCESS', 
                data: { username: '${username}', account_type: '${account_type}' }
              }, '*');
            }
          </script>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('Instagram OAuth callback error:', error.response?.data || error.message);
    
    res.status(500).send(`
      <html>
        <head>
          <title>Instagram Connection Failed</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
            .error { color: #dc3545; }
            .details { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: left; }
          </style>
        </head>
        <body>
          <h2 class="error">❌ Instagram Connection Failed</h2>
          <div class="details">
            <p><strong>Error:</strong> ${error.response?.data?.error_description || error.message}</p>
            <p>Please try again or contact support if the problem persists.</p>
          </div>
          <script>
            // Notify parent window if this is a popup
            if (window.opener) {
              window.opener.postMessage({ 
                type: 'INSTAGRAM_AUTH_ERROR', 
                error: '${error.response?.data?.error_description || error.message}'
              }, '*');
            }
          </script>
        </body>
      </html>
    `);
  }
});

// 3) Refresh Instagram token
router.post('/refresh/:businessId', authMiddleware, async (req, res) => {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const usersCol = db.collection('users');

    // Verify business ownership
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    const business = await businessesCol.findOne({ _id: new ObjectId(req.params.businessId) });

    if (!business || !user) {
      return res.status(404).json({ error: 'Business or user not found' });
    }

    if (!business.channels?.instagram?.access_token) {
      return res.status(400).json({ error: 'No Instagram connection found' });
    }

    // Check ownership
    let isOwner = false;
    if (user.businesses && user.businesses.includes(req.params.businessId)) {
      isOwner = true;
    } else if (business.userId && business.userId.toString() === req.user.userId) {
      isOwner = true;
    } else if (business.contact?.email && business.contact.email === user.email) {
      isOwner = true;
    }

    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied. You do not own this business.' });
    }

    // Refresh the token
    const refreshResponse = await axios({
      method: 'post',
      url: 'https://graph.instagram.com/refresh_access_token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: qs.stringify({
        grant_type: 'ig_refresh_token',
        access_token: business.channels.instagram.access_token,
      }),
      timeout: 15000,
    });

    const newToken = refreshResponse.data.access_token;
    const expiresInSec = refreshResponse.data.expires_in;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (expiresInSec * 1000));

    // Update database
    const result = await businessesCol.updateOne(
      { _id: new ObjectId(req.params.businessId) },
      {
        $set: {
          'channels.instagram.access_token': newToken,
          'channels.instagram.token_expires_at': expiresAt,
          'updatedAt': now
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: 'Failed to update token' });
    }

    res.json({
      success: true,
      message: 'Instagram token refreshed successfully',
      expires_at: expiresAt
    });

  } catch (error) {
    console.error('Instagram token refresh error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to refresh Instagram token',
      details: error.response?.data || error.message 
    });
  }
});

// 4) Disconnect Instagram
router.delete('/disconnect/:businessId', authMiddleware, async (req, res) => {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const usersCol = db.collection('users');

    // Verify business ownership
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    const business = await businessesCol.findOne({ _id: new ObjectId(req.params.businessId) });

    if (!business || !user) {
      return res.status(404).json({ error: 'Business or user not found' });
    }

    // Check ownership
    let isOwner = false;
    if (user.businesses && user.businesses.includes(req.params.businessId)) {
      isOwner = true;
    } else if (business.userId && business.userId.toString() === req.user.userId) {
      isOwner = true;
    } else if (business.contact?.email && business.contact.email === user.email) {
      isOwner = true;
    }

    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied. You do not own this business.' });
    }

    // Remove Instagram connection
    const result = await businessesCol.updateOne(
      { _id: new ObjectId(req.params.businessId) },
      {
        $unset: {
          'channels.instagram': ''
        },
        $set: {
          'updatedAt': new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: 'Failed to disconnect Instagram' });
    }

    res.json({
      success: true,
      message: 'Instagram disconnected successfully'
    });

  } catch (error) {
    console.error('Instagram disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Instagram' });
  }
});

// 5) Get Instagram connection status
router.get('/status/:businessId', authMiddleware, async (req, res) => {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const usersCol = db.collection('users');

    // Verify business ownership
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    const business = await businessesCol.findOne({ _id: new ObjectId(req.params.businessId) });

    if (!business || !user) {
      return res.status(404).json({ error: 'Business or user not found' });
    }

    // Check ownership
    let isOwner = false;
    if (user.businesses && user.businesses.includes(req.params.businessId)) {
      isOwner = true;
    } else if (business.userId && business.userId.toString() === req.user.userId) {
      isOwner = true;
    } else if (business.contact?.email && business.contact.email === user.email) {
      isOwner = true;
    }

    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied. You do not own this business.' });
    }

    const instagram = business.channels?.instagram;
    
    if (!instagram) {
      return res.json({
        connected: false,
        message: 'No Instagram connection found'
      });
    }

    // Check if token is expired
    const now = new Date();
    const isExpired = instagram.token_expires_at && new Date(instagram.token_expires_at) < now;

    res.json({
      connected: true,
      username: instagram.username,
      account_type: instagram.account_type,
      account_id: instagram.account_id,
      connection_type: instagram.connection_type,
      media_count: instagram.media_count,
      connected_at: instagram.connected_at,
      token_expires_at: instagram.token_expires_at,
      token_expired: isExpired
    });

  } catch (error) {
    console.error('Instagram status error:', error);
    res.status(500).json({ error: 'Failed to get Instagram status' });
  }
});

module.exports = router;
