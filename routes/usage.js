// routes/usage.js
const express = require('express');
const router = express.Router();
const getDb = require('../db');
const { ObjectId } = require('mongodb');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { getUsageSummary, checkAccess } = require('../utils/businessPolicy');

/**
 * GET /api/usage
 * Get comprehensive usage data for all user's businesses
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const usersCol = db.collection('users');
    const businessesCol = db.collection('businesses');

    // Get user data
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get all businesses for the user
    const businesses = await businessesCol.find({
      _id: { $in: user.businesses?.map(id => new ObjectId(id)) || [] }
    }).toArray();

    // Generate usage summaries for each business
    const usageData = businesses.map(business => {
      const summary = getUsageSummary(business);
      
      return {
        id: business._id.toString(),
        name: business.name,
        type: business.type || 'unknown',
        status: business.status || 'active',
        createdAt: business.createdAt,
        summary
      };
    });

    // Calculate aggregated stats
    const aggregated = {
      totalBusinesses: businesses.length,
      activeBusinesses: usageData.filter(b => b.summary.status.active && !b.summary.status.expired).length,
      expiredBusinesses: usageData.filter(b => b.summary.status.expired).length,
      suspendedBusinesses: usageData.filter(b => b.summary.status.suspended).length,
      totalMessages: usageData.reduce((sum, b) => sum + (b.summary.limits.messages?.used || 0), 0),
      totalMessageLimit: usageData.reduce((sum, b) => sum + (b.summary.limits.messages?.limit || 0), 0),
      totalVoiceMinutes: usageData.reduce((sum, b) => sum + (b.summary.limits.voice?.used || 0), 0),
      totalVoiceLimit: usageData.reduce((sum, b) => sum + (b.summary.limits.voice?.limit || 0), 0),
      totalImageProcessing: usageData.reduce((sum, b) => sum + (b.summary.limits.imageProcessing?.used || 0), 0),
      totalImageLimit: usageData.reduce((sum, b) => sum + (b.summary.limits.imageProcessing?.limit || 0), 0),
      businessesNearLimit: usageData.filter(b => 
        b.summary.limits.messages?.percentage >= 80 ||
        b.summary.limits.voice?.percentage >= 80 ||
        b.summary.limits.imageProcessing?.percentage >= 80
      ).length
    };

    res.json({
      success: true,
      data: {
        businesses: usageData,
        aggregated
      }
    });

  } catch (error) {
    console.error('Error fetching usage data:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch usage data',
      details: error.message 
    });
  }
});

/**
 * GET /api/usage/:businessId
 * Get detailed usage data for a specific business
 */
router.get('/:businessId', authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.params;
    const db = await getDb();
    const usersCol = db.collection('users');
    const businessesCol = db.collection('businesses');

    // Verify user owns this business
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    if (!user || !user.businesses?.includes(businessId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get business data
    const business = await businessesCol.findOne({ _id: new ObjectId(businessId) });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Generate comprehensive usage summary
    const summary = getUsageSummary(business);
    
    // Add historical data simulation (you can replace this with actual historical tracking)
    const historicalData = generateHistoricalData(business);

    res.json({
      success: true,
      data: {
        business: {
          id: business._id.toString(),
          name: business.name,
          type: business.type,
          status: business.status,
          createdAt: business.createdAt
        },
        summary,
        historical: historicalData
      }
    });

  } catch (error) {
    console.error('Error fetching business usage:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch business usage data',
      details: error.message 
    });
  }
});

/**
 * GET /api/usage/:businessId/check
 * Check if business can perform a specific action
 */
router.post('/:businessId/check', authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.params;
    const { feature, messages, voiceMinutes, imageProcessing, languages } = req.body;
    
    const db = await getDb();
    const usersCol = db.collection('users');
    const businessesCol = db.collection('businesses');

    // Verify user owns this business
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    if (!user || !user.businesses?.includes(businessId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get business data
    const business = await businessesCol.findOne({ _id: new ObjectId(businessId) });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Check access
    const accessResult = checkAccess(business, {
      feature,
      messages,
      voiceMinutes,
      imageProcessing,
      languages
    });

    res.json({
      success: true,
      data: accessResult
    });

  } catch (error) {
    console.error('Error checking business access:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to check business access',
      details: error.message 
    });
  }
});

// Helper function to generate historical data (replace with real data later)
function generateHistoricalData(business) {
  const now = new Date();
  const days = [];
  
  // Generate last 30 days of data
  for (let i = 29; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    // Simulate some usage data (replace with real historical tracking)
    const baseUsage = Math.floor(Math.random() * 50) + 10;
    days.push({
      date: date.toISOString().split('T')[0],
      messages: baseUsage + Math.floor(Math.random() * 20),
      voiceMinutes: Math.floor(Math.random() * 10),
      imageProcessing: Math.floor(Math.random() * 5)
    });
  }
  
  return { daily: days };
}

module.exports = router;
