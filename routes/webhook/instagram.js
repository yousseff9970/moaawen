// routes/webhook/instagram.js
const { 
  express, fs, xss, scheduleBatchedReply, downloadVoiceFile, transcribeWithWhisper,
  downloadMedia, matchImageAndGenerateReply, logConversation, getBusinessInfo,
  checkAccess, trackUsage, processedMessages, processedEvents, createEventSignature,
  isDuplicateEvent, getFallback, respond
} = require('./shared');

const router = express.Router();

// ✅ GET: Instagram Webhook verification
router.get('/instagram', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// ✅ POST: Instagram Webhook events
router.post('/instagram', async (req, res) => {
  try {
    const body = req.body;
    console.log('🔍 Full Instagram webhook payload:', JSON.stringify(body, null, 2));
    
    if (!body.entry) return res.sendStatus(400);

    for (const entry of body.entry) {
      const pageId = entry.id;
      //console.log(`📄 Processing Instagram entry for account ID: ${pageId}`);
      
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const messageId = event.message?.mid;
        
        // Skip non-message events (read receipts, delivery confirmations, etc.)
        if (!event.message) {
          //console.log(`⏭️ Skipping non-message event (read/delivery/etc.) from ${senderId}`);
          continue;
        }
        
        // Skip echo messages (messages sent by the bot)
        if (event.message.is_echo) {
          //console.log(`⏭️ Skipping echo message: ${messageId}`);
          continue;
        }
        
        // Skip messages sent by the bot itself (sender ID = page ID)
        if (senderId === pageId) {
         // console.log(`⏭️ Skipping bot's own message from ${senderId}`);
          continue;
        }
        
        // Create event signature for duplicate detection (Instagram-specific)
        const eventSignature = createEventSignature({
          platform: 'instagram',
          account_id: pageId,
          from: senderId,
          timestamp: event.timestamp,
          message_id: messageId,
          content: event.message?.text || 'media'
        });
        
        // Check for duplicate event using signature
        if (processedEvents.has(eventSignature)) {
          //console.log(`⏭️ Skipping duplicate Instagram event: ${eventSignature}`);
          continue;
        }
        
        // Mark event as processed
        processedEvents.add(eventSignature);
        console.log(`✅ Processing new Instagram event: ${eventSignature}`);
        
        // This is an Instagram webhook (object: "instagram"), so process all messages as Instagram
        //console.log(`📨 Instagram message from ${senderId} (Instagram webhook detected)`);
        
        if (!senderId || !messageId) {
          //console.log(`⏭️ Skipping message: senderId=${senderId}, messageId=${messageId}`);
          continue;
        }
        let messageText = event.message?.text;

        // Load business - Instagram lookup using the account ID (pageId)
        let business;
        try {
          //console.log(`🔍 Looking up business for Instagram account: ${pageId}`);
          business = await getBusinessInfo({ instagram_account_id: pageId });
          //console.log(`✅ Found business via Instagram account ID: ${pageId}`);
        } catch (e) {
          console.warn(`⚠️ No business found for Instagram account ${pageId}: ${e.message}`);
          continue;
        }

        // Get Instagram access token from the database
        let token = process.env.PAGE_ACCESS_TOKEN; // Default fallback
        const platform = 'instagram';
        
        // Get the specific Instagram access token from the database
        if (business.channels?.instagram?.access_token) {
          token = business.channels.instagram.access_token;
          //console.log(`📱 Using Instagram access token for account: ${pageId}`);
        } else {
          console.warn(`⚠️ No Instagram access token found for account ${pageId}, using default`);
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
          const { reply } = await matchImageAndGenerateReply(senderId, filePath, { instagram_account_id: pageId });
          fs.unlink(filePath, () => {});

          await trackUsage(business.id, 'image');
          await respond(platform, senderId, xss(reply), token);
          logConversation({ platform, userId: senderId, message: '[Image]', reply, source: 'image' });
          continue;
        }

        if (!messageText) continue;
        messageText = xss(messageText.trim().substring(0, 1000));
        console.log(`📲 Instagram from ${senderId}: "${messageText}"`);

        const access = checkAccess(business, { messages: true, feature: 'aiReplies' });
        if (!access.allowed) {
          const reply = getFallback(access.reasons);
          await respond(platform, senderId, reply, token);
          logConversation({ platform, userId: senderId, message: '[Text]', aiReply: { reply }, source: 'policy' });
          continue;
        }

        // ✅ BATCHED REPLY
        scheduleBatchedReply(senderId, messageText, { 
          instagram_account_id: pageId,
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
    console.error('❌ Instagram webhook error:', err.response?.data || err.message);
    res.sendStatus(500);
  }
});

module.exports = router;
