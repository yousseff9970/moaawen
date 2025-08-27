const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const qs = require('qs');
const { MongoClient, ObjectId } = require('mongodb');
const { authMiddleware, requireVerified } = require('../middlewares/authMiddleware');

const client = new MongoClient(process.env.MONGO_URI);

// Configuration
const IG_APP_ID = process.env.IG_APP_ID || '698492099473419';
const IG_APP_SECRET = process.env.IG_APP_SECRET || '1868912bb8d53cf59499a605367f3eee';
const IG_REDIRECT_URI = process.env.IG_REDIRECT_URI || 'https://moaawen.onrender.com/auth/instagram/callback';

// Store state in memory (in production, use Redis or database)
const authStates = new Map();

// Clean up old states periodically
setInterval(() => {
  const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
  for (const [key, value] of authStates.entries()) {
    if (value.timestamp < tenMinutesAgo) {
      authStates.delete(key);
    }
  }
}, 5 * 60 * 1000); // Clean every 5 minutes

// ===============================
// FACEBOOK BUSINESS SUITE FLOW
// ===============================

// 1) Initiate Facebook OAuth to get Pages and Instagram accounts
router.get('/auth/facebook/url', authMiddleware, async (req, res) => {
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
    const isOwner = await verifyBusinessOwnership(user, business, req.user.userId);
    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied. You do not own this business.' });
    }

    // Generate state and store it
    const state = crypto.randomBytes(16).toString('hex');
    authStates.set(state, {
      businessId,
      userId: req.user.userId,
      connectionType: 'facebook_business',
      timestamp: Date.now()
    });

    // Facebook OAuth URL with permissions for Pages and Instagram Business
    const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth');
    authUrl.searchParams.set('client_id', IG_APP_ID);
    authUrl.searchParams.set('redirect_uri', IG_REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', [
      'pages_read_engagement',
      'pages_manage_metadata', 
      'pages_show_list',
      'instagram_basic',
      'instagram_manage_messages',
      'business_management'
    ].join(','));
    authUrl.searchParams.set('state', state);

    res.json({
      success: true,
      authUrl: authUrl.toString(),
      state,
      connectionType: 'facebook_business'
    });

  } catch (error) {
    console.error('Facebook auth URL error:', error);
    res.status(500).json({ error: 'Failed to generate Facebook auth URL' });
  }
});

// ===============================
// DIRECT INSTAGRAM OAUTH FLOW  
// ===============================

// 2) Initiate Direct Instagram OAuth
router.get('/auth/direct/url', authMiddleware, async (req, res) => {
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
    const isOwner = await verifyBusinessOwnership(user, business, req.user.userId);
    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied. You do not own this business.' });
    }

    // Generate state and store it
    const state = crypto.randomBytes(16).toString('hex');
    authStates.set(state, {
      businessId,
      userId: req.user.userId,
      connectionType: 'instagram_direct',
      timestamp: Date.now()
    });

    // Instagram Direct OAuth URL
    const authUrl = new URL('https://www.instagram.com/oauth/authorize');
    authUrl.searchParams.set('client_id', IG_APP_ID);
    authUrl.searchParams.set('redirect_uri', IG_REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', [
      'instagram_business_basic',
      'instagram_business_manage_messages',
      'instagram_business_manage_comments',
      'instagram_business_content_publish'
    ].join(','));
    authUrl.searchParams.set('state', state);

    res.json({
      success: true,
      authUrl: authUrl.toString(),
      state,
      connectionType: 'instagram_direct'
    });

  } catch (error) {
    console.error('Instagram direct auth URL error:', error);
    res.status(500).json({ error: 'Failed to generate Instagram direct auth URL' });
  }
});

// ===============================
// UNIFIED CALLBACK HANDLER
// ===============================

// 3) Handle OAuth callback for both flows
router.get('/auth/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    // Check for OAuth errors
    if (error) {
      console.error('OAuth error:', error);
      return res.status(400).send(generateErrorResponse(error));
    }

    if (!code || !state) {
      return res.status(400).send(generateErrorResponse('Missing authorization code or state parameter'));
    }

    // Verify state
    const stateData = authStates.get(state);
    if (!stateData) {
      return res.status(400).send(generateErrorResponse('Invalid or expired state parameter'));
    }

    // Clean up state
    authStates.delete(state);

    const { businessId, userId, connectionType } = stateData;

    // Route to appropriate handler based on connection type
    if (connectionType === 'facebook_business') {
      await handleFacebookBusinessCallback(code, businessId, userId, res);
    } else if (connectionType === 'instagram_direct') {
      await handleInstagramDirectCallback(code, businessId, userId, res);
    } else {
      throw new Error('Unknown connection type');
    }

  } catch (error) {
    console.error('OAuth callback error:', error.response?.data || error.message);
    res.status(500).send(generateErrorResponse(error.response?.data?.error_description || error.message));
  }
});

