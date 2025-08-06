const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const shopifyClient = require('../utils/shopifyClient');
const saveOrUpdateStore = require('../utils/saveOrUpdateStore');

const router = express.Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI;

router.get('/connect', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');

const scopes = [
  'read_products',
  'read_product_listings',
  'read_inventory',
  'read_collections',                 // ✅ new unified scope
  'read_shopify_payments_payouts',
  'read_orders',
  'write_orders',
  'read_customers'
];


  const redirectURL = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${scopes.join(',')}&redirect_uri=${REDIRECT_URI}`;
  res.redirect(redirectURL);
});

router.get('/callback', async (req, res) => {
  const { shop, hmac, code } = req.query;
  if (!shop || !hmac || !code) return res.status(400).send('Missing params');

  const query = { ...req.query };
  delete query.hmac;
  const message = Object.keys(query).sort().map(key => `${key}=${query[key]}`).join('&');
  const hash = crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(message).digest('hex');

  if (hash !== hmac) return res.status(403).send('HMAC validation failed');

  try {
    // Exchange code for access token
    const tokenRes = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code
    });

    const accessToken = tokenRes.data.access_token;
    const client = shopifyClient(shop, accessToken);

    // Fetch store info
    const storeInfo = await client.getStoreInfo();

    // Fetch collections + products
    const fullCollections = await client.getFullProducts();

    if (!fullCollections.length) {
      console.warn(`⚠️ No products fetched for ${shop} — check Shopify API scopes or product availability.`);
    }

    // Create a flat product array for backwards compatibility
    const flatProducts = fullCollections.flatMap(c => c.products || []);

    // Save store data
    const businessDoc = await saveOrUpdateStore(shop, accessToken, storeInfo, flatProducts, fullCollections);

    console.log(`🟢 ${businessDoc.name} (${shop}) saved/updated with ${flatProducts.length} products in ${fullCollections.length} collections.`);
    res.send(`✅ ${businessDoc.name} connected and synced with ${flatProducts.length} products.`);
  } catch (err) {
    console.error('OAuth error:', err.response?.data || err.message);
    res.status(500).send('OAuth failed');
  }
});

module.exports = router;
