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
      } else if (business.channels?.website?.domain) {
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

// Channel Management Routes

// Connect/Update website channel
router.put('/:id/channels/website', authMiddleware, async (req, res) => {
  try {
    console.log('Connecting website channel for business:', req.params.id, 'by user:', req.user.userId);
    
    const { domain } = req.body;
    
    if (!domain || !domain.trim()) {
      return res.status(400).json({ error: 'Domain is required' });
    }

    // Clean and validate domain format
    const cleanDomain = domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, ''); // Remove port numbers
    
    // More strict domain validation
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.([a-zA-Z]{2,}(\.[a-zA-Z]{2,})?)$/;
    
    if (!domainRegex.test(cleanDomain) || 
        cleanDomain.length > 253 || 
        cleanDomain.includes('..') ||
        cleanDomain.startsWith('.') || 
        cleanDomain.endsWith('.')) {
      return res.status(400).json({ error: 'Invalid domain format. Use format like: luxbelcare.com (no https, www, paths, or subdomains)' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const usersCol = db.collection('users');

    // Verify business ownership (reuse existing logic)
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const business = await businessesCol.findOne({ _id: new ObjectId(req.params.id) });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Check ownership
    let isOwner = false;
    if (user.businesses && user.businesses.includes(req.params.id)) {
      isOwner = true;
    } else if (business.userId && business.userId.toString() === req.user.userId) {
      isOwner = true;
    } else if (business.contact?.email && business.contact.email === user.email) {
      isOwner = true;
    }

    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied. You do not own this business.' });
    }

    // Update the business with website channel
    const result = await businessesCol.updateOne(
      { _id: new ObjectId(req.params.id) },
      { 
        $set: { 
          'channels.website': { domain: cleanDomain },
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: 'Failed to update website channel' });
    }

    console.log('Website channel connected successfully');

    res.json({
      success: true,
      message: 'Website channel connected successfully',
      domain: cleanDomain
    });

  } catch (error) {
    console.error('Error connecting website channel:', error);
    res.status(500).json({ error: 'Failed to connect website channel' });
  }
});

// Connect/Update Facebook account
router.put('/:id/channels/facebook', authMiddleware, async (req, res) => {
  try {
    console.log('Connecting Facebook account for business:', req.params.id, 'by user:', req.user.userId);
    
    const { account_id, access_token, user_id } = req.body;
    
    if (!account_id || !access_token || !user_id) {
      return res.status(400).json({ error: 'Facebook account_id, access_token, and user_id are required' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const usersCol = db.collection('users');

    // Verify business ownership (reuse existing logic)
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const business = await businessesCol.findOne({ _id: new ObjectId(req.params.id) });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Check ownership
    let isOwner = false;
    if (user.businesses && user.businesses.includes(req.params.id)) {
      isOwner = true;
    } else if (business.userId && business.userId.toString() === req.user.userId) {
      isOwner = true;
    } else if (business.contact?.email && business.contact.email === user.email) {
      isOwner = true;
    }

    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied. You do not own this business.' });
    }

    // Update the business with Facebook account
    const result = await businessesCol.updateOne(
      { _id: new ObjectId(req.params.id) },
      { 
        $set: { 
          'channels.facebook': { 
            account_id: account_id.trim(),
            access_token: access_token.trim(),
            user_id: user_id.trim()
          },
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: 'Failed to update Facebook account' });
    }

    console.log('Facebook account connected successfully');

    res.json({
      success: true,
      message: 'Facebook account connected successfully',
      account_id: account_id.trim()
    });

  } catch (error) {
    console.error('Error connecting Facebook account:', error);
    res.status(500).json({ error: 'Failed to connect Facebook account' });
  }
});

// Connect/Update Instagram channel
router.put('/:id/channels/instagram', authMiddleware, async (req, res) => {
  try {
    console.log('Connecting Instagram channel for business:', req.params.id, 'by user:', req.user.userId);
    
    const { page_id, access_token } = req.body;
    
    if (!page_id || !access_token) {
      return res.status(400).json({ error: 'Instagram page_id and access_token are required' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const usersCol = db.collection('users');

    // Verify business ownership
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const business = await businessesCol.findOne({ _id: new ObjectId(req.params.id) });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Check if Facebook account is connected first
    if (!business.channels?.facebook?.access_token) {
      return res.status(400).json({ error: 'Facebook account must be connected first' });
    }

    // Check ownership
    let isOwner = false;
    if (user.businesses && user.businesses.includes(req.params.id)) {
      isOwner = true;
    } else if (business.userId && business.userId.toString() === req.user.userId) {
      isOwner = true;
    } else if (business.contact?.email && business.contact.email === user.email) {
      isOwner = true;
    }

    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied. You do not own this business.' });
    }

    // Update the business with Instagram channel
    const result = await businessesCol.updateOne(
      { _id: new ObjectId(req.params.id) },
      { 
        $set: { 
          'channels.instagram': { 
            page_id: page_id.trim(),
            access_token: access_token.trim()
          },
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: 'Failed to update Instagram channel' });
    }

    console.log('Instagram channel connected successfully');

    res.json({
      success: true,
      message: 'Instagram channel connected successfully',
      page_id: page_id.trim()
    });

  } catch (error) {
    console.error('Error connecting Instagram channel:', error);
    res.status(500).json({ error: 'Failed to connect Instagram channel' });
  }
});

// Connect/Update Messenger channel
router.put('/:id/channels/messenger', authMiddleware, async (req, res) => {
  try {
    console.log('Connecting Messenger channel for business:', req.params.id, 'by user:', req.user.userId);
    
    const { page_id, access_token } = req.body;
    
    if (!page_id || !access_token) {
      return res.status(400).json({ error: 'Messenger page_id and access_token are required' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const usersCol = db.collection('users');

    // Verify business ownership
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const business = await businessesCol.findOne({ _id: new ObjectId(req.params.id) });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Check if Facebook account is connected first
    if (!business.channels?.facebook?.access_token) {
      return res.status(400).json({ error: 'Facebook account must be connected first' });
    }

    // Check ownership
    let isOwner = false;
    if (user.businesses && user.businesses.includes(req.params.id)) {
      isOwner = true;
    } else if (business.userId && business.userId.toString() === req.user.userId) {
      isOwner = true;
    } else if (business.contact?.email && business.contact.email === user.email) {
      isOwner = true;
    }

    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied. You do not own this business.' });
    }

    // Update the business with Messenger channel
    const result = await businessesCol.updateOne(
      { _id: new ObjectId(req.params.id) },
      { 
        $set: { 
          'channels.messenger': { 
            page_id: page_id.trim(),
            access_token: access_token.trim()
          },
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: 'Failed to update Messenger channel' });
    }

    console.log('Messenger channel connected successfully');

    res.json({
      success: true,
      message: 'Messenger channel connected successfully',
      page_id: page_id.trim()
    });

  } catch (error) {
    console.error('Error connecting Messenger channel:', error);
    res.status(500).json({ error: 'Failed to connect Messenger channel' });
  }
});

// Connect/Update TikTok channel
router.put('/:id/channels/tiktok', authMiddleware, async (req, res) => {
  try {
    console.log('Connecting TikTok channel for business:', req.params.id, 'by user:', req.user.userId);
    
    const { account_id } = req.body;
    
    if (!account_id || !account_id.trim()) {
      return res.status(400).json({ error: 'TikTok Account ID is required' });
    }

    const cleanAccountId = account_id.trim();
    
    // Basic validation for TikTok Account ID (can be username or numeric ID)
    if (cleanAccountId.length < 2) {
      return res.status(400).json({ error: 'Invalid TikTok Account ID format.' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const usersCol = db.collection('users');

    // Verify business ownership (reuse existing logic)
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const business = await businessesCol.findOne({ _id: new ObjectId(req.params.id) });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Check ownership
    let isOwner = false;
    if (user.businesses && user.businesses.includes(req.params.id)) {
      isOwner = true;
    } else if (business.userId && business.userId.toString() === req.user.userId) {
      isOwner = true;
    } else if (business.contact?.email && business.contact.email === user.email) {
      isOwner = true;
    }

    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied. You do not own this business.' });
    }

    // Update the business with TikTok channel
    const result = await businessesCol.updateOne(
      { _id: new ObjectId(req.params.id) },
      { 
        $set: { 
          'channels.tiktok': { account_id: cleanAccountId },
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: 'Failed to update TikTok channel' });
    }

    console.log('TikTok channel connected successfully');

    res.json({
      success: true,
      message: 'TikTok channel connected successfully',
      account_id: cleanAccountId
    });

  } catch (error) {
    console.error('Error connecting TikTok channel:', error);
    res.status(500).json({ error: 'Failed to connect TikTok channel' });
  }
});

// Disconnect channel
router.delete('/:id/channels/:channelType', authMiddleware, async (req, res) => {
  try {
    console.log('Disconnecting channel:', req.params.channelType, 'for business:', req.params.id, 'by user:', req.user.userId);
    
    const { channelType } = req.params;
    const allowedChannels = ['whatsapp', 'instagram', 'website', 'facebook', 'messenger', 'tiktok'];
    
    if (!allowedChannels.includes(channelType)) {
      return res.status(400).json({ error: 'Invalid channel type' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const usersCol = db.collection('users');

    // Verify business ownership (reuse existing logic)
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const business = await businessesCol.findOne({ _id: new ObjectId(req.params.id) });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Check ownership
    let isOwner = false;
    if (user.businesses && user.businesses.includes(req.params.id)) {
      isOwner = true;
    } else if (business.userId && business.userId.toString() === req.user.userId) {
      isOwner = true;
    } else if (business.contact?.email && business.contact.email === user.email) {
      isOwner = true;
    }

    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied. You do not own this business.' });
    }

    // Remove the channel
    const updateData = {
      updatedAt: new Date()
    };
    
    const unsetData = {};
    unsetData[`channels.${channelType}`] = "";

    const result = await businessesCol.updateOne(
      { _id: new ObjectId(req.params.id) },
      { 
        $set: updateData,
        $unset: unsetData
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: 'Failed to disconnect channel' });
    }

    console.log(`${channelType} channel disconnected successfully`);

    res.json({
      success: true,
      message: `${channelType.charAt(0).toUpperCase() + channelType.slice(1)} channel disconnected successfully`
    });

  } catch (error) {
    console.error('Error disconnecting channel:', error);
    res.status(500).json({ error: 'Failed to disconnect channel' });
  }
});

// Mount products routes
const productsRouter = require('./products');
router.use('/:businessId/products', productsRouter);

module.exports = router;
