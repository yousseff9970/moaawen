const express = require('express');
const router = express.Router();
const fs = require('fs');
const xss = require('xss');
const { scheduleBatchedReply } = require('../services/openai');
const { sendMessengerMessage, sendInstagramMessage } = require('../services/meta');
const { downloadVoiceFile, transcribeWithWhisper } = require('../services/transcribeVoice');
const { downloadMedia } = require('../services/downloadMedia');
const { matchImageAndGenerateReply } = require('../services/imageMatcher');
const { logConversation } = require('../utils/logger');

const processedMessages = new Set();

// ✅ GET: Webhook verification
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

// ✅ POST: Webhook events
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    if (!body.entry) return res.sendStatus(400);

    for (const entry of body.entry) {
      const pageId = entry.id;
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const messageId = event.message?.mid;
        const isInstagram = senderId.length >= 16;
        const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;

        // 🛑 Skip invalid or duplicate
        if (!senderId || !event.message || !messageId || event.message.is_echo || processedMessages.has(messageId)) {
          continue;
        }

        processedMessages.add(messageId);
        let messageText = event.message?.text;

        // 🎙️ Voice
        const audio = event.message.attachments?.find(att => att.type === 'audio');
        if (audio?.payload?.url) {
          const filePath = await downloadVoiceFile(audio.payload.url, `voice_${messageId}.ogg`);
          const transcript = await transcribeWithWhisper(filePath);

          // Cleanup temp file
          fs.unlink(filePath, () => {});

          if (transcript === '__TOO_LONG__') {
            const warningMsg = '⚠️ Voice message too long (max 30s). Please resend a shorter one.';
            if (isInstagram) {
              await sendInstagramMessage(senderId, warningMsg, pageAccessToken);
            } else {
              await sendMessengerMessage(senderId, warningMsg, pageAccessToken);
            }
            continue;
          }

          if (!transcript?.trim()) continue;

          messageText = transcript;

          // Log voice
          await logConversation({
            platform: isInstagram ? 'instagram' : 'messenger',
            userId: senderId,
            message: '[Voice]',
            aiReply: { reply: transcript },
            source: 'voice'
          });
        }

        // 🖼️ Image (reply immediately)
        const image = event.message.attachments?.find(att => att.type === 'image');
        if (image?.payload?.url) {
          const filePath = await downloadMedia(image.payload.url, `img_${messageId}.jpg`);
          const { reply } = await matchImageAndGenerateReply(senderId, filePath, { page_id: pageId });

          // Cleanup temp file
          fs.unlink(filePath, () => {});

          if (isInstagram) {
            await sendInstagramMessage(senderId, xss(reply), pageAccessToken);
          } else {
            await sendMessengerMessage(senderId, xss(reply), pageAccessToken);
          }

          await logConversation({
            platform: isInstagram ? 'instagram' : 'messenger',
            userId: senderId,
            message: '[Image]',
            reply,
            source: 'image'
          });

          continue;
        }

        if (!messageText) continue;

        // 🛡️ Sanitize and limit message length
        messageText = xss(messageText.trim().substring(0, 1000));

        console.log(`📲 ${isInstagram ? 'Instagram' : 'Messenger'} from ${senderId}: "${messageText}"`);

        // 💬 TEXT/VOICE: Use batching
        scheduleBatchedReply(senderId, messageText, { page_id: pageId }, async (aiReply) => {
          const { reply } = aiReply;

          if (isInstagram) {
            await sendInstagramMessage(senderId, xss(reply), pageAccessToken);
          } else {
            await sendMessengerMessage(senderId, xss(reply), pageAccessToken);
          }

          await logConversation({
            platform: isInstagram ? 'instagram' : 'messenger',
            userId: senderId,
            message: '[Batched]',
            aiReply,
            source: 'text'
          });
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Webhook error:', err.response?.data || err.message);
    res.sendStatus(500);
  }
});

module.exports = router;
