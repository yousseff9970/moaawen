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
    
    // 🔍 FULL META API RESPONSE LOGGING
    console.log('\n' + '='.repeat(80));
    console.log('🚀 FULL META WEBHOOK RESPONSE:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(body, null, 2));
    console.log('='.repeat(80) + '\n');
    
    if (!body.entry) return res.sendStatus(400);

    for (const entry of body.entry) {
      const pageId = entry.id;
      console.log(`📋 Webhook entry ID: ${pageId}`);
      console.log(`📄 Full entry object:`, JSON.stringify(entry, null, 2));
      
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const messageId = event.message?.mid;
        
        console.log(`📨 Full messaging event:`, JSON.stringify(event, null, 2));
        
        if (!senderId || !event.message || !messageId || event.message.is_echo || processedMessages.has(messageId)) {
          console.log(`⏭️ Skipping event - senderId: ${senderId}, hasMessage: ${!!event.message}, messageId: ${messageId}, isEcho: ${event.message?.is_echo}, alreadyProcessed: ${processedMessages.has(messageId)}`);
          continue;
        }

        processedMessages.add(messageId);
        let messageText = event.message?.text;

        // 🔍 DETAILED MESSAGE ANALYSIS
        console.log('\n' + '-'.repeat(60));
        console.log('🔍 DETAILED MESSAGE ANALYSIS:');
        console.log('-'.repeat(60));
        console.log(`📋 Entry ID: ${pageId} (length: ${pageId?.length})`);
        console.log(`� Sender ID: ${senderId} (length: ${senderId?.length})`);
        console.log(`📝 Message ID: ${messageId}`);
        console.log(`💬 Text: "${messageText}"`);
        console.log(`📱 Has instagram_actor_id: ${!!event.message?.instagram_actor_id}`);
        if (event.message?.instagram_actor_id) {
          console.log(`📱 Instagram Actor ID: ${event.message.instagram_actor_id}`);
        }
        console.log(`📮 Has postback instagram_id: ${!!event.postback?.instagram_actor_id}`);
        if (event.postback?.instagram_actor_id) {
          console.log(`📮 Postback Instagram ID: ${event.postback.instagram_actor_id}`);
        }
        console.log(`📊 Message attachments:`, event.message?.attachments?.map(att => ({
          type: att.type,
          hasUrl: !!att.payload?.url
        })) || 'None');
        console.log(`🏷️ Message source info:`, {
          isEcho: event.message?.is_echo,
          appId: event.message?.app_id,
          metadata: event.message?.metadata
        });
        console.log('-'.repeat(60) + '\n');

        // Load business - try standard page_id lookup first
        let business;
        try {
          business = await getBusinessInfo({ page_id: pageId });
          console.log(`✅ Business found:`, {
            name: business.name,
            id: business.id,
            hasInstagram: !!business.channels?.instagram,
            instagramConnected: business.channels?.instagram?.connected,
            instagramConnectionType: business.channels?.instagram?.connection_type,
            instagramPageId: business.channels?.instagram?.page_id,
            instagramBusinessAccountId: business.channels?.instagram?.business_account_id,
            hasMessenger: !!business.channels?.messenger,
            messengerPageId: business.channels?.messenger?.page_id
          });
        } catch (e) {
          console.warn(`⚠️ No business found for page ${pageId}`);
          console.warn(`Error details:`, e.message);
          continue;
        }

        // 🎯 PLATFORM DETECTION LOGIC
        console.log('\n' + '-'.repeat(60));
        console.log('🎯 PLATFORM DETECTION LOGIC:');
        console.log('-'.repeat(60));
        
        // Determine platform and token based on message context and business configuration
        let platform = 'messenger'; // Default to messenger
        let token;

        // Check for Instagram message context - Instagram messages have different structure
        const isInstagramMessage = event.message?.instagram_actor_id || 
                                  event.postback?.instagram_actor_id ||
                                  (event.sender?.id && event.sender.id.length >= 16);

        console.log(`🔍 Instagram message indicators:`, {
          hasInstagramActorId: !!event.message?.instagram_actor_id,
          hasPostbackInstagramId: !!event.postback?.instagram_actor_id,
          senderIdLengthCheck: event.sender?.id && event.sender.id.length >= 16,
          overallIsInstagramMessage: isInstagramMessage
        });

        // Priority 1: Check if this is an Instagram message AND business has Instagram configured
        if (isInstagramMessage && business.channels?.instagram?.connected) {
          // For Instagram via Facebook Page (Business Suite), the pageId would be the Facebook Page ID
          // but the message context indicates it's from Instagram
          platform = 'instagram';
          token = business.channels.instagram.access_token;
          console.log(`📱 Platform: instagram (via context detection), Page ID: ${pageId}, Token found: ${token ? 'Yes' : 'No'}`);
        }
        // Priority 2: Check if pageId directly matches Instagram connection IDs
        else if (business.channels?.instagram?.connected && 
                (business.channels.instagram.page_id === pageId || 
                 business.channels.instagram.business_account_id === pageId ||
                 business.channels.instagram.account_id === pageId ||
                 business.channels.instagram.user_id === pageId)) {
          platform = 'instagram';
          token = business.channels.instagram.access_token;
          console.log(`📱 Platform: instagram (direct connection), Page ID: ${pageId}, Token found: ${token ? 'Yes' : 'No'}`);
        }
        // Priority 3: Check if pageId matches Messenger page
        else if (business.channels?.messenger?.page_id === pageId) {
          platform = 'messenger';
          token = business.channels.messenger.access_token;
          console.log(`📱 Platform: messenger (configured), Page ID: ${pageId}, Token found: ${token ? 'Yes' : 'No'}`);
        }
        // Default: Messenger with fallback token
        else {
          platform = 'messenger';
          token = business.channels?.messenger?.access_token || process.env.PAGE_ACCESS_TOKEN;
          console.log(`📱 Platform: messenger (default), Page ID: ${pageId}, Token found: ${token ? 'Yes' : 'No'}`);
        }

        console.log(`🎯 FINAL PLATFORM DECISION: ${platform.toUpperCase()}`);
        console.log(`🔑 Token source: ${token === process.env.PAGE_ACCESS_TOKEN ? 'Environment Variable' : 'Business Channel'}`);
        
        // Detect token type for Instagram
        if (platform === 'instagram' && token) {
          const isInstagramDirectToken = token.startsWith('IG');
          console.log(`🔍 Instagram token type: ${isInstagramDirectToken ? 'Instagram Direct (IG...)' : 'Facebook Graph'}`);
          console.log(`📡 Will use API: ${isInstagramDirectToken ? 'graph.instagram.com' : 'graph.facebook.com'}`);
        }
        
        console.log('-'.repeat(60) + '\n');

        if (!token) {
          console.warn(`⚠️ No access token found for ${platform} on page ${pageId}`);
          console.warn(`Business channels:`, JSON.stringify(business.channels, null, 2));
          continue;
        }

        console.log(`✅ PROCESSING MESSAGE: Business "${business.name}" via ${platform.toUpperCase()} (Page: ${pageId})`);
        console.log(`🔐 Using token: ${token ? token.substring(0, 20) + '...' : 'None'}`);
        console.log(`🔐 Token type: ${token ? (token.startsWith('IG') ? 'Instagram Direct' : 'Facebook Graph') : 'None'}\n`);

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
          const reply = getFallback(access.reasons);
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
