const express = require('express');
const router = express.Router();
const { MongoClient, ObjectId } = require('mongodb');
const authMiddleware = require('../middlewares/authMiddleware');

const client = new MongoClient(process.env.MONGO_URI);

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ message: 'Business route is working!' });
});

// Get user's businesses
router.get('/', authMiddleware, async (req, res) => {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');
    const businessesCol = db.collection('businesses');

    // Get user data to check their associated businesses
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let businesses = [];

    // Check if user has businesses array with IDs
    if (user.businesses && user.businesses.length > 0) {
      // Try to get businesses by IDs if they are ObjectIds
      const businessIds = user.businesses.filter(id => {
        try {
          return ObjectId.isValid(id);
        } catch {
          return false;
        }
      }).map(id => new ObjectId(id));

      if (businessIds.length > 0) {
        businesses = await businessesCol.find({ _id: { $in: businessIds } }).toArray();
      }
    }

    // If no businesses found by user association, try finding by userId field
    if (businesses.length === 0) {
      businesses = await businessesCol.find({ userId: new ObjectId(req.user.userId) }).toArray();
    }

    // If still no businesses, try finding by owner email
    if (businesses.length === 0) {
      businesses = await businessesCol.find({ 'contact.email': user.email }).toArray();
    }

    // Transform business data to match frontend interface
    const transformedBusinesses = businesses.map(business => {
      // Determine business type based on available data
      let type = 'widget'; // default
      if (business.shop && business.accessToken) {
        type = 'shopify'; // Has Shopify integration
      } else if (business.channels?.whatsapp?.phone_number_id) {
        type = 'whatsapp';
      } else if (business.channels?.instagram?.page_id) {
        type = 'instagram';
      } else if (business.channels?.messenger?.page_id) {
        type = 'page';
      } else if (business.website) {
        type = 'widget'; // Website widget
      }

      // Extract real usage data from settings
      const settings = business.settings || {};
      const messagesUsed = settings.usedMessages || 0;
      const messagesLimit = settings.maxMessages || 50000;
      
      // Extract real plan from settings
      const plan = settings.currentPlan || 'starter';
      
      // Extract real subscription expiry date
      let subscriptionEndDate = null;
      if (business.expiresAt) {
        subscriptionEndDate = business.expiresAt;
      } else if (settings.subscriptionEndDate) {
        subscriptionEndDate = settings.subscriptionEndDate;
      }

      return {
        id: business._id.toString(),
        name: business.name || 'Unnamed Business',
        type: type,
        plan: plan,
        messagesUsed: messagesUsed,
        messagesLimit: messagesLimit,
        subscriptionEndDate: subscriptionEndDate,
        status: business.status || 'active',
        createdAt: business.createdAt || new Date(),
        description: business.description,
        website: business.website,
        shop: business.shop,
        contact: business.contact || {},
        channels: business.channels || {},
        settings: settings
      };
    });

    res.json({
      success: true,
      businesses: transformedBusinesses
    });

  } catch (error) {
    console.error('Error fetching businesses:', error);
    res.status(500).json({ error: 'Failed to fetch businesses' });
  }
});

// Get single business details
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');

    const business = await businessesCol.findOne({ 
      _id: new ObjectId(req.params.id),
      userId: new ObjectId(req.user.userId) // Ensure user owns this business
    });

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    res.json({
      success: true,
      business: business
    });

  } catch (error) {
    console.error('Error fetching business:', error);
    res.status(500).json({ error: 'Failed to fetch business' });
  }
});

module.exports = router;
