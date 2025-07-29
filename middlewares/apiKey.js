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

  next();
};
