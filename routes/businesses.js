const express = require('express');
const router = express.Router();
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');

const client = new MongoClient(process.env.MONGO_URI);
const JWT_SECRET = process.env.JWT_SECRET || 'moaawen-secret-key';

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

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
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

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
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

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
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
