const express = require('express');
const router = express.Router();
const { generateReply } = require('../services/openai');
const { validateChatRequest } = require('../middlewares/validate');
const xss = require('xss'); 
// Temporary in-memory store (you can later replace with DB)
const sessionHistory = {};


router.post('/chat', validateChatRequest, async (req, res) => {
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

 

    // Pass the last 10 messages as context to OpenAI
    const reply = await generateReply(sessionId, message, {
      domain,
      history: sessionHistory[sessionId], // pass conversation history
    });

    // Handle multiple messages if response was split
    if (reply.isMultiMessage && Array.isArray(reply.reply)) {
      // Save all message chunks to history
      reply.reply.forEach(chunk => {
        sessionHistory[sessionId].push({ role: 'assistant', content: chunk });
      });
      
      // Keep only last 10 messages
      if (sessionHistory[sessionId].length > 10) {
        sessionHistory[sessionId] = sessionHistory[sessionId].slice(-10);
      }
      
      // Return all chunks as an array
      return res.json({ 
        reply: reply.reply.map(chunk => xss(chunk)),
        isMultiMessage: true,
        totalChunks: reply.reply.length
      });
    } else {
      // Save the AI's reply to history
      sessionHistory[sessionId].push({ role: 'assistant', content: reply.reply });

      // Keep only last 10 messages again
      if (sessionHistory[sessionId].length > 10) {
        sessionHistory[sessionId] = sessionHistory[sessionId].slice(-10);
      }

      return res.json({ reply: xss(reply.reply) });
    }
  } catch (err) {
    console.error('Chat API error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
