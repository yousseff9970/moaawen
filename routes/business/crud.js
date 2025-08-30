// routes/business/crud.js
const { express, getDb, ObjectId, authMiddleware, requireVerified, planSettings } = require('./shared');
const router = express.Router();

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ message: 'Business route is working!' });
});

// Get user's businesses
router.get('/', authMiddleware, async (req, res) => {
  try {
   const db = await getDb();
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
      // Convert string IDs to ObjectIds for the query
      const businessObjectIds = user.businesses.map(id => {
        try {
          return new ObjectId(id);
        } catch (error) {
          console.log('Invalid ObjectId:', id);
          return null;
        }
      }).filter(id => id !== null);

      if (businessObjectIds.length > 0) {
        businesses = await businessesCol.find({ 
          _id: { $in: businessObjectIds }
        }).toArray();
      }
    }

    // If no businesses found by user association, try finding by userId field
    if (businesses.length === 0) {
      businesses = await businessesCol.find({ 
        userId: new ObjectId(req.user.userId) 
      }).toArray();
    }

    // If still no businesses, try finding by owner email
    if (businesses.length === 0) {
      businesses = await businessesCol.find({ 
        'contact.email': user.email 
      }).toArray();
    }

    // Transform business data to match frontend interface
    const transformedBusinesses = businesses.map(business => {
      return {
        ...business,
        id: business._id.toString(),
        // Ensure status field exists
        status: business.status || 'active',
        // Ensure contact object exists
        contact: business.contact || {},
        // Ensure channels object exists
        channels: business.channels || {},
        // Ensure settings object exists with defaults
        settings: business.settings || {
          currentPlan: business.plan || 'starter',
          maxMessages: business.messagesLimit || 1000,
          usedMessages: business.messagesUsed || 0,
          allowedChannels: 3,
          enabledChannels: {
            languages: 1,
            voiceMinutes: 10,
            usedVoiceMinutes: 0,
            imageAnalysesUsed: 0
          }
        }
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
    
  const db = await getDb();
    const usersCol = db.collection('users');
    const businessesCol = db.collection('businesses');

    // Get user data to check ownership
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('User found:', user.email, 'with businesses:', user.businesses); // Debug log

    let business = null;

    // Try to find the business using the same logic as the main listing
    // First try by direct ID lookup
    business = await businessesCol.findOne({ _id: new ObjectId(req.params.id) });
    
    console.log('Business found:', business ? business.name : 'null'); // Debug log

    if (business) {
      // Verify ownership using the same logic as the main listing
      let isOwner = false;

      // Method 1: Check if business ID is in user's businesses array
      if (user.businesses && user.businesses.includes(req.params.id)) {
        isOwner = true;
      }
      // Method 2: Check if business has userId field matching current user
      else if (business.userId && business.userId.toString() === req.user.userId) {
        isOwner = true;
      }
      // Method 3: Check if business contact email matches user email
      else if (business.contact?.email && business.contact.email === user.email) {
        isOwner = true;
      }

      if (!isOwner) {
        return res.status(403).json({ error: 'Access denied. You do not own this business.' });
      }

      // Transform the business data to match frontend expectations
      business = {
        ...business,
        id: business._id.toString(),
        status: business.status || 'active',
        contact: business.contact || {},
        channels: business.channels || {},
        settings: business.settings || {
          currentPlan: business.plan || 'starter',
          maxMessages: business.messagesLimit || 1000,
          usedMessages: business.messagesUsed || 0,
          allowedChannels: 3,
          enabledChannels: {
            languages: 1,
            voiceMinutes: 10,
            usedVoiceMinutes: 0,
            imageAnalysesUsed: 0
          }
        }
      };
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

// Create a new business - requires verified email
router.post('/', authMiddleware, requireVerified, async (req, res) => {
  try {
    console.log('Creating new business for user:', req.user.userId);
    console.log('Business data:', req.body);

    const { name, description, website, shop, contact } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Business name is required' });
    }

    const db = await getDb();
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
      type: 'retail',
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
      channels: {},
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
      products: [],
      collections: [],
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
// Update business details - requires verified email
router.put('/:id', authMiddleware, requireVerified, async (req, res) => {
  try {
    console.log('Updating business with ID:', req.params.id, 'for user:', req.user.userId); // Debug log
    console.log('Update data:', req.body); // Debug log
    
   const db = await getDb();
    const usersCol = db.collection('users');
    const businessesCol = db.collection('businesses');

    // Get user data to check ownership
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    if (!user) {
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
      isOwner = user.businesses.includes(req.params.id);
    }

    // Method 2: Check if business has userId field matching current user
    if (!isOwner && business.userId) {
      isOwner = business.userId.toString() === req.user.userId;
    }

    // Method 3: Check if business contact email matches user email
    if (!isOwner && business.contact?.email && business.contact.email === user.email) {
      isOwner = true;
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
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (website !== undefined) updateData.website = website.trim();
    if (shop !== undefined) updateData.shop = shop.trim();
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

module.exports = router;