// ===============================
// FACEBOOK BUSINESS HANDLER
// ===============================

async function handleFacebookBusinessCallback(code, businessId, userId, res) {
  console.log('🔵 Processing Facebook Business Suite connection...');

  // 1. Exchange code for Facebook access token
  const tokenResponse = await axios.post('https://graph.facebook.com/v18.0/oauth/access_token', {
    client_id: IG_APP_ID,
    client_secret: IG_APP_SECRET,
    redirect_uri: IG_REDIRECT_URI,
    code,
  });

  const shortToken = tokenResponse.data.access_token;
  console.log('✅ Facebook short-lived token obtained');

  // 2. Exchange for long-lived token
  const longTokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: IG_APP_ID,
      client_secret: IG_APP_SECRET,
      fb_exchange_token: shortToken,
    },
  });

  const longToken = longTokenResponse.data.access_token;
  const expiresInSec = longTokenResponse.data.expires_in || 5184000;
  console.log('✅ Facebook long-lived token obtained');

  // 3. Get user's Facebook Pages
  const pagesResponse = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
    params: {
      fields: 'id,name,access_token,instagram_business_account{id,username,account_type,profile_picture_url}',
      access_token: longToken,
    },
  });

  console.log('📄 Facebook Pages found:', pagesResponse.data.data?.length || 0);

  // 4. Process each page and its Instagram account
  const connectedAccounts = [];
  
  for (const page of pagesResponse.data.data || []) {
    console.log(`\n📄 Processing Page: ${page.name} (ID: ${page.id})`);
    
    // Store Facebook Page connection
    const pageConnection = {
      type: 'facebook_page',
      facebook_page_id: page.id,
      page_name: page.name,
      page_access_token: page.access_token,
      token_type: 'facebook',
      connected_at: new Date()
    };
    
    // Check if page has Instagram Business Account
    if (page.instagram_business_account) {
      const igAccount = page.instagram_business_account;
      console.log(`📱 Instagram Account: @${igAccount.username} (ID: ${igAccount.id})`);
      
      // Store Instagram connection linked to Facebook Page
      const instagramConnection = {
        type: 'instagram_via_facebook',
        instagram_business_account_id: igAccount.id,
        username: igAccount.username,
        account_type: igAccount.account_type,
        profile_picture_url: igAccount.profile_picture_url,
        facebook_page_id: page.id,
        page_name: page.name,
        access_token: page.access_token, // Use page token for Instagram API calls
        token_type: 'facebook',
        connected_at: new Date()
      };
      
      connectedAccounts.push({
        page: pageConnection,
        instagram: instagramConnection
      });
    } else {
      connectedAccounts.push({
        page: pageConnection,
        instagram: null
      });
    }
  }

  // 5. Save to database
  await saveFacebookBusinessConnections(businessId, connectedAccounts, longToken, expiresInSec);

  // 6. Send success response
  const instagramAccounts = connectedAccounts.filter(acc => acc.instagram).map(acc => acc.instagram);
  res.send(generateSuccessResponse({
    connectionType: 'Facebook Business Suite',
    connectedPages: connectedAccounts.length,
    instagramAccounts: instagramAccounts.length,
    accounts: instagramAccounts,
    expiresAt: new Date(Date.now() + (expiresInSec * 1000))
  }));
}

// ===============================
// DIRECT INSTAGRAM HANDLER
// ===============================

