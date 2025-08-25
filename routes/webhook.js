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

const { trackUsage } = require('../utils/trackUsage');

const processedMessages = new Set();

function getFallback(reason) {
  

  if (reason.includes('expired')) return '⚠️ Your subscription expired. Please renew.';
  if (reason.includes('inactive')) return '⚠️ Your account is inactive.';
  if (reason.includes('message_limit')) return '⚠️ Message limit reached. Upgrade your plan.';
  if (reason.find(r => r.startsWith('feature:voiceInput'))) return '🎤 Voice not allowed in your plan.';
  if (reason.find(r => r.startsWith('feature:imageAnalysis'))) return '🖼️ Image analysis not allowed in your plan.';

  return '🚫 Access denied.';
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
    console.log('🔍 Full webhook payload:', JSON.stringify(body, null, 2));
    
    if (!body.entry) return res.sendStatus(400);

    for (const entry of body.entry) {
      const pageId = entry.id;
      console.log(`📄 Processing entry for page/account ID: ${pageId}`);
      
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const messageId = event.message?.mid;
        const isInstagram = senderId && senderId.length >= 16;
        console.log(`📨 Message from ${senderId} (Instagram: ${isInstagram})`);
        
        if (!senderId || !event.message || !messageId || event.message.is_echo || processedMessages.has(messageId)) {
          continue;
        }

        processedMessages.add(messageId);
        let messageText = event.message?.text;

        // Load business - Enhanced for new Instagram structure
        let business;
        try {
          if (isInstagram) {
            // For Instagram, try multiple lookup strategies
            console.log(`🔍 Looking up business for Instagram account: ${pageId}`);
            try {
              business = await getBusinessInfo({ instagram_account_id: pageId });
              console.log(`✅ Found business via Instagram account ID: ${pageId}`);
            } catch (e) {
              console.log(`❌ No business found for Instagram account ${pageId}, trying page_id lookup`);
              business = await getBusinessInfo({ page_id: pageId });
              console.log(`✅ Found business via page ID: ${pageId}`);
            }
          } else {
            // For Messenger, use page_id
            business = await getBusinessInfo({ page_id: pageId });
            console.log(`✅ Found business via Messenger page: ${pageId}`);
          }
        } catch (e) {
          console.warn(`⚠️ No business found for ${isInstagram ? 'Instagram account' : 'page'} ${pageId}: ${e.message}`);
          continue;
        }

        // Get appropriate access token for platform
        let token = process.env.PAGE_ACCESS_TOKEN; // Default fallback
        const platform = isInstagram ? 'instagram' : 'messenger';
        
        if (isInstagram) {
          // For Instagram, get the specific page access token
          const fbBusiness = business.channels?.facebook_business;
          if (fbBusiness?.instagram_accounts?.[pageId]) {
            token = fbBusiness.instagram_accounts[pageId].page_access_token;
            console.log(`📱 Using page access token for Instagram account: ${pageId}`);
          } else {
            // Try direct channel reference
            const directChannel = business.channels?.[`instagram_${pageId}`];
            if (directChannel?.page_access_token) {
              token = directChannel.page_access_token;
              console.log(`📱 Using direct channel token for Instagram account: ${pageId}`);
            } else {
              console.warn(`⚠️ No specific token found for Instagram account ${pageId}, using default`);
            }
          }
        }

        // 🎤 VOICE
        const audio = event.message.attachments?.find(att => att.type === 'audio');
        if (audio?.payload?.url) {
          const access = checkAccess(business, { feature: 'voiceInput' });
          if (!access.allowed) {
            const reply = getFallback(access.reasons);
            await respond(platform, senderId, reply, token);
            logConversation({ platform, userId: senderId, message: '[Voice]', aiReply: { reply }, source: 'policy' });
            continue;
          }

          const filePath = await downloadVoiceFile(audio.payload.url, `voice_${messageId}.ogg`);
          const transcript = await transcribeWithWhisper(filePath);
          fs.unlink(filePath, () => {});

          if (transcript === '__TOO_LONG__') {
            const warning = '⚠️ Voice too long. Please resend (max 30s).';

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
            const reply = getFallback(access.reasons);
            await respond(platform, senderId, reply, token);
            logConversation({ platform, userId: senderId, message: '[Image]', aiReply: { reply }, source: 'policy' });
            continue;
          }

          const filePath = await downloadMedia(image.payload.url, `img_${messageId}.jpg`);
          const { reply } = await matchImageAndGenerateReply(senderId, filePath, { page_id: pageId, instagram_account_id: isInstagram ? pageId : null });
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
          const reply = getFallback(access.reasons);
          await respond(platform, senderId, reply, token);
          logConversation({ platform, userId: senderId, message: '[Text]', aiReply: { reply }, source: 'policy' });
          continue;
        }

        // ✅ BATCHED REPLY
        scheduleBatchedReply(senderId, messageText, { 
          page_id: pageId, 
          instagram_account_id: isInstagram ? pageId : null,
          access_token: token 
        }, async (aiReply) => {
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
