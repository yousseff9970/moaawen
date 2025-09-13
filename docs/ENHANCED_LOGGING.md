# Enhanced Logging System

## Overview

This enhanced logging system provides comprehensive tracking and analytics for the Moaawen AI Support platform. It replaces the old simple JSON logging with a sophisticated, analytics-ready logging infrastructure.

## Features

### 🚀 Core Capabilities
- **Multi-layered Logging**: Conversations, business activities, errors, and analytics events
- **Advanced Analytics**: Real-time calculation of business metrics and insights
- **Automatic Request Tracking**: All API requests and responses are logged automatically
- **Error Tracking**: Comprehensive error logging with context and severity levels
- **Performance Monitoring**: Response times, token usage, and system performance metrics

### 📊 Analytics & Insights
- **Conversation Analytics**: Message types, response times, satisfaction scores
- **User Engagement**: Retention rates, conversation patterns, user journey tracking
- **Business Metrics**: Conversion rates, lead quality, product mentions
- **Platform Distribution**: WhatsApp, Facebook, Instagram usage patterns
- **Time-based Analysis**: Hourly, daily, weekly, and monthly trends

### 🔧 Technical Features
- **Database Integration**: Automatic fallback to MongoDB for better performance
- **File System Backup**: JSON files as backup when database is unavailable
- **Automatic Cleanup**: Prevents log files from growing too large
- **Middleware Integration**: Automatic logging of all API requests
- **Error Recovery**: Graceful handling of logging failures

## File Structure

```
services/
├── advancedLogger.js      # Main logging service
└── jsonLog.js            # Legacy logging (deprecated)

middlewares/
└── loggingMiddleware.js  # Automatic request/response logging

logs/
├── conversations.json    # Enhanced conversation logs
├── analytics.json       # Analytics events
├── errors.json          # Error logs
└── business_activity.json # Business activity tracking

scripts/
└── demonstrateLogging.js # Demo script showing all features
```

## Usage Examples

### Basic Conversation Logging

```javascript
const { logConversation } = require('./services/advancedLogger');

await logConversation({
  senderId: 'user123',
  businessId: 'business456',
  businessName: 'My Business',
  message: 'Hello, what products do you have?',
  ai_reply: 'Hi! We have great products...',
  responseSource: 'ai',
  layer: 'ai',
  duration: 1250,
  platform: 'whatsapp',
  messageType: 'text',
  intent: 'product_inquiry',
  tokens: { input_tokens: 50, output_tokens: 75 },
  conversionIntent: 'medium',
  userSatisfaction: 4.2,
  productMentions: [
    { productId: '123', productName: 'T-Shirt', category: 'clothing' }
  ]
});
```

### Business Activity Tracking

```javascript
const { logBusinessActivity } = require('./services/advancedLogger');

await logBusinessActivity({
  businessId: 'business456',
  activityType: 'product_view',
  userId: 'user123',
  platform: 'web',
  details: {
    productId: '123',
    productName: 'T-Shirt',
    viewDuration: 30000
  },
  metrics: {
    pageLoadTime: 850,
    interactionCount: 5
  }
});
```

### Error Logging

```javascript
const { logError } = require('./services/advancedLogger');

await logError(error, {
  businessId: 'business456',
  userId: 'user123',
  endpoint: '/api/products',
  method: 'GET',
  severity: 'error', // 'error', 'warning', 'critical'
  category: 'api_error',
  requestData: { productId: '123' }
});
```

### Analytics Events

```javascript
const { logAnalyticsEvent } = require('./services/advancedLogger');

await logAnalyticsEvent({
  eventType: 'button_click',
  businessId: 'business456',
  userId: 'user123',
  properties: {
    buttonName: 'add_to_cart',
    productId: '123',
    location: 'product_page'
  },
  value: 1,
  platform: 'web',
  source: 'organic'
});
```

### Retrieving Analytics

```javascript
const { getBusinessAnalytics } = require('./services/advancedLogger');

const analytics = await getBusinessAnalytics('business456', '30d');
console.log('Conversations:', analytics.overview.totalConversations);
console.log('Conversion Rate:', analytics.businessMetrics.conversionRate);
```

## Data Structure

### Enhanced Conversation Log Entry

