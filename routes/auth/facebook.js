// routes/auth/facebook.js
const { 
  express, 
  jwt, 
  ObjectId, 
  axios, 
  getDb, 
  JWT_SECRET, 
  FB_APP_ID, 
  FB_APP_SECRET, 
  FB_REDIRECT_URI, 
  getFrontendUrl 
} = require('./shared');

const router = express.Router();

// Generate Facebook login URL - only basic user permissions
router.get('/login-url', (req, res) => {
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
router.get('/', (req, res) => {
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
router.get('/callback', async (req, res) => {
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

   const db = await getDb();
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
            const instagramResponse = await axios.get(`https://graph.facebook.com/v19.0/${page.id}/instagram_accounts`, {
              params: {
                fields: 'id,username,profile_picture_url',
                access_token: page.access_token
              }
            });

            console.log(`📱 Instagram API response for page ${page.name}:`, JSON.stringify(instagramResponse.data, null, 2));

            if (instagramResponse.data.data && instagramResponse.data.data.length > 0) {
              // Process each Instagram account connected to this page
              for (const igAccount of instagramResponse.data.data) {
                console.log(`📱 Found Instagram Account: @${igAccount.username}`);
                console.log(`🔍 Instagram Account ID: ${igAccount.id}`);
                console.log(`🔍 Facebook Page ID: ${page.id}`);
                console.log(`🔍 Are they different? ${igAccount.id !== page.id}`);

                // Save Instagram account info - use id as the identifier
                const instagramAccount = {
                  instagram_business_account_id: igAccount.id,
                  username: igAccount.username,
                  profile_picture_url: igAccount.profile_picture_url,
                  facebook_page_id: page.id,
                  page_name: page.name,
                  page_access_token: page.access_token,
                  connected_at: new Date()
                };

                connectedInstagramAccounts.push(instagramAccount);
                console.log(`💾 Saved Instagram account: ${igAccount.username} (ID: ${igAccount.id})`);
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
            <head>
              <title>Facebook Connection Success</title>
              <style>
                body { 
                  font-family: Arial, sans-serif; 
                  display: flex; 
                  justify-content: center; 
                  align-items: center; 
                  height: 100vh; 
                  margin: 0; 
                  background: #f0f2f5;
                }
                .container { 
                  text-align: center; 
                  background: white; 
                  padding: 2rem; 
                  border-radius: 8px; 
                  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
              </style>
            </head>
            <body>
              <div class="container">
                <h2>✅ Facebook Connected Successfully!</h2>
                <p>Redirecting back to dashboard...</p>
              </div>
              <script>
                console.log('Facebook auth success - attempting to close popup');
                
                function closePopupAndRedirect() {
                  if (window.opener && !window.opener.closed) {
                    console.log('Posting message to parent window');
                    try {
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
                      
                      // Try to close after a short delay
                      setTimeout(() => {
                        console.log('Attempting to close popup window');
                        window.close();
                        
                        // Fallback: if window didn't close, redirect parent
                        setTimeout(() => {
                          if (!window.closed) {
                            console.log('Window close failed, redirecting parent');
                            window.opener.location.href = '${frontendUrl}/dashboard/businesses/${businessId}/settings?tab=channels&fbConnected=true&igAccounts=${connectedInstagramAccounts.length}';
                          }
                        }, 500);
                      }, 100);
                      
                    } catch (err) {
                      console.error('Error posting message:', err);
                      // Fallback to direct redirect
                      window.location.href = '${frontendUrl}/dashboard/businesses/${businessId}/settings?tab=channels&fbConnected=true&igAccounts=${connectedInstagramAccounts.length}';
                    }
                  } else {
                    console.log('No opener window, redirecting directly');
                    window.location.href = '${frontendUrl}/dashboard/businesses/${businessId}/settings?tab=channels&fbConnected=true&igAccounts=${connectedInstagramAccounts.length}';
                  }
                }
                
                // Execute immediately and with a fallback timeout
                closePopupAndRedirect();
                
                // Fallback: redirect after 3 seconds if nothing else worked
                setTimeout(() => {
                  console.log('Fallback redirect after 3 seconds');
                  window.location.href = '${frontendUrl}/dashboard/businesses/${businessId}/settings?tab=channels&fbConnected=true&igAccounts=${connectedInstagramAccounts.length}';
                }, 3000);
              </script>
            </body>
          </html>
        `);

      } catch (connectionError) {
        console.error('❌ Error during Facebook business connection:', connectionError.message);
        
        const frontendUrl = getFrontendUrl();
        res.send(`
          <html>
            <head>
              <title>Facebook Connection Error</title>
              <style>
                body { 
                  font-family: Arial, sans-serif; 
                  display: flex; 
                  justify-content: center; 
                  align-items: center; 
                  height: 100vh; 
                  margin: 0; 
                  background: #f0f2f5;
                }
                .container { 
                  text-align: center; 
                  background: white; 
                  padding: 2rem; 
                  border-radius: 8px; 
                  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
              </style>
            </head>
            <body>
              <div class="container">
                <h2>❌ Connection Error</h2>
                <p>Failed to connect Instagram accounts. Redirecting back...</p>
              </div>
              <script>
                console.log('Facebook auth error - attempting to close popup');
                
                function closePopupAndRedirect() {
                  if (window.opener && !window.opener.closed) {
                    try {
                      window.opener.postMessage({
                        type: 'FACEBOOK_AUTH_ERROR',
                        error: 'Failed to fetch Instagram accounts: ${connectionError.message}'
                      }, '*');
                      
                      setTimeout(() => {
                        window.close();
                        setTimeout(() => {
                          if (!window.closed) {
                            window.opener.location.href = '${frontendUrl}/dashboard/businesses/${businessId}/settings?tab=channels&fbError=${encodeURIComponent(connectionError.message)}';
                          }
                        }, 500);
                      }, 100);
                      
                    } catch (err) {
                      window.location.href = '${frontendUrl}/dashboard/businesses/${businessId}/settings?tab=channels&fbError=${encodeURIComponent(connectionError.message)}';
                    }
                  } else {
                    window.location.href = '${frontendUrl}/dashboard/businesses/${businessId}/settings?tab=channels&fbError=${encodeURIComponent(connectionError.message)}';
                  }
                }
                
                closePopupAndRedirect();
                
                setTimeout(() => {
                  window.location.href = '${frontendUrl}/dashboard/businesses/${businessId}/settings?tab=channels&fbError=${encodeURIComponent(connectionError.message)}';
                }, 3000);
              </script>
            </body>
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
      { 
        userId: user._id, 
        email: user.email,
        verified: user.isEmailVerified !== false // Social auth users are considered verified by default
      },
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
          <head>
            <title>Facebook Connection Failed</title>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                display: flex; 
                justify-content: center; 
                align-items: center; 
                height: 100vh; 
                margin: 0; 
                background: #f0f2f5;
              }
              .container { 
                text-align: center; 
                background: white; 
                padding: 2rem; 
                border-radius: 8px; 
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h2>❌ Connection Failed</h2>
              <p>Failed to connect Facebook account. Closing window...</p>
            </div>
            <script>
              console.log('Facebook auth failed - attempting to close popup');
              
              function closePopupAndRedirect() {
                if (window.opener && !window.opener.closed) {
                  try {
                    window.opener.postMessage({
                      type: 'FACEBOOK_AUTH_ERROR',
                      error: 'Failed to connect Facebook account'
                    }, '*');
                    
                    setTimeout(() => {
                      window.close();
                      setTimeout(() => {
                        if (!window.closed) {
                          window.opener.location.href = window.opener.location.href;
                        }
                      }, 500);
                    }, 100);
                    
                  } catch (err) {
                    alert('Failed to connect Facebook account');
                    window.history.back();
                  }
                } else {
                  alert('Failed to connect Facebook account');
                  window.history.back();
                }
              }
              
              closePopupAndRedirect();
              
              setTimeout(() => {
                window.history.back();
              }, 3000);
            </script>
          </body>
        </html>
      `);
    } else {
      res.redirect(`${frontendUrl}/auth/error?message=${encodeURIComponent('Facebook login failed')}`);
    }
  }
});

// Check for and fix duplicate Facebook connections (admin utility)
router.post('/fix-duplicates', async (req, res) => {
  try {
    // This should be protected - only allow for admin or specific conditions
    const { adminKey } = req.body;
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const db = await getDb();
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
router.post('/disconnect', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const db = await getDb();
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
router.post('/callback', async (req, res) => {
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

    const db = await getDb();
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
      { 
        userId: user._id, 
        email: user.email,
        verified: user.isEmailVerified !== false // Social auth users are considered verified by default
      },
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

module.exports = router;
