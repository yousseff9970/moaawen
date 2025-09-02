const express = require('express');
const router = express.Router({ mergeParams: true });
const {  ObjectId } = require('mongodb');
const { authMiddleware, requireVerified } = require('../middlewares/authMiddleware');
const getdb = require('../db');



// Validate business ownership
const validateBusinessOwnership = async (businessId, userId) => {

  const db = await getdb();
  const usersCol = db.collection('users');
  const businessesCol = db.collection('businesses');
  
  // Get user data to check ownership
  const user = await usersCol.findOne({ _id: new ObjectId(userId) });
  if (!user) {
    return { valid: false, error: 'User not found' };
  }

  // First find the business
  const business = await businessesCol.findOne({ _id: new ObjectId(businessId) });
  
  if (!business) {
    return { valid: false, error: 'Business not found' };
  }

  // Check if user owns this business using comprehensive logic
  let isOwner = false;

  // Method 1: Check if business ID is in user's businesses array
  if (user.businesses && user.businesses.length > 0) {
    const businessIds = user.businesses.filter(id => {
      try {
        return ObjectId.isValid(id);
      } catch {
        return false;
      }
    }).map(id => id.toString());
    
    if (businessIds.includes(businessId)) {
      isOwner = true;
    }
  }

  // Method 2: Check if business has userId field matching current user
  if (!isOwner && business.userId) {
    if (business.userId.toString() === userId) {
      isOwner = true;
    }
  }

  // Method 3: Check if business contact email matches user email
  if (!isOwner && business.contact?.email && business.contact.email === user.email) {
    isOwner = true;
  }

  if (!isOwner) {
    return { valid: false, error: 'Unauthorized: You do not own this business' };
  }

  return { valid: true, business };
};

// GET /businesses/:businessId/products - Get all products for a business
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.params;
    const { page = 1, limit = 10, search = '', status = '', sort = 'title' } = req.query;
    
    // Validate business ownership
    const validation = await validateBusinessOwnership(businessId, req.user.userId);
    if (!validation.valid) {
      return res.status(validation.error === 'Business not found' ? 404 : 403)
                .json({ error: validation.error });
    }

    // Get products from business document
    const business = validation.business;
    let products = business.products || [];
    
    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      products = products.filter(product => 
        product.title?.toLowerCase().includes(searchLower) ||
        product.vendor?.toLowerCase().includes(searchLower) ||
        product.tags?.toLowerCase().includes(searchLower)
      );
    }
    
    // Apply status filter (map to active for existing products)
    if (status && status !== 'active') {
      products = []; // No draft/archived products in Shopify data
    }

    // Apply sorting
    products.sort((a, b) => {
      const aVal = a[sort] || '';
      const bVal = b[sort] || '';
      return aVal.toString().localeCompare(bVal.toString());
    });

    // Apply pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = products.length;
    const paginatedProducts = products.slice(skip, skip + parseInt(limit));
    
    // Transform products to match expected format
    const transformedProducts = paginatedProducts.map(product => ({
      id: product.id.toString(), // Frontend expects 'id', not '_id'
      _id: product.id.toString(), // Keep _id for backend compatibility
      businessId: new ObjectId(businessId),
      shopifyId: product.id,
      title: product.title,
      description: product.description,
      vendor: product.vendor,
      type: product.type || '',
      tags: product.tags || '',
      images: product.images || [],
      variants: product.variants || [],
      status: 'active', // All Shopify products are active
      created_at: new Date(), // Default date
      updated_at: new Date()
    }));
    
    // Calculate stats from all products
    const totalVariants = products.reduce((sum, p) => sum + (p.variants?.length || 0), 0);
    const lowStockVariants = products.reduce((sum, p) => {
      const lowStock = (p.variants || []).filter(v => v.inventoryQuantity < 10).length;
      return sum + (lowStock > 0 ? 1 : 0);
    }, 0);

    const stats = {
      total: products.length,
      active: products.length, // All are active
      draft: 0,
      archived: 0,
      totalVariants,
      lowStock: lowStockVariants
    };

    res.json({
      success: true,
      products: transformedProducts,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / parseInt(limit)),
        count: total
      },
      stats
    });

  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET /businesses/:businessId/products/:productId - Get single product
