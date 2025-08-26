const express = require('express');
const router = express.Router();
const axios = require('axios');
const { scheduleBatchedReply } = require('../services/openai');
const { downloadVoiceFile, transcribeWithWhisper } = require('../services/transcribeVoice');
const { logConversation } = require('../utils/logger');
const { downloadMedia } = require('../services/downloadMedia');
const { matchImageAndGenerateReply } = require('../services/imageMatcher');
const { getBusinessInfo } = require('../services/business');
const { checkAccess } = require('../utils/businessPolicy');
const { trackUsage } = require('../utils/trackUsage');
const xss = require('xss');

const processedMessages = new Set();
const processedEvents = new Map(); // Track events by timestamp + sender

// Clean up old processed messages every 30 minutes to prevent memory leaks
setInterval(() => {
  if (processedMessages.size > 1000) {
    console.log(`🧹 Cleaning up WhatsApp processed messages cache (${processedMessages.size} entries)`);
    processedMessages.clear();
  }
  if (processedEvents.size > 1000) {
    console.log(`🧹 Cleaning up WhatsApp processed events cache (${processedEvents.size} entries)`);
    processedEvents.clear();
  }
}, 30 * 60 * 1000);

// Helper function to create unique event signature for WhatsApp
function createWhatsAppEventSignature(msg, phoneId) {
  const from = msg.from;
  const timestamp = msg.timestamp;
  const messageText = msg.text?.body || msg.type;
  
  return `${phoneId}-${from}-${timestamp}-${messageText?.substring(0, 50)}`;
}

// Helper function to check if WhatsApp event is duplicate
function isDuplicateWhatsAppEvent(msg, phoneId) {
  const signature = createWhatsAppEventSignature(msg, phoneId);
  const now = Date.now();
  
  if (processedEvents.has(signature)) {
    const lastSeen = processedEvents.get(signature);
    // If we've seen this exact event in the last 5 minutes, it's a duplicate
    if (now - lastSeen < 5 * 60 * 1000) {
      return true;
    }
  }
  
  processedEvents.set(signature, now);
  return false;
}

function getFallback(reason) {
  

  if (reason.includes('expired')) return '⚠️ Your subscription expired. Please renew.';
  if (reason.includes('inactive')) return '⚠️ Your account is inactive.';
  if (reason.includes('message_limit')) return '⚠️ Message limit reached. Upgrade your plan.';
  if (reason.find(r => r.startsWith('feature:voiceInput'))) return '🎤 Voice not allowed in your plan.';
  if (reason.find(r => r.startsWith('feature:imageAnalysis'))) return '🖼️ Image analysis not allowed in your plan.';

  return '🚫 Access denied.';
}

