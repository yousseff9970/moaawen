// middlewares/apiKey.js
module.exports = (req, res, next) => {
  const clientKey = req.headers['x-api-key'];
  const validKeys = process.env.WIDGET_API_KEYS?.split(',') || [];

  if (!clientKey || !validKeys.includes(clientKey)) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Missing or invalid API key'
    });
  }

  // Set flag for rate limiter to identify valid API key
  req.validApiKey = clientKey;
  
  next();
};
