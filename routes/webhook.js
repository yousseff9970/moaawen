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
const { getBusinessInfo } = require('../services/business');
const { checkAccess } = require('../utils/businessPolicy');
const { detectLanguage } = require('../services/openai');
const { trackUsage } = require('../utils/trackUsage');

const processedMessages = new Set();

function getFallback(reason, lang) {
  const L = (en, ar, az) => lang === 'arabic' ? ar : lang === 'arabizi' ? az : en;

  if (reason.includes('expired')) return L('⚠️ Your subscription expired. Please renew.', '⚠️ اشتراكك انتهى. جدد الاشتراك.', '⚠️ el eshterak khallas. jadded el plan.');
  if (reason.includes('inactive')) return L('⚠️ Your account is inactive.', '⚠️ الحساب غير مفعل.', '⚠️ l hesab mesh mef3al.');
  if (reason.includes('message_limit')) return L('⚠️ Message limit reached. Upgrade your plan.', '⚠️ وصلت للحد الأقصى من الرسائل.', '⚠️ woselna lal 7ad el ma7doud.');
  if (reason.find(r => r.startsWith('feature:voiceInput'))) return L('🎤 Voice not allowed in your plan.', '🎤 الميزة الصوتية غير متوفرة.', '🎤 voice mish bel plan.');
  if (reason.find(r => r.startsWith('feature:imageAnalysis'))) return L('🖼️ Image analysis not allowed in your plan.', '🖼️ تحليل الصور غير متاح.', '🖼️ feature soura mish mashmoula.');

  return L('🚫 Access denied.', '🚫 تم رفض الوصول.', '🚫 mamnou3 l access.');
}

async function respond(platform, id, msg, token) {
  if (platform === 'instagram') {
    await sendInstagramMessage(id, msg, token);
  } else {
    await sendMessengerMessage(id, msg, token);
  }
}

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
        const token = process.env.PAGE_ACCESS_TOKEN;
        const platform = isInstagram ? 'instagram' : 'messenger';

        if (!senderId || !event.message || !messageId || event.message.is_echo || processedMessages.has(messageId)) {
          continue;
        }

        processedMessages.add(messageId);
        let messageText = event.message?.text;

        // Load business
        let business;
        try {
          business = await getBusinessInfo({ page_id: pageId });
        } catch (e) {
          console.warn(`⚠️ No business found for page ${pageId}`);
          continue;
        }

        const lang = detectLanguage(messageText, 'english');

        // 🎤 VOICE
        const audio = event.message.attachments?.find(att => att.type === 'audio');
        if (audio?.payload?.url) {
          const access = checkAccess(business, { feature: 'voiceInput' });
          if (!access.allowed) {
            const reply = getFallback(access.reasons, lang);
            await respond(platform, senderId, reply, token);
            logConversation({ platform, userId: senderId, message: '[Voice]', aiReply: { reply }, source: 'policy' });
            continue;
          }

          const filePath = await downloadVoiceFile(audio.payload.url, `voice_${messageId}.ogg`);
          const transcript = await transcribeWithWhisper(filePath);
          fs.unlink(filePath, () => {});

          if (transcript === '__TOO_LONG__') {
            const warning = lang === 'arabic'
              ? '⚠️ الرسالة الصوتية طويلة. أعد الإرسال أقل من 30 ثانية.'
              : lang === 'arabizi'
              ? '⚠️ voice taweel aktar men 30s. 3id l irsal.'
              : '⚠️ Voice too long. Please resend (max 30s).';

            await respond(platform, senderId, warning, token);
            continue;
          }

          if (!transcript?.trim()) continue;

          const estimatedMinutes = Math.ceil((transcript.length || 1) / 150); // ~150 words/min
          await trackUsage(business.id, 'voice', estimatedMinutes);

          messageText = transcript;
          logConversation({ platform, userId: senderId, message: '[Voice]', aiReply: { reply: transcript }, source: 'voice' });
        }

        // 🖼️ IMAGE
        const image = event.message.attachments?.find(att => att.type === 'image');
        if (image?.payload?.url) {
          const access = checkAccess(business, { feature: 'imageAnalysis' });
          if (!access.allowed) {
            const reply = getFallback(access.reasons, lang);
            await respond(platform, senderId, reply, token);
            logConversation({ platform, userId: senderId, message: '[Image]', aiReply: { reply }, source: 'policy' });
            continue;
          }

          const filePath = await downloadMedia(image.payload.url, `img_${messageId}.jpg`);
          const { reply } = await matchImageAndGenerateReply(senderId, filePath, { page_id: pageId });
          fs.unlink(filePath, () => {});

          await trackUsage(business.id, 'image');
          await respond(platform, senderId, xss(reply), token);
          logConversation({ platform, userId: senderId, message: '[Image]', reply, source: 'image' });
          continue;
        }

        if (!messageText) continue;
        messageText = xss(messageText.trim().substring(0, 1000));
        console.log(`📲 ${platform} from ${senderId}: "${messageText}"`);

        const access = checkAccess(business, { messages: true, feature: 'aiReplies' });
        if (!access.allowed) {
          const reply = getFallback(access.reasons, lang);
          await respond(platform, senderId, reply, token);
          logConversation({ platform, userId: senderId, message: '[Text]', aiReply: { reply }, source: 'policy' });
          continue;
        }

        // ✅ BATCHED REPLY
        scheduleBatchedReply(senderId, messageText, { page_id: pageId }, async (aiReply) => {
          const { reply } = aiReply;
          await respond(platform, senderId, xss(reply), token);
          await trackUsage(business.id, 'message');
          logConversation({ platform, userId: senderId, message: '[Batched]', aiReply, source: 'text' });
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
