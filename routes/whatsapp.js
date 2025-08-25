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
      const msgId = msg.id;
      const from = msg.from;
      const isVoice = msg.type === 'audio';
      const isImage = msg.type === 'image';
      let messageText = msg.text?.body;

      if (!from || !msgId || processedMessages.has(msgId)) continue;
      processedMessages.add(msgId);

      // Load business
      let business;
      try {
        business = await getBusinessInfo({ phone_number_id: phoneId });
      } catch (e) {
        console.warn(`⚠️ No business found for phone ${phoneId}`);
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
        if (!mediaId) continue;

        const mediaRes = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
          headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
        });
        const mediaUrl = mediaRes.data.url;

        const filePath = await downloadMedia(mediaUrl, `wa_img_${msgId}.jpg`, {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
        });

        const { reply } = await matchImageAndGenerateReply(from, filePath, { phone_number_id: phoneId });
        await sendWhatsApp(from, xss(reply));

        // ✅ Optional: count image usage
        await trackUsage(business.id, 'image');

        logConversation({ platform: 'whatsapp', userId: from, message: '[Image]', aiReply: { reply }, source: 'image' });
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
        if (!mediaId) continue;

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

        const estimatedMinutes = Math.max(1, Math.round((transcript.length || 0) / 150)); // basic est.
        await trackUsage(business.id, 'voice', estimatedMinutes);

        messageText = transcript;
        logConversation({ platform: 'whatsapp', userId: from, message: '[Voice]', aiReply: { reply: transcript }, source: 'voice' });
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
}

module.exports = router;