```javascript
{
  "id": "unique_log_id",
  "timestamp": "2025-09-13T10:30:00.000Z",
  "date": "2025-09-13",
  "hour": 10,
  "dayOfWeek": 5,
  "week": 37,
  "month": 9,
  "year": 2025,
  
  // Business context
  "businessId": "business456",
  "businessName": "My Business",
  
  // User context
  "userId": "user123",
  "platform": "whatsapp",
  "channel": "whatsapp",
  
  // Message data
  "messageId": "msg_id",
  "messageType": "text",
  "message": "Hello, what products do you have?",
  "messageLength": 32,
  "language": "english",
  
  // AI Response
  "aiReply": "Hi! We have great products...",
  "aiReplyLength": 156,
  "responseSource": "ai",
  "layer": "ai",
  "intent": "product_inquiry",
  
  // Performance
  "duration": 1250,
  "tokens": {
    "input_tokens": 50,
    "output_tokens": 75,
    "total_tokens": 125
  },
  
  // Analytics
  "conversionIntent": "medium",
  "userSatisfaction": 4.2,
  "productMentions": [
    {
      "productId": "123",
      "productName": "T-Shirt",
      "category": "clothing"
    }
  ],
  
  // Technical
  "deviceType": "mobile",
  "location": "Lebanon",
  "sessionId": "session_abc"
}
```

### Analytics Output Structure

```javascript
{
  "overview": {
    "totalConversations": 150,
    "uniqueUsers": 45,
    "avgResponseTime": 1250,
    "avgSatisfaction": 4.2,
    "conversionRate": 15.5,
    "leadQuality": 3.8
  },
  "timeDistribution": {
    "hourly": [0, 2, 1, 0, ...], // 24 hours
    "daily": [15, 20, 18, ...],   // 7 days
    "monthly": { "9": 150, "8": 120 }
  },
  "platformDistribution": {
    "whatsapp": 80,
    "facebook": 45,
    "instagram": 25
  },
  "languageDistribution": {
    "arabic": 90,
    "english": 45,
    "mixed": 15
  },
  "userEngagement": {
    "totalUsers": 45,
    "avgConversationsPerUser": 3.3,
    "userRetention": 65.5
  },
  "businessMetrics": {
    "conversionRate": 15.5,
    "leadQuality": 3.8,
    "productMentions": [
      { "name": "T-Shirt", "mentions": 25 },
      { "name": "Jeans", "mentions": 18 }
    ]
  }
}
```

## Migration from Old System

The new system automatically handles the old `logs.json` format as a fallback. To fully migrate:

1. **Update imports**: Replace `logToJson` with specific logging functions
2. **Add context**: Include businessId, platform, and other metadata
3. **Use structured data**: Pass objects instead of flat log entries
4. **Enable middleware**: Add logging middleware to routes

### Before (Old System)
```javascript
logToJson({
  layer: 'ai',
  senderId: 'user123',
  message: 'Hello',
  ai_reply: 'Hi there!'
});
```

### After (New System)
```javascript
await logConversation({
  senderId: 'user123',
  businessId: 'business456',
  message: 'Hello',
  ai_reply: 'Hi there!',
  responseSource: 'ai',
  platform: 'whatsapp',
  duration: 1250
});
```

## Performance Considerations

- **Async Operations**: All logging is asynchronous to avoid blocking
- **Error Handling**: Logging failures don't crash the application
- **Memory Management**: Large log files are automatically trimmed
- **Database Optimization**: Indexes on frequently queried fields
- **Batching**: Multiple log entries can be batched for better performance

## Monitoring & Alerts

The system supports monitoring through:

- **Error Severity Levels**: Critical errors are automatically highlighted
- **Performance Thresholds**: Slow response times are tracked
- **Volume Monitoring**: Unusual activity patterns are detected
- **Business Health**: Conversion and satisfaction trends

## Testing

Run the demonstration script to see all features:

```bash
node scripts/demonstrateLogging.js
```

This will create sample log entries and show analytics output.

## API Integration

The logging system integrates with the analytics API:

```
GET /analytics/businesses           # Get businesses for dropdown
GET /analytics/business/:id         # Get comprehensive analytics
```

The analytics endpoint automatically uses the enhanced logging data and falls back to manual calculation if needed.

## Future Enhancements

- **Real-time Dashboards**: Live analytics streaming
- **Machine Learning**: Predictive analytics and insights
- **Custom Metrics**: Business-specific KPI tracking
- **Data Export**: Advanced export formats (CSV, PDF reports)
- **Alerting System**: Automated notifications for business owners
