const express = require('express');
const router = express.Router();
const { MongoClient, ObjectId } = require('mongodb');
const authMiddleware = require('../middlewares/authMiddleware');
const planSettings = require('../utils/PlanSettings');

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
    console.log('Getting business with ID:', req.params.id, 'for user:', req.user.userId); // Debug log
    
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');
    const businessesCol = db.collection('businesses');

    // Get user data to check ownership
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    if (!user) {
      console.log('User not found:', req.user.userId); // Debug log
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('User found:', user.email, 'with businesses:', user.businesses); // Debug log

    let business = null;

    // Try to find the business using the same logic as the main listing
    // First try by direct ID lookup
    business = await businessesCol.findOne({ _id: new ObjectId(req.params.id) });
    
    console.log('Business found:', business ? business.name : 'null'); // Debug log

    if (business) {
      // Check if user owns this business using multiple methods
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
        
        console.log('Checking business IDs in user array:', businessIds, 'against:', req.params.id); // Debug log
        
        if (businessIds.includes(req.params.id)) {
          isOwner = true;
          console.log('Owner found via user businesses array'); // Debug log
        }
      }

      // Method 2: Check if business has userId field matching current user
      if (!isOwner && business.userId) {
        console.log('Checking business userId:', business.userId.toString(), 'against user:', req.user.userId); // Debug log
        if (business.userId.toString() === req.user.userId) {
          isOwner = true;
          console.log('Owner found via business userId field'); // Debug log
        }
      }

      // Method 3: Check if business contact email matches user email
      if (!isOwner && business.contact?.email && business.contact.email === user.email) {
        isOwner = true;
        console.log('Owner found via contact email match'); // Debug log
      }

      console.log('Final ownership check result:', isOwner); // Debug log

      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied. You do not own this business.' });
      }
    } else {
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

// Create a new business
router.post('/', authMiddleware, async (req, res) => {
  try {
    console.log('Creating new business for user:', req.user.userId);
    console.log('Business data:', req.body);

    const { name, description, website, shop, contact } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Business name is required.' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const usersCol = db.collection('users');

    // Get growth plan settings as default
    const growthPlan = planSettings.growth;
    const currentDate = new Date();
    const subscriptionEndDate = new Date(currentDate.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days from now

    // Create new business with growth plan as default
    const newBusiness = {
      userId: new ObjectId(req.user.userId),
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

    console.log('Business created successfully with ID:', result.insertedId);

    // Add the business ID to the user's businesses array
    await usersCol.updateOne(
      { _id: new ObjectId(req.user.userId) },
      { 
        $addToSet: { businesses: result.insertedId.toString() },
        $set: { updatedAt: currentDate }
      }
    );

    console.log('Business ID added to user businesses array');

    return res.status(201).json({
      success: true,
      message: 'Business created successfully',
      business: {
        ...newBusiness,
        _id: result.insertedId,
        id: result.insertedId.toString()
      }
    });

  } catch (error) {
    console.error('Create business error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Update business details
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    console.log('Updating business with ID:', req.params.id, 'for user:', req.user.userId); // Debug log
    console.log('Update data:', req.body); // Debug log
    
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');
    const businessesCol = db.collection('businesses');

    // Get user data to check ownership
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    if (!user) {
      console.log('User not found:', req.user.userId); // Debug log
      return res.status(404).json({ error: 'User not found' });
    }

    // First find the business and verify ownership
    let business = await businessesCol.findOne({ _id: new ObjectId(req.params.id) });
    
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Check if user owns this business using the same logic as GET
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
      
      if (businessIds.includes(req.params.id)) {
        isOwner = true;
        console.log('Owner verified via user businesses array'); // Debug log
      }
    }

    // Method 2: Check if business has userId field matching current user
    if (!isOwner && business.userId) {
      if (business.userId.toString() === req.user.userId) {
        isOwner = true;
        console.log('Owner verified via business userId field'); // Debug log
      }
    }

    // Method 3: Check if business contact email matches user email
    if (!isOwner && business.contact?.email && business.contact.email === user.email) {
      isOwner = true;
      console.log('Owner verified via contact email match'); // Debug log
    }

    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied. You do not own this business.' });
    }

    // Prepare update data
    const { name, description, website, shop, contact } = req.body;
    const updateData = {
      updatedAt: new Date()
    };

    // Only update fields that are provided
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (website !== undefined) updateData.website = website;
    if (shop !== undefined) updateData.shop = shop;
    if (contact !== undefined) updateData.contact = contact;

    console.log('Final update data:', updateData); // Debug log

    // Update the business
    const result = await businessesCol.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updateData }
    );

    if (result.modifiedCount === 0) {
      console.log('No documents were modified'); // Debug log
      return res.status(400).json({ error: 'No changes were made' });
    }

    console.log('Business updated successfully'); // Debug log

    res.json({
      success: true,
      message: 'Business updated successfully'
    });

  } catch (error) {
    console.error('Error updating business:', error);
    res.status(500).json({ error: 'Failed to update business' });
  }
});

// Mount products routes
const productsRouter = require('./products');
router.use('/:businessId/products', productsRouter);

module.exports = router;