router.get('/:productId', authMiddleware, async (req, res) => {
  try {
    const { businessId, productId } = req.params;
    
    // Validate business ownership
    const validation = await validateBusinessOwnership(businessId, req.user.userId);
    if (!validation.valid) {
      return res.status(validation.error === 'Business not found' ? 404 : 403)
                .json({ error: validation.error });
    }

    // Get product from business document
    const business = validation.business;
    const products = business.products || [];
    
    // Find product by Shopify ID (handle both string and number comparison)
    const product = products.find(p => 
      p.id.toString() === productId || 
      p.id === parseInt(productId) ||
      p.id === productId
    );

    console.log('Looking for productId:', productId, 'type:', typeof productId);
    console.log('Available product IDs:', products.map(p => ({ id: p.id, type: typeof p.id })));
    console.log('Found product:', product ? 'YES' : 'NO');

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Transform product to match expected format
    const transformedProduct = {
      id: product.id.toString(), // Frontend expects 'id'
      _id: product.id.toString(),
      businessId: new ObjectId(businessId),
      shopifyId: product.id,
      title: product.title,
      description: product.description,
      vendor: product.vendor,
      type: product.type || '',
      tags: product.tags || '',
      images: product.images || [],
      variants: product.variants || [],
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    };

    res.json({
      success: true,
      product: transformedProduct
    });

  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// POST /businesses/:businessId/products - Create new product
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.params;
    
    // Validate business ownership
    const validation = await validateBusinessOwnership(businessId, req.user.userId);
    if (!validation.valid) {
      return res.status(validation.error === 'Business not found' ? 404 : 403)
                .json({ error: validation.error });
    }

    const db = await getdb();

    
    // Generate a unique ID for the new product
    const newProductId = Date.now(); // Simple timestamp-based ID
    
    const productData = {
      id: newProductId,
      title: req.body.title,
      description: req.body.description || '',
      vendor: req.body.vendor || '',
      type: req.body.type || '',
      tags: req.body.tags || '',
      images: req.body.images || [],
      variants: req.body.variants || []
    };

    // Add product to business document's products array
    const result = db.collection('businesses').updateOne(
      { _id: new ObjectId(businessId) },
      { 
        $push: { products: productData },
        $set: { updatedAt: new Date() }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Transform response to match expected format
    const newProduct = {
      id: newProductId.toString(), // Frontend expects 'id'
      _id: newProductId.toString(),
      businessId: new ObjectId(businessId),
      shopifyId: newProductId,
      ...productData,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    };

    res.status(201).json({
      success: true,
      product: newProduct
    });

  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT /businesses/:businessId/products/:productId - Update product
router.put('/:productId', authMiddleware, async (req, res) => {
  try {
    const { businessId, productId } = req.params;
    
    // Validate business ownership
    const validation = await validateBusinessOwnership(businessId, req.user.userId);
    if (!validation.valid) {
      return res.status(validation.error === 'Business not found' ? 404 : 403)
                .json({ error: validation.error });
    }

   const db = await getdb();
  

    // Prepare update data (exclude id field)
    const updateData = { ...req.body };
    delete updateData._id;
    delete updateData.businessId;
    delete updateData.shopifyId;

    // Update product in business document's products array
    const result =  db.collection('businesses').updateOne(
      { 
        _id: new ObjectId(businessId),
        'products.id': parseInt(productId) // Match by product ID
      },
      { 
        $set: {
          'products.$.title': updateData.title,
          'products.$.description': updateData.description,
          'products.$.vendor': updateData.vendor,
          'products.$.type': updateData.type,
          'products.$.tags': updateData.tags,
          'products.$.images': updateData.images,
          'products.$.variants': updateData.variants,
          updatedAt: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Get updated business to return the updated product
    const updatedBusiness = await db.collection('businesses').findOne({ 
      _id: new ObjectId(businessId) 
    });
    
    const updatedProduct = updatedBusiness.products.find(p => p.id.toString() === productId);
    
    // Transform response
    const transformedProduct = {
      id: updatedProduct.id.toString(), // Frontend expects 'id'
      _id: updatedProduct.id.toString(),
      businessId: new ObjectId(businessId),
      shopifyId: updatedProduct.id,
      ...updatedProduct,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    };
    
    res.json({
      success: true,
      product: transformedProduct
    });

  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE /businesses/:businessId/products/:productId - Delete product
router.delete('/:productId', authMiddleware, async (req, res) => {
  try {
    const { businessId, productId } = req.params;
    
    // Validate business ownership
    const validation = await validateBusinessOwnership(businessId, req.user.userId);
    if (!validation.valid) {
      return res.status(validation.error === 'Business not found' ? 404 : 403)
                .json({ error: validation.error });
    }

    const db = await getdb();

    // Remove product from business document's products array
    const result =  db.collection('businesses').updateOne(
      { _id: new ObjectId(businessId) },
      { 
        $pull: { products: { id: parseInt(productId) } },
        $set: { updatedAt: new Date() }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (result.modifiedCount === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ message: 'Product deleted successfully' });

  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// PATCH /businesses/:businessId/products/:productId/status - Update product status
router.patch('/:productId/status', authMiddleware, async (req, res) => {
  try {
    const { businessId, productId } = req.params;
    const { status } = req.body;
    
    if (!['active', 'draft', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    // Validate business ownership
    const validation = await validateBusinessOwnership(businessId, req.user.userId);
    if (!validation.valid) {
      return res.status(validation.error === 'Business not found' ? 404 : 403)
                .json({ error: validation.error });
    }

    // Note: For products stored in business document, we'll just return success
    // as Shopify products don't have separate status field
    res.json({ 
      message: 'Status update successful',
      status: 'active' // All Shopify products are considered active
    });

  } catch (error) {
    console.error('Error updating product status:', error);
    res.status(500).json({ error: 'Failed to update product status' });
  }
});

module.exports = router;
