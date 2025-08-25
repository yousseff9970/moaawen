const express = require('express');
const router = express.Router();
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');

const client = new MongoClient(process.env.MONGO_URI);

// Facebook OAuth callback
router.get('/facebook/callback', async (req, res) => {
  try {
    const { code, state: businessId } = req.query;
    
    if (!code) {
      return res.status(400).send('Authorization code not provided');
    }

    // Exchange code for access token
    const FB_APP_ID = process.env.FACEBOOK_APP_ID;
    const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    const REDIRECT_URI = `${process.env.FRONTEND_URL}/auth/facebook/callback`;

    const tokenResponse = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
      params: {
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code: code
      }
    });

    const { access_token } = tokenResponse.data;

    // Get user info
    const userResponse = await axios.get(`https://graph.facebook.com/v18.0/me`, {
      params: {
        access_token: access_token,
        fields: 'id,name,email'
      }
    });

    const { id: userId, name, email } = userResponse.data;

    // Store Facebook account info in business if businessId provided
    if (businessId) {
      await client.connect();
      const db = client.db(process.env.DB_NAME || 'moaawen');
      const businessesCol = db.collection('businesses');

      await businessesCol.updateOne(
        { _id: new ObjectId(businessId) },
        { 
          $set: { 
            'channels.facebook': {
              account_id: userId,
              access_token: access_token,
              user_id: userId,
              name: name,
              email: email
            },
            updatedAt: new Date()
          }
        }
      );
    }

    // Close the popup window and redirect parent
    res.send(`
      <script>
        if (window.opener) {
          window.opener.postMessage({
            type: 'FACEBOOK_AUTH_SUCCESS',
            data: {
              access_token: '${access_token}',
              user_id: '${userId}',
              name: '${name}',
              email: '${email}'
            }
          }, '*');
          window.close();
        } else {
          window.location.href = '${process.env.FRONTEND_URL}/dashboard/businesses/${businessId}/settings?tab=channels';
        }
      </script>
    `);

  } catch (error) {
    console.error('Facebook OAuth error:', error);
    res.status(500).send(`
      <script>
        if (window.opener) {
          window.opener.postMessage({
            type: 'FACEBOOK_AUTH_ERROR',
            error: 'Failed to connect Facebook account'
          }, '*');
          window.close();
        } else {
          alert('Failed to connect Facebook account');
          window.location.href = '${process.env.FRONTEND_URL}/dashboard/businesses';
        }
      </script>
    `);
  }
});

// Get Facebook pages for Instagram/Messenger connection
router.get('/facebook/:businessId/pages', async (req, res) => {
  try {
    const { businessId } = req.params;

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');

    const business = await businessesCol.findOne({ _id: new ObjectId(businessId) });
    
    if (!business || !business.channels?.facebook?.access_token) {
      return res.status(400).json({ error: 'Facebook account not connected' });
    }

    // Get user's Facebook pages
    const pagesResponse = await axios.get(`https://graph.facebook.com/v18.0/me/accounts`, {
      params: {
        access_token: business.channels.facebook.access_token,
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

module.exports = router;
