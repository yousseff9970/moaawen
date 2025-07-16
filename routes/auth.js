const express = require('express');
const axios = require('axios');
const router = express.Router();
const Business = require('../models/Business');

// Step 1: Redirect to Facebook OAuth
router.get('/facebook', (req, res) => {
  const fbAuthUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${process.env.FACEBOOK_APP_ID}&redirect_uri=${process.env.OAUTH_REDIRECT_URI}&scope=pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,instagram_basic,instagram_manage_messages`;
  res.redirect(fbAuthUrl);
});

// Step 2: Callback and Save Access Token
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code returned from Facebook.');

  try {
    const tokenRes = await axios.get(`https://graph.facebook.com/v19.0/oauth/access_token`, {
      params: {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: process.env.OAUTH_REDIRECT_URI,
        code,
      }
    });

    const userToken = tokenRes.data.access_token;

    const pagesRes = await axios.get(`https://graph.facebook.com/v19.0/me/accounts?fields=name,id,access_token,connected_instagram_account`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });

    const page = pagesRes.data.data[0]; // Choose the first page for now

    const businessData = {
      name: page.name,
      page_id: page.id,
      access_token: page.access_token,
      ig_id: page.connected_instagram_account?.id || null
    };

    const existing = await Business.findOne({ page_id: businessData.page_id });
    if (existing) {
      await Business.updateOne({ page_id: businessData.page_id }, businessData);
    } else {
      await Business.create(businessData);
    }
console.log('Callback Query:', req.query);
    res.send('✅ Business connected successfully!');
  } catch (err) {
    console.log('Callback Query:', req.query);
    console.error('OAuth Error:', err.response?.data || err.message);
    res.status(500).send('OAuth failed');
  }
});

module.exports = router;
