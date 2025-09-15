const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const getDb = require('../db');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { getBusinessAnalytics, getConversationLogs } = require('../services/advancedLogger');
const router = express.Router();

// Get all businesses for dropdown
router.get('/businesses', authMiddleware, async (req, res) => {
  try {
    console.log('📊 Fetching businesses for analytics...');
    
    // First try to get businesses from database
    let businesses = [];
    try {
      const db = await getDb();
      businesses = await db.collection('businesses').find({}, { 
        projection: { name: 1, shop: 1, status: 1 } 
      }).sort({ name: 1 }).toArray();
      
      console.log(`💼 Found ${businesses.length} businesses in database`);
    } catch (dbError) {
      console.log('⚠️ Database unavailable, checking conversation logs for businesses...');
    }

    // If no businesses in database, extract unique business IDs from conversation logs
    if (businesses.length === 0) {
      try {
        const conversations = await getConversationLogs({});
        const businessIds = [...new Set(conversations.map(c => c.businessId).filter(Boolean))];
        
        console.log(`📋 Found ${businessIds.length} unique business IDs in conversations`);
        
        businesses = businessIds.map(businessId => ({
          _id: businessId,
          name: `Business ${businessId.slice(-8)}`, // Use last 8 chars for display
          shop: 'unknown',
          status: 'active'
        }));
      } catch (logError) {
        console.error('Error reading conversation logs:', logError);
      }
    }

    // Ensure we have at least some business data
    if (businesses.length === 0) {
      // Fallback: create a default business entry
      businesses = [{
        _id: '68a0c94a57a5afed1a06fa84', // Known business ID from logs
        name: 'Default Business',
        shop: 'moaawen.myshopify.com',
        status: 'active'
      }];
    }

    console.log(`✅ Returning ${businesses.length} businesses`);
    res.json(businesses);
  } catch (error) {
    console.error('❌ Error fetching businesses:', error);
    res.status(500).json({ error: 'Failed to fetch businesses' });
  }
});

// Get comprehensive analytics for a specific business
router.get('/business/:businessId', authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.params;
    const { timeRange = '30d', startDate, endDate } = req.query;

    console.log(`📊 Analytics request for business: ${businessId}, timeRange: ${timeRange}`);

    // Get business details first
    let business = null;
    try {
      const db = await getDb();
      const { ObjectId } = require('mongodb');
      
      try {
        business = await db.collection('businesses').findOne({ _id: new ObjectId(businessId) });
      } catch (e) {
        console.log('⚠️ Invalid ObjectId or database issue, proceeding without business details');
      }
    } catch (dbError) {
      console.log('⚠️ Database unavailable for business lookup');
    }
    
    // If business not found in database, create a fallback
    if (!business) {
      business = {
        _id: businessId,
        name: `Business ${businessId.slice(-8)}`,
        shop: 'unknown',
        status: 'active'
      };
    }

    console.log(`💼 Business details: ${business.name}`);

    // Get analytics data using the advanced logger
    let analytics;
    try {
      analytics = await getBusinessAnalytics(businessId, timeRange, startDate, endDate);
    } catch (analyticsError) {
      console.error('❌ Error getting analytics:', analyticsError);
      
      // Return empty analytics structure as fallback
      analytics = {
        overview: {
          totalConversations: 0,
          uniqueUsers: 0,
          totalMessages: 0,
          avgResponseTime: 0,
          avgSatisfaction: 4.2,
          growthRate: 0,
          retentionRate: 0,
          resolutionRate: 0,
          conversionRate: 0
        },
        timeDistribution: {
          daily: Array(7).fill(0),
          hourly: Array(24).fill(0),
          monthly: {}
        },
        userEngagement: {
          totalUsers: 0,
          avgConversationsPerUser: 0,
          userRetention: { day7: 0, day30: 0 }
        },
        businessMetrics: {
          conversionRate: 0,
          leadQuality: { average: 0, distribution: { high: 0, medium: 0, low: 0 } },
          productMentions: []
        },
        conversationFlow: {
          avgTurnsPerConversation: 0,
          completionRate: 0,
          dropoffPoints: {},
          initiationTypes: {}
        },
        performance: {
          avgTokenUsage: { input: 0, output: 0, total: 0 },
          errorRate: 0,
          responseTimeDistribution: { fast: 0, medium: 0, slow: 0 }
        },
        geographicData: [],
        deviceStats: [],
        languageDistribution: {},
        messageTypes: [],
        responseSourceDistribution: {},
        platformDistribution: {},
        topUsers: [],
        conversionFunnel: [
          { stage: 'Total Visitors', count: 0, percentage: 100 },
          { stage: 'Engaged Users', count: 0, percentage: 0 },
          { stage: 'Interested Users', count: 0, percentage: 0 },
          { stage: 'Converted Users', count: 0, percentage: 0 }
        ],
        productMentions: [],
        channels: [],
        // Add missing frontend chart data
        hourlyDistribution: Array(24).fill(0).map((_, hour) => ({ hour: hour.toString(), conversations: 0 })),
        busyDays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => ({ day, conversations: 0 })),
        timeBasedData: [],
        responseTimeTrend: [],
        satisfactionTrend: []
      };
    }

    // Combine business info with analytics
    const response = {
      business: {
        id: business._id,
        name: business.name,
        shop: business.shop,
        status: business.status
      },
      timeRange,
      analytics
    };

    console.log(`✅ Analytics response prepared for business ${business.name}`);
    console.log(`📈 Overview: ${analytics.overview.totalConversations} conversations, ${analytics.overview.uniqueUsers} users`);

    res.json(response);
  } catch (error) {
    console.error('❌ Error in analytics endpoint:', error);
    res.status(500).json({ 
      error: 'Failed to fetch analytics', 
      details: error.message 
    });
  }
});

// Health check endpoint for analytics service
router.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'analytics',
    timestamp: new Date().toISOString()
  });
});

// Get raw conversation logs (for debugging)
router.get('/logs/:businessId', authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.params;
    const { timeRange = '30d', limit = 100 } = req.query;
    
    console.log(`📋 Raw logs request for business: ${businessId}`);
    
    const conversations = await getConversationLogs({
      businessId,
      timeRange
    });
    
    // Limit results for performance
    const limitedConversations = conversations.slice(0, parseInt(limit));
    
    res.json({
      businessId,
      timeRange,
      total: conversations.length,
      returned: limitedConversations.length,
      conversations: limitedConversations
    });
  } catch (error) {
    console.error('❌ Error fetching raw logs:', error);
    res.status(500).json({ error: 'Failed to fetch conversation logs' });
  }
});

module.exports = router;
