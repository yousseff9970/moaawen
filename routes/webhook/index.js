// routes/webhook/index.js
const express = require('express');
const router = express.Router();

// Import all sub-modules
const instagramRoutes = require('./instagram');
const messengerRoutes = require('./messenger');

// Mount sub-routers
router.use('/', instagramRoutes);
router.use('/', messengerRoutes);

// ✅ Legacy GET route for backward compatibility (default webhook verification)
router.get('/', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// ✅ Legacy POST route for backward compatibility (handles both platforms like original)
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    console.log('🔍 Full webhook payload (legacy route):', JSON.stringify(body, null, 2));
    
    if (!body.entry) return res.sendStatus(400);

    // Determine platform and route accordingly
    const entry = body.entry[0];
    const event = entry.messaging?.[0];
    const senderId = event?.sender?.id;
    const isInstagram = senderId && senderId.length >= 16;

    if (isInstagram) {
      console.log('📱 Legacy route: Detected Instagram, processing...');
      // Forward to Instagram handler by modifying the request path
      req.url = '/instagram';
      req.originalUrl = '/webhook/instagram';
      const instagramRouter = require('./instagram');
      return instagramRouter(req, res);
    } else {
      console.log('💬 Legacy route: Detected Messenger, processing...');
      // Forward to Messenger handler by modifying the request path
      req.url = '/messenger';
      req.originalUrl = '/webhook/messenger';
      const messengerRouter = require('./messenger');
      return messengerRouter(req, res);
    }
  } catch (err) {
    console.error('❌ Legacy webhook error:', err.response?.data || err.message);
    res.sendStatus(500);
  }
});

module.exports = router;
