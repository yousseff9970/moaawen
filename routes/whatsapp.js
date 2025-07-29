const express = require('express');
const router = express.Router();
const axios = require('axios');
const { scheduleBatchedReply } = require('../services/openai');
const { downloadVoiceFile, transcribeWithWhisper } = require('../services/transcribeVoice');
const { logConversation } = require('../utils/logger');
const { downloadMedia } = require('../services/downloadMedia');
const { matchImageAndGenerateReply } = require('../services/imageMatcher');
const xss = require('xss'); // ✅ Add XSS sanitizer

const processedMessages = new Set();

// Webhook verification
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

// Webhook handler
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

      // 🖼️ Handle Image
      if (isImage) {
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

        await axios.post(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
          messaging_product: 'whatsapp',
          to: from,
          type: 'text',
          text: { body: reply }
        }, {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });

        await logConversation({
          platform: 'whatsapp',
          userId: from,
          message: '[Image]',
          aiReply: { reply },
          source: 'image'
        });

        continue;
      }

      // 🎙️ Handle Voice
      if (isVoice) {
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
          await axios.post(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
            messaging_product: 'whatsapp',
            to: from,
            type: 'text',
            text: { body: '⚠️ Voice message too long (max 30s). Please resend a shorter one.' }
          }, {
            headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
          });
          continue;
        }

        messageText = transcript;
      }

      

      if (!messageText) continue;
messageText = messageText.trim().substring(0, 1000);
messageText = xss(messageText);
      console.log(`📲 WhatsApp ${isVoice ? 'Voice' : 'Text'} from ${from}: "${messageText}"`);

      // ⏳ BATCHED REPLY AFTER DELAY
      scheduleBatchedReply(from, messageText, { phone_number_id: phoneId }, async (aiReply) => {
        const { reply } = aiReply;

        await axios.post(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
          messaging_product: 'whatsapp',
          to: from,
          type: 'text',
          text: { body: xss(reply) }
        }, {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });

        await logConversation({
          platform: 'whatsapp',
          userId: from,
          message: '[Batched]',
          aiReply,
          source: isVoice ? 'voice' : 'text'
        });
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ WhatsApp webhook error:', err.response?.data || err.message);
    res.sendStatus(500);
  }
});

module.exports = router;