async function handleInstagramDirectCallback(code, businessId, userId, res) {
  console.log('🟢 Processing Direct Instagram connection...');

  // 1. Exchange code for Instagram short-lived token
  const tokenResponse = await axios.post('https://api.instagram.com/oauth/access_token', {
    client_id: IG_APP_ID,
    client_secret: IG_APP_SECRET,
    grant_type: 'authorization_code',
    redirect_uri: IG_REDIRECT_URI,
    code,
  }, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const shortToken = tokenResponse.data.access_token;
  console.log('✅ Instagram short-lived token obtained');

  // 2. Exchange for long-lived token
  const longTokenResponse = await axios.get('https://graph.instagram.com/access_token', {
    params: {
      grant_type: 'ig_exchange_token',
      client_secret: IG_APP_SECRET,
      access_token: shortToken,
    },
  });

  const longToken = longTokenResponse.data.access_token;
  const expiresInSec = longTokenResponse.data.expires_in;
  console.log('✅ Instagram long-lived token obtained');

  // 3. Get Instagram user info
  const userInfoResponse = await axios.get('https://graph.instagram.com/me', {
    params: {
      fields: 'id,username,account_type,media_count',
      access_token: longToken,
    },
  });

  const { id: instagramBusinessId, username, account_type, media_count } = userInfoResponse.data;
  console.log(`📱 Instagram Direct: @${username} (ID: ${instagramBusinessId})`);

  // 4. Save to database
  await saveInstagramDirectConnection(businessId, {
    instagram_business_account_id: instagramBusinessId,
    username,
    account_type,
    media_count,
    access_token: longToken,
    token_type: 'instagram',
    expires_in: expiresInSec
  });

  // 5. Send success response
  res.send(generateSuccessResponse({
    connectionType: 'Direct Instagram',
    username,
    instagramBusinessId,
    accountType: account_type,
    expiresAt: new Date(Date.now() + (expiresInSec * 1000))
  }));
}

// ===============================
// DATABASE OPERATIONS
// ===============================

async function saveFacebookBusinessConnections(businessId, connectedAccounts, masterToken, expiresInSec) {
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'moaawen');
  const businessesCol = db.collection('businesses');

  const now = new Date();
  const expiresAt = new Date(now.getTime() + (expiresInSec * 1000));

  // Prepare update object
  const updateData = {
    'channels.facebook_business': {
      connected: true,
      master_access_token: masterToken,
      token_expires_at: expiresAt,
      connected_at: now,
      pages: {},
      instagram_accounts: {}
    },
    updatedAt: now
  };

  // Add each page and Instagram account
  connectedAccounts.forEach((account, index) => {
    // Add Facebook Page
    updateData[`channels.facebook_business.pages.${account.page.facebook_page_id}`] = account.page;
    
    // Add Instagram account if exists
    if (account.instagram) {
      updateData[`channels.facebook_business.instagram_accounts.${account.instagram.instagram_business_account_id}`] = account.instagram;
      
      // Also create a direct Instagram channel reference for webhook lookup
      updateData[`channels.instagram_${account.instagram.instagram_business_account_id}`] = {
        connected: true,
        connection_type: 'facebook_business',
        instagram_business_account_id: account.instagram.instagram_business_account_id,
        username: account.instagram.username,
        account_type: account.instagram.account_type,
        facebook_page_id: account.instagram.facebook_page_id,
        access_token: account.instagram.access_token,
        token_type: 'facebook',
        connected_at: now
      };
    }
  });

  const result = await businessesCol.updateOne(
    { _id: new ObjectId(businessId) },
    { $set: updateData }
  );

  if (result.modifiedCount === 0) {
    throw new Error('Failed to save Facebook Business connections to database');
  }

  console.log(`✅ Saved ${connectedAccounts.length} Facebook Business connections`);
}

async function saveInstagramDirectConnection(businessId, instagramData) {
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'moaawen');
  const businessesCol = db.collection('businesses');

  const now = new Date();
  const expiresAt = new Date(now.getTime() + (instagramData.expires_in * 1000));

  const result = await businessesCol.updateOne(
    { _id: new ObjectId(businessId) },
    {
      $set: {
        'channels.instagram_direct': {
          connected: true,
          connection_type: 'instagram_direct',
          instagram_business_account_id: instagramData.instagram_business_account_id,
          username: instagramData.username,
          account_type: instagramData.account_type,
          media_count: instagramData.media_count,
          access_token: instagramData.access_token,
          token_type: 'instagram',
          token_expires_at: expiresAt,
          connected_at: now
        },
        // Also create webhook lookup reference
        [`channels.instagram_${instagramData.instagram_business_account_id}`]: {
          connected: true,
          connection_type: 'instagram_direct',
          instagram_business_account_id: instagramData.instagram_business_account_id,
          username: instagramData.username,
          account_type: instagramData.account_type,
          access_token: instagramData.access_token,
          token_type: 'instagram',
          connected_at: now
        },
        updatedAt: now
      }
    }
  );

  if (result.modifiedCount === 0) {
    throw new Error('Failed to save Instagram direct connection to database');
  }

  console.log(`✅ Saved Instagram direct connection: @${instagramData.username}`);
}

// ===============================
// UTILITY FUNCTIONS
// ===============================

async function verifyBusinessOwnership(user, business, userId) {
  if (user.businesses && user.businesses.includes(business._id.toString())) {
    return true;
  }
  if (business.userId && business.userId.toString() === userId) {
    return true;
  }
  if (business.contact?.email && business.contact.email === user.email) {
    return true;
  }
  return false;
}

function generateErrorResponse(errorMessage) {
  return `
    <html>
      <head>
        <title>Connection Failed</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
          .error { color: #dc3545; }
          .details { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: left; }
        </style>
      </head>
      <body>
        <h2 class="error">❌ Connection Failed</h2>
        <div class="details">
          <p><strong>Error:</strong> ${errorMessage}</p>
          <p>Please try again or contact support if the problem persists.</p>
        </div>
        <script>
          if (window.opener) {
            window.opener.postMessage({ 
              type: 'AUTH_ERROR', 
              error: '${errorMessage}'
            }, '*');
          }
        </script>
      </body>
    </html>
  `;
}

