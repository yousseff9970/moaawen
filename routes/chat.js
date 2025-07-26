const express = require('express');
const router = express.Router();
const { generateReply } = require('../services/openai');

// Temporary in-memory store (you can later replace with DB)
const sessionHistory = {};
const sessionTimeouts = {}; // Track timers per session

router.post('/chat', async (req, res) => {
  const { message, domain, sessionId } = req.body;

  if (!message || !domain || !sessionId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Ensure session history array exists
    if (!sessionHistory[sessionId]) {
      sessionHistory[sessionId] = [];
    }

    // Add user message
    sessionHistory[sessionId].push({ role: 'user', content: message });

    // Keep only last 10 messages
    if (sessionHistory[sessionId].length > 10) {
      sessionHistory[sessionId] = sessionHistory[sessionId].slice(-10);
    }

    // Reset the 10-min timer for this session
    if (sessionTimeouts[sessionId]) {
      clearTimeout(sessionTimeouts[sessionId]);
    }
    sessionTimeouts[sessionId] = setTimeout(() => {
      delete sessionHistory[sessionId];
      delete sessionTimeouts[sessionId];
      console.log(`🗑️ Cleared session history for ${sessionId} after 10 min`);
    }, 10 * 60 * 500); // 10 minutes

    // Pass the last 10 messages as context to OpenAI
    const reply = await generateReply(sessionId, message, {
      domain,
      history: sessionHistory[sessionId], // pass conversation history
    });

    // Save the AI's reply to history
    sessionHistory[sessionId].push({ role: 'assistant', content: reply.reply });

    // Keep only last 10 messages again
    if (sessionHistory[sessionId].length > 10) {
      sessionHistory[sessionId] = sessionHistory[sessionId].slice(-10);
    }

    return res.json({ reply: reply.reply });
  } catch (err) {
    console.error('Chat API error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
