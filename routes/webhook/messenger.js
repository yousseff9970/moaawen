// routes/webhook/messenger.js
const { 
  express, fs, xss, scheduleBatchedReply, downloadVoiceFile, transcribeWithWhisper,
  downloadMedia, matchImageAndGenerateReply, logConversation, getBusinessInfo,
  checkAccess, trackUsage, processedMessages, getFallback, respond
} = require('./shared');

const router = express.Router();

// ✅ GET: Messenger Webhook verification
router.get('/messenger', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// ✅ POST: Messenger Webhook events
router.post('/messenger', async (req, res) => {
  try {
    const body = req.body;
    console.log('🔍 Full Messenger webhook payload:', JSON.stringify(body, null, 2));
    
    if (!body.entry) return res.sendStatus(400);

    for (const entry of body.entry) {
      const pageId = entry.id;
      console.log(`📄 Processing Messenger entry for page ID: ${pageId}`);
      
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const messageId = event.message?.mid;
        
        // Detect Messenger platform - Messenger sender IDs are typically shorter (< 16 chars)
        const isMessenger = senderId && senderId.length < 16;
        console.log(`📨 Message from ${senderId} - Detected platform: ${isMessenger ? 'Messenger' : 'Not Messenger'}`);
        
        // Only process if this is actually a Messenger message
        if (!isMessenger) {
          console.log(`⏭️ Skipping non-Messenger message from ${senderId}`);
          continue;
        }
        
        if (!senderId || !event.message || !messageId || event.message.is_echo) {
          console.log(`⏭️ Skipping message: senderId=${senderId}, messageId=${messageId}, is_echo=${event.message?.is_echo}`);
          continue;
        }

        // Check for duplicate processing
        if (processedMessages.has(messageId)) {
          console.log(`⏭️ Skipping duplicate message: ${messageId}`);
          continue;
        }

        processedMessages.add(messageId);
        console.log(`✅ Processing new Messenger message: ${messageId} from ${senderId}`);
        let messageText = event.message?.text;

        // Load business - Messenger lookup using the page ID
        let business;
        try {
          console.log(`🔍 Looking up business for Messenger page: ${pageId}`);
          business = await getBusinessInfo({ page_id: pageId });
          console.log(`✅ Found business via Messenger page ID: ${pageId}`);
        } catch (e) {
          console.warn(`⚠️ No business found for Messenger page ${pageId}: ${e.message}`);
          continue;
        }

        // Get Messenger access token from the database
        let token = process.env.PAGE_ACCESS_TOKEN; // Default fallback
        const platform = 'messenger';
        
        // Get the specific Messenger access token from the database
        if (business.channels?.messenger?.access_token) {
          token = business.channels.messenger.access_token;
          console.log(`📱 Using Messenger access token for page: ${pageId}`);
        } else {
          console.warn(`⚠️ No Messenger access token found for page ${pageId}, using default`);
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
          const { reply } = await matchImageAndGenerateReply(senderId, filePath, { page_id: pageId });
          fs.unlink(filePath, () => {});

          await trackUsage(business.id, 'image');
          await respond(platform, senderId, xss(reply), token);
          logConversation({ platform, userId: senderId, message: '[Image]', reply, source: 'image' });
          continue;
        }

        if (!messageText) continue;
        messageText = xss(messageText.trim().substring(0, 1000));
        console.log(`📲 Messenger from ${senderId}: "${messageText}"`);

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
    console.error('❌ Messenger webhook error:', err.response?.data || err.message);
    res.sendStatus(500);
  }
});

module.exports = router;