function generateSuccessResponse(data) {
  return `
    <html>
      <head>
        <title>Successfully Connected</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
          .success { color: #28a745; }
          .info { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .account { background: #e7f3ff; padding: 10px; margin: 10px 0; border-radius: 5px; }
        </style>
      </head>
      <body>
        <h2 class="success">✅ ${data.connectionType} Connected Successfully!</h2>
        <div class="info">
          ${data.username ? `<p><strong>Username:</strong> @${data.username}</p>` : ''}
          ${data.instagramBusinessId ? `<p><strong>Instagram Business ID:</strong> ${data.instagramBusinessId}</p>` : ''}
          ${data.accountType ? `<p><strong>Account Type:</strong> ${data.accountType}</p>` : ''}
          ${data.connectedPages ? `<p><strong>Facebook Pages:</strong> ${data.connectedPages}</p>` : ''}
          ${data.instagramAccounts ? `<p><strong>Instagram Accounts:</strong> ${data.instagramAccounts}</p>` : ''}
          <p><strong>Token expires:</strong> ${data.expiresAt.toLocaleDateString()}</p>
        </div>
        ${data.accounts ? data.accounts.map(acc => `
          <div class="account">
            <strong>@${acc.username}</strong><br>
            ID: ${acc.instagram_business_account_id}<br>
            Page: ${acc.page_name}
          </div>
        `).join('') : ''}
        <p>You can now close this window and return to your dashboard.</p>
        <script>
          if (window.opener) {
            window.opener.postMessage({ 
              type: 'AUTH_SUCCESS', 
              data: ${JSON.stringify(data)}
            }, '*');
          }
        </script>
      </body>
    </html>
  `;
}

// ===============================
// MANAGEMENT ROUTES
// ===============================

// Get connection status
router.get('/status/:businessId', authMiddleware, async (req, res) => {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const usersCol = db.collection('users');

    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    const business = await businessesCol.findOne({ _id: new ObjectId(req.params.businessId) });

    if (!business || !user) {
      return res.status(404).json({ error: 'Business or user not found' });
    }

    const isOwner = await verifyBusinessOwnership(user, business, req.user.userId);
    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const connections = {
      facebook_business: business.channels?.facebook_business || null,
      instagram_direct: business.channels?.instagram_direct || null,
      instagram_accounts: []
    };

    // Collect all Instagram accounts from various connections
    if (connections.facebook_business?.instagram_accounts) {
      Object.values(connections.facebook_business.instagram_accounts).forEach(acc => {
        connections.instagram_accounts.push({
          ...acc,
          source: 'facebook_business'
        });
      });
    }

    if (connections.instagram_direct) {
      connections.instagram_accounts.push({
        ...connections.instagram_direct,
        source: 'instagram_direct'
      });
    }

    res.json({
      success: true,
      connections
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Failed to get connection status' });
  }
});

// Disconnect specific connection
router.delete('/disconnect/:businessId/:connectionType', authMiddleware, async (req, res) => {
  try {
    const { businessId, connectionType } = req.params;
    const { accountId } = req.query; // For specific Instagram account

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const usersCol = db.collection('users');

    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    const business = await businessesCol.findOne({ _id: new ObjectId(businessId) });

    if (!business || !user) {
      return res.status(404).json({ error: 'Business or user not found' });
    }

    const isOwner = await verifyBusinessOwnership(user, business, req.user.userId);
    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let updateQuery = { $unset: {}, $set: { updatedAt: new Date() } };

    if (connectionType === 'facebook_business') {
      updateQuery.$unset['channels.facebook_business'] = '';
      // Also remove all Instagram channel references
      const fbBusiness = business.channels?.facebook_business;
      if (fbBusiness?.instagram_accounts) {
        Object.keys(fbBusiness.instagram_accounts).forEach(igId => {
          updateQuery.$unset[`channels.instagram_${igId}`] = '';
        });
      }
    } else if (connectionType === 'instagram_direct') {
      updateQuery.$unset['channels.instagram_direct'] = '';
      const igDirect = business.channels?.instagram_direct;
      if (igDirect?.instagram_business_account_id) {
        updateQuery.$unset[`channels.instagram_${igDirect.instagram_business_account_id}`] = '';
      }
    }

    const result = await businessesCol.updateOne(
      { _id: new ObjectId(businessId) },
      updateQuery
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: 'Failed to disconnect' });
    }

    res.json({
      success: true,
      message: `${connectionType} disconnected successfully`
    });

  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

module.exports = router;
