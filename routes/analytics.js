const express = require('express');
const fs = require('fs');
const path = require('path');
const getDb = require('../db');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { getBusinessAnalytics, getConversationLogs } = require('../services/advancedLogger');
const router = express.Router();

// Get all businesses for dropdown
router.get('/businesses', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const businesses = await db.collection('businesses').find({}, { 
      projection: { name: 1, shop: 1, status: 1 } 
    }).sort({ name: 1 }).toArray();
    res.json(businesses);
  } catch (error) {
    console.error('Error fetching businesses:', error);
    res.status(500).json({ error: 'Failed to fetch businesses' });
  }
});

// Get comprehensive analytics for a specific business
router.get('/business/:businessId', authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.params;
    const { timeRange = '30d', startDate, endDate } = req.query;

    // Get business details
    const db = await getDb();
    const { ObjectId } = require('mongodb');
    
    let business;
    try {
      business = await db.collection('businesses').findOne({ _id: new ObjectId(businessId) });
    } catch (e) {
      return res.status(400).json({ error: 'Invalid business ID' });
    }
    
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Read conversations data from advanced logger
    let conversations = [];
    try {
      conversations = await getConversationLogs({ 
        businessId: businessId,
        timeRange: timeRange,
        startDate: startDate,
        endDate: endDate
      });
    } catch (e) {
      console.error('Failed to read conversations from advanced logger:', e.message);
      // Fallback to old file systems
      const paths = [
        path.join(__dirname, '../services/logs.json'),
        path.join(__dirname, '../logs/conversations.json')
      ];
      
      for (const filePath of paths) {
        try {
          if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf-8');
            const allConversations = JSON.parse(data);
            const businessConversations = allConversations.filter(conv => 
              conv.business_id === businessId || 
              conv.businessId === businessId ||
              conv.senderId // Include all if no specific business filtering possible
            );
            
            if (businessConversations.length > 0) {
              conversations = businessConversations;
              console.log(`Found ${conversations.length} conversations in ${filePath}`);
              break;
            }
          }
        } catch (fileError) {
          console.error(`Failed to read from ${filePath}:`, fileError.message);
        }
      }
    }

    // Use advanced analytics if available
    let advancedAnalytics;
    try {
      advancedAnalytics = await getBusinessAnalytics(businessId, timeRange);
      if (advancedAnalytics) {
        // Add mock data for components that expect specific data structures
        const { createMockAnalyticsData } = require('../utils/mockAnalyticsData');
        const completeAnalytics = createMockAnalyticsData(advancedAnalytics);
        
        return res.json({
          business: {
            id: business._id,
            name: business.name,
            shop: business.shop,
            status: business.status
          },
          timeRange,
          analytics: completeAnalytics
        });
      }
    } catch (analyticsError) {
      console.error('Error getting advanced analytics, falling back to manual calculation:', analyticsError);
    }

    // Fallback to manual calculation if advanced analytics fails
    const filteredConversations = conversations;

    // Calculate analytics
    const analytics = calculateAnalytics(filteredConversations, business, timeRange);
    
    res.json({
      business: {
        id: business._id,
        name: business.name,
        shop: business.shop,
        status: business.status
      },
      timeRange,
      analytics
    });

  } catch (error) {
    console.error('Error fetching business analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

function calculateAnalytics(conversations, business, timeRange) {
  const now = new Date();
  
  // Basic metrics
  const totalConversations = conversations.length;
  const uniqueUsers = new Set(conversations.map(c => c.user_id || c.userId)).size;
  
  // Channel distribution
  const channelStats = {};
  conversations.forEach(conv => {
    const channel = conv.channel || conv.platform || 'unknown';
    channelStats[channel] = (channelStats[channel] || 0) + 1;
  });

  // Message types
  const messageTypes = {
    text: 0,
    image: 0,
    voice: 0,
    document: 0,
    location: 0,
    other: 0
  };

  conversations.forEach(conv => {
    if (conv.messages && Array.isArray(conv.messages)) {
      conv.messages.forEach(msg => {
        const type = msg.type || 'text';
        if (messageTypes.hasOwnProperty(type)) {
          messageTypes[type]++;
        } else {
          messageTypes.other++;
        }
      });
    }
  });

  // Response times (mock data for now)
  const responseTimes = conversations.map(() => Math.random() * 300 + 10); // 10-310 seconds
  const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length || 0;

  // Customer satisfaction (mock data)
  const satisfactionRatings = conversations.map(() => Math.floor(Math.random() * 5) + 1);
  const avgSatisfaction = satisfactionRatings.reduce((a, b) => a + b, 0) / satisfactionRatings.length || 0;

  // Time-based analytics
  const timeBasedData = generateTimeBasedData(conversations, timeRange);
  
  // Top performing hours
  const hourlyDistribution = Array(24).fill(0);
  conversations.forEach(conv => {
    const hour = new Date(conv.timestamp).getHours();
    hourlyDistribution[hour]++;
  });

  // Conversation resolution rate (mock)
  const resolvedConversations = Math.floor(totalConversations * (0.7 + Math.random() * 0.25));
  const resolutionRate = totalConversations > 0 ? (resolvedConversations / totalConversations) * 100 : 0;

  // Popular products/topics (from business products)
  const productMentions = {};
  if (business.products) {
    business.products.forEach(product => {
      productMentions[product.title] = Math.floor(Math.random() * 50) + 1;
    });
  }

  // Growth metrics
  const previousPeriod = getPreviousPeriodData(conversations, timeRange);
  const growthRate = previousPeriod.total > 0 ? 
    ((totalConversations - previousPeriod.total) / previousPeriod.total) * 100 : 0;

  // Conversion metrics (mock)
  const conversions = Math.floor(totalConversations * (0.1 + Math.random() * 0.2));
  const conversionRate = totalConversations > 0 ? (conversions / totalConversations) * 100 : 0;

  // Retention metrics
  const returningUsers = Math.floor(uniqueUsers * (0.3 + Math.random() * 0.4));
  const retentionRate = uniqueUsers > 0 ? (returningUsers / uniqueUsers) * 100 : 0;

  return {
    overview: {
      totalConversations,
      uniqueUsers,
      avgResponseTime: Math.round(avgResponseTime),
      avgSatisfaction: Math.round(avgSatisfaction * 10) / 10,
      resolutionRate: Math.round(resolutionRate * 10) / 10,
      conversionRate: Math.round(conversionRate * 10) / 10,
      retentionRate: Math.round(retentionRate * 10) / 10,
      growthRate: Math.round(growthRate * 10) / 10
    },
    channels: Object.entries(channelStats).map(([name, value]) => ({ name, value })),
    messageTypes: Object.entries(messageTypes).map(([name, value]) => ({ name, value })),
    timeBasedData,
    hourlyDistribution: hourlyDistribution.map((value, hour) => ({
      hour: `${hour.toString().padStart(2, '0')}:00`,
      conversations: value
    })),
    productMentions: Object.entries(productMentions)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([name, mentions]) => ({ name, mentions })),
    satisfactionTrend: generateSatisfactionTrend(timeRange),
    responseTimeTrend: generateResponseTimeTrend(timeRange),
    conversionFunnel: generateConversionFunnel(totalConversations),
    topUsers: generateTopUsers(conversations),
    geographicData: generateGeographicData(conversations),
    deviceStats: generateDeviceStats(),
    busyDays: generateBusyDaysData(conversations)
  };
}

function generateTimeBasedData(conversations, timeRange) {
  const data = [];
  const now = new Date();
  let intervals;
  let format;

  switch (timeRange) {
    case '7d':
      intervals = 7;
      format = 'day';
      break;
    case '30d':
      intervals = 30;
      format = 'day';
      break;
    case '90d':
      intervals = 12;
      format = 'week';
      break;
    case '1y':
      intervals = 12;
      format = 'month';
      break;
    default:
      intervals = 30;
      format = 'day';
  }

  for (let i = intervals - 1; i >= 0; i--) {
    const date = new Date(now);
    let label;
    
    if (format === 'day') {
      date.setDate(now.getDate() - i);
      label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else if (format === 'week') {
      date.setDate(now.getDate() - (i * 7));
      label = `Week ${Math.ceil((now.getDate() - date.getDate()) / 7)}`;
    } else {
      date.setMonth(now.getMonth() - i);
      label = date.toLocaleDateString('en-US', { month: 'short' });
    }

    const startOfPeriod = new Date(date);
    const endOfPeriod = new Date(date);
    
    if (format === 'day') {
      startOfPeriod.setHours(0, 0, 0, 0);
      endOfPeriod.setHours(23, 59, 59, 999);
    } else if (format === 'week') {
      endOfPeriod.setDate(endOfPeriod.getDate() + 6);
    } else {
      endOfPeriod.setMonth(endOfPeriod.getMonth() + 1);
      endOfPeriod.setDate(0);
    }

    const periodConversations = conversations.filter(conv => {
      const convDate = new Date(conv.timestamp);
      return convDate >= startOfPeriod && convDate <= endOfPeriod;
    });

    data.push({
      date: label,
      conversations: periodConversations.length,
      users: new Set(periodConversations.map(c => c.user_id || c.userId)).size
    });
  }

  return data;
}

function getPreviousPeriodData(conversations, timeRange) {
  const now = new Date();
  let days;
  
  switch (timeRange) {
    case '7d': days = 7; break;
    case '30d': days = 30; break;
    case '90d': days = 90; break;
    case '1y': days = 365; break;
    default: days = 30;
  }

  const previousStart = new Date(now);
  previousStart.setDate(now.getDate() - (days * 2));
  const previousEnd = new Date(now);
  previousEnd.setDate(now.getDate() - days);

  const previousConversations = conversations.filter(conv => {
    const convDate = new Date(conv.timestamp);
    return convDate >= previousStart && convDate <= previousEnd;
  });

  return { total: previousConversations.length };
}

function generateSatisfactionTrend(timeRange) {
  const intervals = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 12;
  return Array.from({ length: intervals }, (_, i) => ({
    date: `Day ${i + 1}`,
    satisfaction: 3 + Math.random() * 2
  }));
}

function generateResponseTimeTrend(timeRange) {
  const intervals = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 12;
  return Array.from({ length: intervals }, (_, i) => ({
    date: `Day ${i + 1}`,
    responseTime: 60 + Math.random() * 120
  }));
}

function generateConversionFunnel(totalConversations) {
  return [
    { stage: 'Initial Contact', users: totalConversations, percentage: 100 },
    { stage: 'Engaged', users: Math.floor(totalConversations * 0.8), percentage: 80 },
    { stage: 'Interested', users: Math.floor(totalConversations * 0.5), percentage: 50 },
    { stage: 'Quote Requested', users: Math.floor(totalConversations * 0.3), percentage: 30 },
    { stage: 'Converted', users: Math.floor(totalConversations * 0.15), percentage: 15 }
  ];
}

function generateTopUsers(conversations) {
  const userCounts = {};
  conversations.forEach(conv => {
    const userId = conv.user_id || conv.userId;
    userCounts[userId] = (userCounts[userId] || 0) + 1;
  });

  return Object.entries(userCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([userId, count]) => ({
      userId,
      conversations: count,
      lastActive: new Date().toISOString()
    }));
}

function generateGeographicData(conversations) {
  const countries = ['United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'Australia', 'Japan', 'Brazil'];
  return countries.map(country => ({
    country,
    users: Math.floor(Math.random() * 100) + 10,
    conversations: Math.floor(Math.random() * 200) + 20
  }));
}

function generateDeviceStats() {
  return [
    { device: 'Mobile', percentage: 65 },
    { device: 'Desktop', percentage: 25 },
    { device: 'Tablet', percentage: 10 }
  ];
}

function generateBusyDaysData(conversations) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dayStats = Array(7).fill(0);
  
  conversations.forEach(conv => {
    const day = new Date(conv.timestamp).getDay();
    dayStats[day]++;
  });

  return days.map((day, index) => ({
    day,
    conversations: dayStats[index]
  }));
}

module.exports = router;
