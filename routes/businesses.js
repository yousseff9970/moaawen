const express = require('express');
const router = express.Router();
const { ObjectId } = require('bson');
const getDb = require('../db');
const jwt = require('jsonwebtoken');
const planSettings = require('../utils/PlanSettings');

const JWT_SECRET = process.env.JWT_SECRET || 'moaawen-secret-key';

// Create a new business
router.post('/businesses', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    const { name, description, website, shop, contact } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Business name is required.' });
    }

    const db = await getDb();
    const businessesCol = db.collection('businesses');

    // Get growth plan settings as default
    const growthPlan = planSettings.growth;
    const currentDate = new Date();
    const subscriptionEndDate = new Date(currentDate.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days from now

    // Create new business with growth plan as default
    const newBusiness = {
      userId: decoded.userId,
      name: name.trim(),
      description: description?.trim() || '',
      website: website?.trim() || '',
      shop: shop?.trim() || '',
      status: 'active',
      type: 'retail', // Default type
      plan: 'growth',
      messagesUsed: 0,
      messagesLimit: growthPlan.maxMessages,
      subscriptionEndDate: subscriptionEndDate.toISOString(),
      contact: {
        email: contact?.email?.trim() || '',
        phone: contact?.phone?.trim() || '',
        whatsapp: contact?.whatsapp?.trim() || '',
        instagram: contact?.instagram?.trim() || ''
      },
      channels: {}, // Empty channels - will be added later in edit
      settings: {
        currentPlan: 'growth',
        maxMessages: growthPlan.maxMessages,
        usedMessages: 0,
        allowedChannels: growthPlan.allowedChannels,
        enabledChannels: {
          languages: growthPlan.languages,
          voiceMinutes: growthPlan.voiceMinutes,
          usedVoiceMinutes: 0,
          imageAnalysesUsed: 0
        }
      },
      products: [], // Empty products array - will be added later in edit
      collections: [], // Empty collections array
      createdAt: currentDate,
      updatedAt: currentDate,
      expiresAt: subscriptionEndDate
    };

    const result = await businessesCol.insertOne(newBusiness);

    return res.status(201).json({
      success: true,
      message: 'Business created successfully',
      business: {
        ...newBusiness,
        _id: result.insertedId,
        id: result.insertedId.toString()
      }
    });

  } catch (err) {
    console.error('Create business error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Get all businesses for a user
router.get('/businesses', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    const db = await getDb();
    const businessesCol = db.collection('businesses');

    // Find all businesses that belong to this user
    const businesses = await businessesCol.find({ 
      userId: decoded.userId 
    }).toArray();

    return res.json({
      success: true,
      businesses: businesses
    });

  } catch (err) {
    console.error('Get businesses error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Get a specific business by ID
router.get('/businesses/:businessId', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    const db = await getDb();
    const businessesCol = db.collection('businesses');

    const business = await businessesCol.findOne({ 
      _id: new ObjectId(req.params.businessId),
      userId: decoded.userId 
    });

    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found.' });
    }

    return res.json({
      success: true,
      business: business
    });

  } catch (err) {
    console.error('Get business error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Update a business
router.put('/businesses/:businessId', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    const { name, description, website, shop, contact } = req.body;

    const db = await getDb();
    const businessesCol = db.collection('businesses');

    // Check if business exists and belongs to user
    const existingBusiness = await businessesCol.findOne({ 
      _id: new ObjectId(req.params.businessId),
      userId: decoded.userId 
    });

    if (!existingBusiness) {
      return res.status(404).json({ success: false, message: 'Business not found.' });
    }

    // Update business
    const updateData = {
      ...(name && { name }),
      ...(description && { description }),
      ...(website && { website }),
      ...(shop && { shop }),
      ...(contact && { contact }),
      updatedAt: new Date()
    };

    await businessesCol.updateOne(
      { _id: new ObjectId(req.params.businessId) },
      { $set: updateData }
    );

    return res.json({
      success: true,
      message: 'Business updated successfully'
    });

  } catch (err) {
    console.error('Update business error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
