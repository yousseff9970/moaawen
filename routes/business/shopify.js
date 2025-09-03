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
    const result = await syncShopifyProducts(businessId, shop_domain, access_token, business);

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
        total_products: result.products.length,
        shopify_products: result.shopify_products_updated,
        manual_products_preserved: result.preserved_manual_products,
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
async function syncShopifyProducts(businessId, shop, accessToken, business) {
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
  const shopifyProducts = fullCollections.flatMap(c => c.products || []);
  
  // Get existing products from business
  const existingProducts = business.products || [];
  
  // Separate manually created products from Shopify products using multiple criteria
  const manualProducts = existingProducts.filter(product => {
    // Check if explicitly marked as manual
    if (product.created_manually === true || product.source === 'manual') {
      return true;
    }
    
    // Legacy check: products without shopify_id and with timestamp-like IDs are likely manual
    // Shopify IDs are typically large numbers (> 10^12), manual IDs are timestamps (around 10^12-10^13)
    if (!product.shopify_id && product.id && typeof product.id === 'number') {
      const idStr = product.id.toString();
      // If ID looks like a timestamp (13 digits starting with 1 or 2) and no shopify markers
      if (idStr.length === 13 && (idStr.startsWith('1') || idStr.startsWith('2'))) {
        return true;
      }
    }
    
    return false;
  });
  
  const existingShopifyProducts = existingProducts.filter(product => {
    // Explicitly marked as Shopify
    if (product.source === 'shopify' || product.shopify_id) {
      return true;
    }
    
    // Not marked as manual and has characteristics of Shopify products
    if (product.created_manually !== true && product.source !== 'manual') {
      // If it has typical Shopify fields or large ID numbers
      if (product.handle || product.vendor || (product.id && product.id > 1000000000000)) {
        return true;
      }
    }
    
    return false;
  });
  
  console.log(`📊 Product separation: ${manualProducts.length} manual products, ${existingShopifyProducts.length} Shopify products`);
  
  // One-time migration: Update manual products to have proper flags if they don't already
  const migratedManualProducts = manualProducts.map(product => {
    if (!product.created_manually && product.source !== 'manual') {
      console.log(`🔄 Migrating manual product: ${product.name || product.title || product.id}`);
      return {
        ...product,
        created_manually: true,
        source: 'manual',
        updated_at: new Date()
      };
    }
    return product;
  });
  
  // Create a map of existing Shopify products for quick lookup
  const existingShopifyMap = new Map();
  existingShopifyProducts.forEach(product => {
    const shopifyId = product.shopify_id || product.id;
    if (shopifyId) {
      existingShopifyMap.set(shopifyId.toString(), product);
    }
  });
  
  // Process Shopify products: update existing or add new
  const updatedShopifyProducts = shopifyProducts.map(shopifyProduct => {
    const shopifyId = shopifyProduct.id || shopifyProduct.shopify_id;
    const existing = existingShopifyMap.get(shopifyId?.toString());
    
    if (existing) {
      // Update existing Shopify product while preserving manual modifications
      return {
        ...existing,
        ...shopifyProduct,
        // Preserve any manual fields that shouldn't be overridden
        _id: existing._id, // Keep original MongoDB ID
        created_manually: existing.created_manually || false,
        last_synced: new Date().toISOString(),
        source: 'shopify'
      };
    } else {
      // Add new Shopify product
      return {
        ...shopifyProduct,
        created_manually: false,
        last_synced: new Date().toISOString(),
        source: 'shopify'
      };
    }
  });
  
  // Combine migrated manual products with updated/new Shopify products
  const finalProducts = [
    ...migratedManualProducts, // Keep all manually created products (with proper flags)
    ...updatedShopifyProducts // Add updated/new Shopify products
  ];
  
  // Similarly handle collections - preserve manual collections
  const existingCollections = business.collections || [];
  const manualCollections = existingCollections.filter(collection => !collection.shopify_id && !collection.id);
  
  // Update collections with source tracking
  const updatedCollections = fullCollections.map(collection => ({
    ...collection,
    source: 'shopify',
    last_synced: new Date().toISOString()
  }));
  
  const finalCollections = [
    ...manualCollections,
    ...updatedCollections
  ];
  
  // Validate data
  const variantCount = updatedShopifyProducts.reduce((count, p) => count + (p.variants?.length || 0), 0);
  console.log(`📊 Sync data: ${finalProducts.length} total products (${migratedManualProducts.length} manual + ${updatedShopifyProducts.length} Shopify), ${variantCount} variants, ${finalCollections.length} collections`);

  // Update business with synced data
  await client.connect();
  const businessesCol = client.db().collection('businesses');

  await businessesCol.updateOne(
    { _id: new ObjectId(businessId) },
    {
      $set: {
        products: finalProducts,
        collections: finalCollections,
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

  console.log(`✅ Products synced successfully for business ${businessId}. Preserved ${migratedManualProducts.length} manual products, updated/added ${updatedShopifyProducts.length} Shopify products`);

  return {
    products: finalProducts,
    collections: finalCollections,
    variants: variantCount,
    preserved_manual_products: migratedManualProducts.length,
    shopify_products_updated: updatedShopifyProducts.length
  };
}

module.exports = router;
