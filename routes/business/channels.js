// routes/business/channels.js
const { express, MongoClient, ObjectId, authMiddleware, client } = require('./shared');
const router = express.Router();

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

    // Check if domain is already connected to another business
    const existingBusiness = await businessesCol.findOne({
      'channels.website.domain': cleanDomain,
      _id: { $ne: new ObjectId(req.params.id) }
    });

    if (existingBusiness) {
      return res.status(400).json({ 
        error: `Domain "${cleanDomain}" is already connected to another business. Each domain can only be connected to one business.` 
      });
    }

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

    // Note: Facebook accounts can be shared across multiple businesses
    // as they serve as the parent account for Instagram and Messenger

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
    
    const { instagram_account_id, username, access_token, connection_type, facebook_page_id } = req.body;
    
    if (!instagram_account_id || !username || !access_token) {
      return res.status(400).json({ error: 'Instagram account ID, username, and access token are required' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const usersCol = db.collection('users');

    // Check if Instagram account is already connected to another business
    const existingBusiness = await businessesCol.findOne({
      'channels.instagram.account_id': instagram_account_id.trim(),
      _id: { $ne: new ObjectId(req.params.id) }
    });

    if (existingBusiness) {
      return res.status(400).json({ 
        error: `Instagram account "${username}" is already connected to another business. Each Instagram account can only be connected to one business.` 
      });
    }

    // Verify business ownership
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

    // Prepare Instagram channel data
    const instagramData = {
      account_id: instagram_account_id.trim(),
      username: username.trim(),
      access_token: access_token.trim(),
      connection_type: connection_type || 'facebook_business',
      connected_at: new Date().toISOString(),
      connected: true
    };

    // Add Facebook page info if provided (for Facebook Business connections)
    if (facebook_page_id) {
      instagramData.facebook_page_id = facebook_page_id.trim();
    }

    // Update the business with Instagram channel
    const result = await businessesCol.updateOne(
      { _id: new ObjectId(req.params.id) },
      { 
        $set: { 
          'channels.instagram': instagramData,
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: 'Failed to update Instagram channel' });
    }

    console.log('Instagram channel connected successfully:', instagramData);

    res.json({
      success: true,
      message: 'Instagram channel connected successfully',
      instagram_account_id: instagram_account_id.trim(),
      username: username.trim()
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

    // Check if Messenger page is already connected to another business
    const existingBusiness = await businessesCol.findOne({
      'channels.messenger.page_id': page_id.trim(),
      _id: { $ne: new ObjectId(req.params.id) }
    });

    if (existingBusiness) {
      return res.status(400).json({ 
        error: `Messenger page is already connected to another business. Each Messenger page can only be connected to one business.` 
      });
    }

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

// Connect/Update WhatsApp channel
router.put('/:id/channels/whatsapp', authMiddleware, async (req, res) => {
  try {
    console.log('Connecting WhatsApp channel for business:', req.params.id, 'by user:', req.user.userId);
    
    const { phone_number_id, phone_number, access_token } = req.body;
    
    if (!phone_number_id || !phone_number || !access_token) {
      return res.status(400).json({ error: 'WhatsApp phone_number_id, phone_number, and access_token are required' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessesCol = db.collection('businesses');
    const usersCol = db.collection('users');

    // Check if WhatsApp phone number is already connected to another business
    const existingBusiness = await businessesCol.findOne({
      'channels.whatsapp.phone_number_id': phone_number_id.trim(),
      _id: { $ne: new ObjectId(req.params.id) }
    });

    if (existingBusiness) {
      return res.status(400).json({ 
        error: `WhatsApp number "${phone_number}" is already connected to another business. Each WhatsApp number can only be connected to one business.` 
      });
    }

    // Verify business ownership
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

    // Update the business with WhatsApp channel
    const result = await businessesCol.updateOne(
      { _id: new ObjectId(req.params.id) },
      { 
        $set: { 
          'channels.whatsapp': { 
            phone_number_id: phone_number_id.trim(),
            phone_number: phone_number.trim(),
            access_token: access_token.trim()
          },
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: 'Failed to update WhatsApp channel' });
    }

    console.log('WhatsApp channel connected successfully');

    res.json({
      success: true,
      message: 'WhatsApp channel connected successfully',
      phone_number_id: phone_number_id.trim(),
      phone_number: phone_number.trim()
    });

  } catch (error) {
    console.error('Error connecting WhatsApp channel:', error);
    res.status(500).json({ error: 'Failed to connect WhatsApp channel' });
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

    // Check if TikTok account is already connected to another business
    const existingBusiness = await businessesCol.findOne({
      'channels.tiktok.account_id': cleanAccountId,
      _id: { $ne: new ObjectId(req.params.id) }
    });

    if (existingBusiness) {
      return res.status(400).json({ 
        error: `TikTok account "${cleanAccountId}" is already connected to another business. Each TikTok account can only be connected to one business.` 
      });
    }

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

module.exports = router;