router.get('/', (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

router.post('/', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0]?.value;

    if (!change?.messages || !change?.metadata?.phone_number_id) {
      return res.sendStatus(200);
    }

    const phoneId = change.metadata.phone_number_id;
    const messages = change.messages;

    for (const msg of messages) {
      // Check for duplicate event first (before any processing)
      if (isDuplicateWhatsAppEvent(msg, phoneId)) {
        console.log(`⏭️ Skipping duplicate WhatsApp event for phone ${phoneId}`);
        continue;
      }
      
      const msgId = msg.id;
      const from = msg.from;
      const isVoice = msg.type === 'audio';
      const isImage = msg.type === 'image';
      let messageText = msg.text?.body;

      if (!from || !msgId) {
        console.log(`⏭️ Skipping WhatsApp message: from=${from}, msgId=${msgId}`);
        continue;
      }

      // Check for duplicate processing by message ID
      if (processedMessages.has(msgId)) {
        console.log(`⏭️ Skipping duplicate WhatsApp message: ${msgId}`);
        continue;
      }

      processedMessages.add(msgId);
      console.log(`✅ Processing new WhatsApp message: ${msgId} from ${from} (type: ${msg.type})`);

      // Load business - WhatsApp lookup
      let business;
      try {
        console.log(`🔍 Looking up business for WhatsApp phone: ${phoneId}`);
        business = await getBusinessInfo({ phone_number_id: phoneId });
        console.log(`✅ Found business via WhatsApp phone_number_id: ${phoneId}`);
      } catch (e) {
        console.warn(`⚠️ No business found for WhatsApp phone ${phoneId}: ${e.message}`);
        continue;
      }

      

      // 🖼️ Image
      if (isImage) {
        const access = checkAccess(business, { feature: 'imageAnalysis' });
        if (!access.allowed) {
          const reply = getFallback(access.reasons);
          await sendWhatsApp(from, reply);
          logConversation({ platform: 'whatsapp', userId: from, message: '[Image]', aiReply: { reply }, source: 'policy' });
          continue;
        }

        const mediaId = msg.image?.id;
        if (!mediaId) {
          console.log(`⏭️ Skipping image message without media ID`);
          continue;
        }

        try {
          const mediaRes = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
            headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
          });
          const mediaUrl = mediaRes.data.url;

          const filePath = await downloadMedia(mediaUrl, `wa_img_${msgId}.jpg`, {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
          });

          const { reply } = await matchImageAndGenerateReply(from, filePath, { phone_number_id: phoneId });
          await sendWhatsApp(from, xss(reply));

          // ✅ Track image usage
          await trackUsage(business.id, 'image');

          logConversation({ platform: 'whatsapp', userId: from, message: '[Image]', aiReply: { reply }, source: 'image' });
        } catch (err) {
          console.error(`❌ Error processing WhatsApp image from ${from}:`, err.message);
          await sendWhatsApp(from, '❌ Sorry, I had trouble processing your image. Please try again.');
        }
        continue;
      }

      // 🎙️ Voice
      if (isVoice) {
        const access = checkAccess(business, { feature: 'voiceInput' });
        if (!access.allowed) {
          const reply = getFallback(access.reasons);
          await sendWhatsApp(from, reply);
          logConversation({ platform: 'whatsapp', userId: from, message: '[Voice]', aiReply: { reply }, source: 'policy' });
          continue;
        }

        const mediaId = msg.audio?.id;
        if (!mediaId) {
          console.log(`⏭️ Skipping voice message without media ID`);
          continue;
        }

        try {
          const mediaRes = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
            headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
          });
          const mediaUrl = mediaRes.data.url;

          const filePath = await downloadVoiceFile(mediaUrl, `wa_voice_${msgId}.ogg`, {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
          });

          const transcript = await transcribeWithWhisper(filePath);
          if (transcript === '__TOO_LONG__') {
            await sendWhatsApp(from, '⚠️ Voice too long (max 30s). Please resend.');
            continue;
          }

          if (!transcript?.trim()) {
            console.log(`⏭️ Skipping voice message with empty transcript`);
            continue;
          }

          const estimatedMinutes = Math.ceil((transcript.length || 1) / 150); // ~150 words/min
          await trackUsage(business.id, 'voice', estimatedMinutes);

          messageText = transcript;
          logConversation({ platform: 'whatsapp', userId: from, message: '[Voice]', aiReply: { reply: transcript }, source: 'voice' });
        } catch (err) {
          console.error(`❌ Error processing WhatsApp voice from ${from}:`, err.message);
          await sendWhatsApp(from, '❌ Sorry, I had trouble processing your voice message. Please try again.');
          continue;
        }
      }

      if (!messageText) continue;
      messageText = xss(messageText.trim().substring(0, 1000));
      console.log(`📲 WhatsApp ${isVoice ? 'Voice' : 'Text'} from ${from}: "${messageText}"`);

      const access = checkAccess(business, { messages: true, feature: 'aiReplies' });
      if (!access.allowed) {
        const reply = getFallback(access.reasons);
        await sendWhatsApp(from, reply);
        logConversation({ platform: 'whatsapp', userId: from, message: '[Text]', aiReply: { reply }, source: 'policy' });
        continue;
      }

      // ⏳ BATCHED TEXT REPLY
      scheduleBatchedReply(from, messageText, { phone_number_id: phoneId }, async (aiReply) => {
        const { reply } = aiReply;
        await sendWhatsApp(from, xss(reply));
        await trackUsage(business.id, 'message');
        logConversation({ platform: 'whatsapp', userId: from, message: '[Batched]', aiReply, source: isVoice ? 'voice' : 'text' });
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ WhatsApp webhook error:', err.response?.data || err.message);
    res.sendStatus(500);
  }
});

async function sendWhatsApp(to, text) {
  try {
    console.log(`📱 Sending WhatsApp message to ${to}`);
    await axios.post(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text }
    }, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ WhatsApp message sent successfully to ${to}`);
  } catch (err) {
    console.error(`❌ WhatsApp send error to ${to}:`, err.response?.data || err.message);
    throw err; // Re-throw to allow calling code to handle
  }
}

module.exports = router;
