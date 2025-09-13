const { logAnalyticsEvent, logError } = require('../services/advancedLogger');

/**
 * Middleware to automatically log API requests and responses
 */
const requestLoggingMiddleware = (options = {}) => {
  return async (req, res, next) => {
    const startTime = Date.now();
    
    // Extract business context if available
    const businessId = req.body?.businessId || req.params?.businessId || req.query?.businessId;
    const userId = req.user?.id || req.body?.userId || req.headers['x-user-id'];
    
    // Log the incoming request
    const requestData = {
      eventType: 'api_request',
      businessId,
      userId,
      properties: {
        method: req.method,
        url: req.originalUrl,
        endpoint: req.route?.path,
        userAgent: req.headers['user-agent'],
        contentType: req.headers['content-type'],
        contentLength: req.headers['content-length'],
        referer: req.headers.referer,
        origin: req.headers.origin
      },
      platform: 'api',
      source: 'backend',
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip || req.connection?.remoteAddress
    };

    try {
      await logAnalyticsEvent(requestData);
    } catch (error) {
      console.error('Error logging request analytics:', error);
    }

    // Capture the original res.send to log responses
    const originalSend = res.send;
    
    res.send = function(data) {
      const duration = Date.now() - startTime;
      
      // Log the response
      const responseData = {
        eventType: 'api_response',
        businessId,
        userId,
        properties: {
          statusCode: res.statusCode,
          duration,
          responseSize: typeof data === 'string' ? data.length : JSON.stringify(data).length,
          method: req.method,
          url: req.originalUrl,
          endpoint: req.route?.path
        },
        value: duration, // Response time as value
        platform: 'api',
        source: 'backend',
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip || req.connection?.remoteAddress
      };

      logAnalyticsEvent(responseData).catch(error => {
        console.error('Error logging response analytics:', error);
      });

      // Call the original send method
      originalSend.call(this, data);
    };

    // Handle errors
    const originalNext = next;
    next = (error) => {
      if (error) {
        const duration = Date.now() - startTime;
        
        logError(error, {
          businessId,
          userId,
          endpoint: req.originalUrl,
          method: req.method,
          duration,
          requestData: {
            body: req.body,
            params: req.params,
            query: req.query
          },
          userAgent: req.headers['user-agent'],
          ipAddress: req.ip || req.connection?.remoteAddress,
          severity: 'error',
          category: 'api_error'
        }).catch(logError => {
          console.error('Error logging API error:', logError);
        });
      }
      
      originalNext(error);
    };

    next();
  };
};

/**
 * Middleware specifically for business-related endpoints
 */
const businessActivityMiddleware = (activityType) => {
  return async (req, res, next) => {
    const { logBusinessActivity } = require('../services/advancedLogger');
    
    const businessId = req.body?.businessId || req.params?.businessId;
    const userId = req.user?.id || req.body?.userId;
    
    if (businessId) {
      try {
        await logBusinessActivity({
          businessId,
          activityType,
          userId,
          platform: 'dashboard',
          details: {
            endpoint: req.originalUrl,
            method: req.method,
            params: req.params,
            query: req.query
          },
          metrics: {
            timestamp: new Date().toISOString()
          }
        });
      } catch (error) {
        console.error('Error logging business activity:', error);
      }
    }
    
    next();
  };
};

/**
 * Error logging middleware
 */
const errorLoggingMiddleware = (err, req, res, next) => {
  const businessId = req.body?.businessId || req.params?.businessId;
  const userId = req.user?.id || req.body?.userId;
  
  logError(err, {
    businessId,
    userId,
    endpoint: req.originalUrl,
    method: req.method,
    requestData: {
      body: req.body,
      params: req.params,
      query: req.query,
      headers: req.headers
    },
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip || req.connection?.remoteAddress,
    severity: err.status >= 500 ? 'critical' : 'error',
    category: 'api_error',
    tags: [req.method, req.route?.path || req.originalUrl]
  }).catch(logError => {
    console.error('Error in error logging middleware:', logError);
  });
  
  next(err);
};

module.exports = {
  requestLoggingMiddleware,
  businessActivityMiddleware,
  errorLoggingMiddleware
};
