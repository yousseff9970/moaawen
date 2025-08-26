const express = require('express');
const crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');
const shopifyClient = require('../../utils/shopifyClient');
const saveOrUpdateStore = require('../../utils/saveOrUpdateStore');

const router = express.Router();

// Environment variables
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const BASE_URL = process.env.BASE_URL || 'https://moaawen.onrender.com';

// MongoDB client
const client = new MongoClient(process.env.MONGO_URI);

// POST /:businessId/channels/shopify/connect
// Initiate Shopify OAuth flow for a specific business
router.post('/:businessId/channels/shopify/connect', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { shop_domain } = req.body;

    if (!shop_domain) {
      return res.status(400).json({
        success: false,
        error: 'Shop domain is required'
      });
    }

    // Clean the domain
    const cleanDomain = shop_domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '');

    // Validate Shopify domain format
    const shopifyRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]\.myshopify\.com$|^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.([a-zA-Z]{2,}(\.[a-zA-Z]{2,})?)$/;
    
    if (!shopifyRegex.test(cleanDomain)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Shopify domain format'
      });
    }

    // Define OAuth scopes
    const scopes = [
      'read_products',
      'read_inventory',
      'read_shopify_payments_payouts',
      'read_orders',
      'write_orders',
      'read_customers'
    ];

    // Create OAuth URL with businessId in state parameter
    const state = Buffer.from(JSON.stringify({ businessId, shop: cleanDomain })).toString('base64');
    const redirectUri = `${BASE_URL}/shopify/callback`;
    
    const authUrl = `https://${cleanDomain}/admin/oauth/authorize?` +
      `client_id=${SHOPIFY_API_KEY}&` +
      `scope=${scopes.join(',')}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `state=${state}`;

    res.json({
      success: true,
      authUrl
    });

  } catch (error) {
    console.error('Shopify connect error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate Shopify connection'
    });
  }
});

// DELETE /:businessId/channels/shopify
// Disconnect Shopify from a specific business
router.delete('/:businessId/channels/shopify', async (req, res) => {
  try {
    const { businessId } = req.params;

    await client.connect();
    const businessesCol = client.db().collection('businesses');

    // Remove Shopify connection but keep products
    await businessesCol.updateOne(
      { _id: new ObjectId(businessId) },
      {
        $unset: {
          'channels.shopify': '',
          shop: '',
          accessToken: ''
        }
      }
    );

    res.json({
      success: true,
      message: 'Shopify store disconnected successfully'
    });

  } catch (error) {
    console.error('Shopify disconnect error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to disconnect Shopify store'
    });
  }
});

// POST /:businessId/channels/shopify/sync
// Manually sync products from Shopify for a specific business
router.post('/:businessId/channels/shopify/sync', async (req, res) => {
  try {
    const { businessId } = req.params;

    await client.connect();
    const businessesCol = client.db().collection('businesses');

    // Get business with Shopify connection
    const business = await businessesCol.findOne({ _id: new ObjectId(businessId) });
    if (!business) {
      return res.status(404).json({
        success: false,
        error: 'Business not found'
      });
    }

    if (!business.channels?.shopify?.shop_domain || !business.channels?.shopify?.access_token) {
      return res.status(400).json({
        success: false,
        error: 'Shopify not connected to this business'
      });
    }

    const { shop_domain, access_token } = business.channels.shopify;

    // Sync products
    const result = await syncShopifyProducts(businessId, shop_domain, access_token);

    // Update last sync time
    await businessesCol.updateOne(
      { _id: new ObjectId(businessId) },
      {
        $set: {
          'channels.shopify.last_sync': new Date().toISOString()
        }
      }
    );

    res.json({
      success: true,
      message: 'Products synced successfully',
      data: {
        products: result.products.length,
        collections: result.collections.length,
        variants: result.variants
      }
    });

  } catch (error) {
    console.error('Shopify sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to sync products'
    });
  }
});

// Helper function to sync products
async function syncShopifyProducts(businessId, shop, accessToken) {
  console.log(`📦 Starting product sync for business ${businessId}, shop ${shop}...`);

  const client_instance = shopifyClient(shop, accessToken);

  // Fetch store info
  const storeInfo = await client_instance.getStoreInfo();

  // Fetch collections + products with full data
  const fullCollections = await client_instance.getFullProducts();

  if (!fullCollections.length) {
    console.warn(`⚠️ No collections fetched for ${shop}`);
  }

  // Create flat product array for storage
  const flatProducts = fullCollections.flatMap(c => c.products || []);
  
  // Validate data
  const variantCount = flatProducts.reduce((count, p) => count + (p.variants?.length || 0), 0);
  console.log(`📊 Sync data: ${flatProducts.length} products, ${variantCount} variants, ${fullCollections.length} collections`);

  // Update business with synced data
  await client.connect();
  const businessesCol = client.db().collection('businesses');

  await businessesCol.updateOne(
    { _id: new ObjectId(businessId) },
    {
      $set: {
        products: flatProducts,
        collections: fullCollections,
        // Update business info if not set
        ...((!business || !business.name) && {
          name: storeInfo.name,
          description: storeInfo.about || storeInfo.domain,
          website: storeInfo.domain
        }),
        updatedAt: new Date()
      }
    }
  );

  console.log(`✅ Products synced successfully for business ${businessId}`);

  return {
    products: flatProducts,
    collections: fullCollections,
    variants: variantCount
  };
}

module.exports = router;
