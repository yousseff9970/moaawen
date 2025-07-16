// routes/chat.js
const express = require('express');
const router = express.Router();
const { generateReply } = require('../services/openai');

router.post('/chat', async (req, res) => {
  const { message, domain, sessionId } = req.body;

  if (!message || !domain || !sessionId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const reply = await generateReply(sessionId, message, { domain });
    return res.json({ reply: reply.reply });
  } catch (err) {
    console.error('Chat API error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 
