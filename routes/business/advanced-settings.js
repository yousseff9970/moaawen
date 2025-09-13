// routes/business/advanced-settings.js
const { express, getDb, ObjectId, authMiddleware, requireVerified } = require('./shared');
const router = express.Router();

// Default advanced settings structure
const defaultAdvancedSettings = {
  channels: {
    messenger: true,
    instagram: true,
    website: true,
    whatsapp: true
  },
  subscription: {
    autoRenewal: false
  },
  language: {
    default: 'english'
  },
  features: {
    voicesEnabled: true,
    imagesEnabled: true
  },
  aiPersonality: {
    tone: 'casual'
  },
  conversations: {
    autoClearAfter: '24hours'
  },
  responses: {
    lengthPreference: 'medium'
  }
};

// Validation schemas
const validationRules = {
  channels: {
    messenger: 'boolean',
    instagram: 'boolean', 
    website: 'boolean',
    whatsapp: 'boolean'
  },
  subscription: {
    autoRenewal: 'boolean'
  },
  language: {
    default: ['english', 'arabic']
  },
  features: {
    voicesEnabled: 'boolean',
    imagesEnabled: 'boolean'
  },
  aiPersonality: {
    tone: ['formal', 'casual', 'playful', 'concise']
  },
  conversations: {
    autoClearAfter: ['30mins', '2hours', '8hours', '24hours', '1week']
  },
  responses: {
    lengthPreference: ['short', 'medium', 'long']
  }
};

// Helper function to validate settings
function validateAdvancedSettings(settings) {
  const errors = [];

  for (const [section, sectionRules] of Object.entries(validationRules)) {
    if (settings[section]) {
      for (const [key, rule] of Object.entries(sectionRules)) {
        if (settings[section][key] !== undefined) {
          const value = settings[section][key];
          
          if (rule === 'boolean' && typeof value !== 'boolean') {
            errors.push(`${section}.${key} must be a boolean`);
          } else if (Array.isArray(rule) && !rule.includes(value)) {
            errors.push(`${section}.${key} must be one of: ${rule.join(', ')}`);
          }
        }
      }
    }
  }

  return errors;
}

// Helper function to check business ownership
async function checkBusinessOwnership(businessId, userId, db) {
  const usersCol = db.collection('users');
  const businessesCol = db.collection('businesses');

  // Get user data
  const user = await usersCol.findOne({ _id: new ObjectId(userId) });
  if (!user) {
    throw new Error('User not found');
  }

  // Get business data
  const business = await businessesCol.findOne({ _id: new ObjectId(businessId) });
  if (!business) {
    throw new Error('Business not found');
  }

  // Check ownership using multiple methods
  let isOwner = false;

  // Method 1: Check if business ID is in user's businesses array
  if (user.businesses && user.businesses.includes(businessId)) {
    isOwner = true;
  }
  // Method 2: Check if business has userId field matching current user
  else if (business.userId && business.userId.toString() === userId) {
    isOwner = true;
  }
  // Method 3: Check if business contact email matches user email
  else if (business.contact?.email && business.contact.email === user.email) {
    isOwner = true;
  }

  if (!isOwner) {
    throw new Error('Access denied. You do not own this business.');
  }

  return { user, business };
}

// GET /:businessId/advanced-settings - Get advanced settings for a business
router.get('/:businessId/advanced-settings', authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.params;
    const userId = req.user.userId;

    console.log('Getting advanced settings for business:', businessId, 'user:', userId);

    const db = await getDb();
    const { business } = await checkBusinessOwnership(businessId, userId, db);

    // Get current advanced settings or return defaults
    const currentSettings = business.settings?.advanced || defaultAdvancedSettings;

    // Merge with defaults to ensure all fields are present
    const mergedSettings = {
      channels: { ...defaultAdvancedSettings.channels, ...currentSettings.channels },
      subscription: { ...defaultAdvancedSettings.subscription, ...currentSettings.subscription },
      language: { ...defaultAdvancedSettings.language, ...currentSettings.language },
      features: { ...defaultAdvancedSettings.features, ...currentSettings.features },
      aiPersonality: { ...defaultAdvancedSettings.aiPersonality, ...currentSettings.aiPersonality },
      conversations: { ...defaultAdvancedSettings.conversations, ...currentSettings.conversations },
      responses: { ...defaultAdvancedSettings.responses, ...currentSettings.responses }
    };

    res.json({
      success: true,
      settings: mergedSettings
    });

  } catch (error) {
    console.error('Error getting advanced settings:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }
    if (error.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }
    if (error.message.includes('Access denied')) {
      return res.status(403).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to get advanced settings' });
  }
});

