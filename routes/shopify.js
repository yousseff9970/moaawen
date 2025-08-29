const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const shopifyClient = require('../utils/shopifyClient');
const saveOrUpdateStore = require('../utils/saveOrUpdateStore');
const getdb = require('../db');

const router = express.Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI;

router.get('/connect', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');

const scopes = [
  'read_products',
 
  'read_inventory',
                // ✅ new unified scope
  'read_shopify_payments_payouts',
  'read_orders',
  'write_orders',
  'read_customers'
];


  const redirectURL = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${scopes.join(',')}&redirect_uri=${REDIRECT_URI}`;
  res.redirect(redirectURL);
});

router.get('/callback', async (req, res) => {
  const { shop, hmac, code, state } = req.query;
  if (!shop || !hmac || !code) return res.status(400).send('Missing params');

  const query = { ...req.query };
  delete query.hmac;
  const message = Object.keys(query).sort().map(key => `${key}=${query[key]}`).join('&');
  const hash = crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(message).digest('hex');

  if (hash !== hmac) return res.status(403).send('HMAC validation failed');

  // Check if this is a business-specific connection
  let businessConnection = null;
  if (state) {
    try {
      businessConnection = JSON.parse(Buffer.from(state, 'base64').toString());
    } catch (err) {
      console.warn('Invalid state parameter:', err.message);
    }
  }

  try {
    console.log(`🔗 Processing Shopify callback for ${shop}...`);
    
    // Exchange code for access token
    const tokenRes = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code
    });

    const accessToken = tokenRes.data.access_token;
    console.log(`🔑 Access token obtained for ${shop}`);
    
    const client = shopifyClient(shop, accessToken);

    // Fetch store info
    console.log(`🏪 Fetching store info for ${shop}...`);
    const storeInfo = await client.getStoreInfo();

    // Fetch collections + products
    console.log(`📦 Fetching products and collections for ${shop}...`);
    const fullCollections = await client.getFullProducts();

    if (!fullCollections.length) {
      console.warn(`⚠️ No collections fetched for ${shop} — check Shopify API scopes or product availability.`);
    }

    // Create a flat product array for backwards compatibility
    const flatProducts = fullCollections.flatMap(c => c.products || []);
    
    // Validate we have products with proper variant data
    const variantCount = flatProducts.reduce((count, p) => count + (p.variants?.length || 0), 0);
    const variantsWithStock = flatProducts.reduce((count, p) => 
      count + (p.variants?.filter(v => v.hasOwnProperty('inStock')).length || 0), 0
    );

    console.log(`📊 Pre-save validation:
      • Collections: ${fullCollections.length}
      • Products: ${flatProducts.length}
      • Variants: ${variantCount}
      • Variants with stock info: ${variantsWithStock}`);

    if (flatProducts.length === 0) {
      console.warn(`⚠️ No products found for ${shop}. This might indicate a scoping issue.`);
    }

    // Handle business-specific connection vs global connection
    if (businessConnection && businessConnection.businessId) {
      // Business-specific connection
      console.log(`🏢 Business-specific connection for business ${businessConnection.businessId}`);

      const db = await getdb();
      const businessesCol = db.collection('businesses');

      // Check if business exists
      const business = await businessesCol.findOne({ _id: new ObjectId(businessConnection.businessId) });
      if (!business) {
        return res.status(404).send(`
          <script>
            window.opener.postMessage({
              type: 'SHOPIFY_AUTH_ERROR',
              error: 'Business not found'
            }, '*');
            window.close();
          </script>
        `);
      }

      // Update business with Shopify connection
      await businessesCol.updateOne(
        { _id: new ObjectId(businessConnection.businessId) },
        {
          $set: {
            'channels.shopify': {
              shop_domain: shop,
              access_token: accessToken,
              connected_at: new Date().toISOString(),
              last_sync: new Date().toISOString()
            },
            products: flatProducts,
            collections: fullCollections,
            shop: shop, // For backward compatibility
            accessToken: accessToken, // For backward compatibility
            updatedAt: new Date()
          }
        }
      );

      console.log(`✅ Business ${businessConnection.businessId} connected to Shopify store ${shop}`);
      
      res.send(`
        <script>
          window.opener.postMessage({
            type: 'SHOPIFY_AUTH_SUCCESS',
            data: { shop: '${shop}', businessId: '${businessConnection.businessId}' }
          }, '*');
          window.close();
        </script>
      `);
    } else {
      // Original global connection method
      console.log(`💾 Saving data for ${shop} (global method)...`);
      const businessDoc = await saveOrUpdateStore(shop, accessToken, storeInfo, flatProducts, fullCollections);

      console.log(`🟢 ${businessDoc.name} (${shop}) saved/updated successfully`);
      res.send(`✅ ${businessDoc.name} connected and synced with ${flatProducts.length} products and ${variantCount} variants.`);
    }
    
  } catch (err) {
    console.error(`❌ OAuth error for ${shop}:`, err.response?.data || err.message);
    console.error('Full error stack:', err.stack);
    res.status(500).send(`OAuth failed: ${err.message}`);
  }
});

module.exports = router;