// PUT /:businessId/advanced-settings - Update advanced settings for a business
router.put('/:businessId/advanced-settings', authMiddleware, requireVerified, async (req, res) => {
  try {
    const { businessId } = req.params;
    const userId = req.user.userId;
    const { settings } = req.body;

    console.log('=== ADVANCED SETTINGS UPDATE REQUEST ===');
    console.log('Business ID:', businessId);
    console.log('User ID:', userId);
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Settings:', JSON.stringify(settings, null, 2));

    if (!settings || typeof settings !== 'object') {
      console.log('ERROR: Settings object is required');
      return res.status(400).json({ error: 'Settings object is required' });
    }

    // Validate settings
    const validationErrors = validateAdvancedSettings(settings);
    if (validationErrors.length > 0) {
      return res.status(400).json({ 
        error: 'Invalid settings', 
        details: validationErrors 
      });
    }

    const db = await getDb();
    const { business } = await checkBusinessOwnership(businessId, userId, db);

    // Get current settings and merge with new ones
    const currentAdvancedSettings = business.settings?.advanced || {};
    const updatedAdvancedSettings = {
      channels: { ...currentAdvancedSettings.channels, ...settings.channels },
      subscription: { ...currentAdvancedSettings.subscription, ...settings.subscription },
      language: { ...currentAdvancedSettings.language, ...settings.language },
      features: { ...currentAdvancedSettings.features, ...settings.features },
      aiPersonality: { ...currentAdvancedSettings.aiPersonality, ...settings.aiPersonality },
      conversations: { ...currentAdvancedSettings.conversations, ...settings.conversations },
      responses: { ...currentAdvancedSettings.responses, ...settings.responses }
    };

    // Update the business document
    const businessesCol = db.collection('businesses');
    const updateResult = await businessesCol.updateOne(
      { _id: new ObjectId(businessId) },
      {
        $set: {
          'settings.advanced': updatedAdvancedSettings,
          updatedAt: new Date()
        }
      }
    );

    console.log('Update result:', updateResult);
    console.log('Modified count:', updateResult.modifiedCount);

    if (updateResult.modifiedCount === 0) {
      console.log('ERROR: No documents were modified');
      return res.status(400).json({ error: 'No changes were made to the settings' });
    }

    console.log('Advanced settings updated successfully');

    res.json({
      success: true,
      message: 'Advanced settings updated successfully',
      settings: updatedAdvancedSettings
    });

  } catch (error) {
    console.error('Error updating advanced settings:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }
    if (error.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }
    if (error.message.includes('Access denied')) {
      return res.status(403).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to update advanced settings' });
  }
});

// PATCH /:businessId/advanced-settings - Partial update of advanced settings
router.patch('/:businessId/advanced-settings', authMiddleware, requireVerified, async (req, res) => {
  try {
    const { businessId } = req.params;
    const userId = req.user.userId;
    const updates = req.body;

    console.log('Partially updating advanced settings for business:', businessId);
    console.log('Partial updates:', JSON.stringify(updates, null, 2));

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Updates object is required' });
    }

    const db = await getDb();
    const { business } = await checkBusinessOwnership(businessId, userId, db);

    // Build the update query for nested fields
    const updateQuery = {};
    const currentTime = new Date();

    for (const [section, sectionUpdates] of Object.entries(updates)) {
      if (validationRules[section] && typeof sectionUpdates === 'object') {
        for (const [key, value] of Object.entries(sectionUpdates)) {
          if (validationRules[section][key] !== undefined) {
            // Validate the specific field
            const rule = validationRules[section][key];
            if (rule === 'boolean' && typeof value !== 'boolean') {
              return res.status(400).json({ error: `${section}.${key} must be a boolean` });
            } else if (Array.isArray(rule) && !rule.includes(value)) {
              return res.status(400).json({ error: `${section}.${key} must be one of: ${rule.join(', ')}` });
            }

            updateQuery[`settings.advanced.${section}.${key}`] = value;
          }
        }
      }
    }

    if (Object.keys(updateQuery).length === 0) {
      return res.status(400).json({ error: 'No valid updates provided' });
    }

    updateQuery.updatedAt = currentTime;

    // Update the business document
    const businessesCol = db.collection('businesses');
    const updateResult = await businessesCol.updateOne(
      { _id: new ObjectId(businessId) },
      { $set: updateQuery }
    );

    if (updateResult.modifiedCount === 0) {
      return res.status(400).json({ error: 'No changes were made to the settings' });
    }

    // Get the updated business to return current settings
    const updatedBusiness = await businessesCol.findOne({ _id: new ObjectId(businessId) });
    const updatedSettings = updatedBusiness.settings?.advanced || defaultAdvancedSettings;

    console.log('Advanced settings partially updated successfully');

    res.json({
      success: true,
      message: 'Advanced settings updated successfully',
      settings: updatedSettings,
      updatedFields: Object.keys(updateQuery).filter(key => key !== 'updatedAt')
    });

  } catch (error) {
    console.error('Error partially updating advanced settings:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }
    if (error.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }
    if (error.message.includes('Access denied')) {
      return res.status(403).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to update advanced settings' });
  }
});

// GET /:businessId/advanced-settings/defaults - Get default advanced settings
router.get('/:businessId/advanced-settings/defaults', authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.params;
    const userId = req.user.userId;

    const db = await getDb();
    await checkBusinessOwnership(businessId, userId, db);

    res.json({
      success: true,
      defaults: defaultAdvancedSettings
    });

  } catch (error) {
    console.error('Error getting default advanced settings:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({ error: 'User not found' });
    }
    if (error.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }
    if (error.message.includes('Access denied')) {
      return res.status(403).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to get default advanced settings' });
  }
});

module.exports = router;
