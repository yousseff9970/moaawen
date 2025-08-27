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
    
    // 🔥 COMPREHENSIVE WEBHOOK PAYLOAD DUMP
    console.log('\n' + '='.repeat(80));
    console.log('📱 INSTAGRAM WEBHOOK RECEIVED - COMPLETE PAYLOAD DUMP');
    console.log('='.repeat(80));
    console.log('🕐 Timestamp:', new Date().toISOString());
    console.log('📦 Full Raw Payload:', JSON.stringify(body, null, 2));
    console.log('🔍 Webhook Object Type:', body.object);
    console.log('📊 Entry Count:', body.entry?.length || 0);
    
    if (!body.entry) {
      console.log('❌ No entry found in payload');
      console.log('='.repeat(80) + '\n');
      return res.sendStatus(400);
    }

    for (const entry of body.entry) {
      const pageId = entry.id;
      
      // 📋 ENTRY-LEVEL LOGGING
      console.log('\n' + '-'.repeat(60));
      console.log('📄 PROCESSING ENTRY');
      console.log('-'.repeat(60));
      console.log('🆔 Account/Page ID:', pageId);
      console.log('⏰ Entry Time:', entry.time ? new Date(entry.time * 1000).toISOString() : 'N/A');
      console.log('📨 Messaging Events Count:', entry.messaging?.length || 0);
      console.log('📋 Full Entry Object:', JSON.stringify(entry, null, 2));
      
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const recipientId = event.recipient?.id;
        const messageId = event.message?.mid;
        const timestamp = event.timestamp;
        
        // 📋 EVENT-LEVEL LOGGING  
        console.log('\n' + '~'.repeat(40));
        console.log('📨 PROCESSING MESSAGING EVENT');
        console.log('~'.repeat(40));
        console.log('🔗 Event Type Detection:');
        console.log('  📤 Has Message:', !!event.message);
        console.log('  📨 Has Delivery:', !!event.delivery);
        console.log('  👁️ Has Read:', !!event.read);
        console.log('  📍 Has Postback:', !!event.postback);
        console.log('  🔄 Has Referral:', !!event.referral);
        console.log('  ⚡ Has Quick Reply:', !!event.message?.quick_reply);
        console.log('📱 Sender ID:', senderId);
        console.log('🎯 Recipient ID:', recipientId);
        console.log('🆔 Message ID:', messageId);
        console.log('⏰ Timestamp:', timestamp ? new Date(timestamp).toISOString() : 'N/A');
        console.log('📋 Full Event Object:', JSON.stringify(event, null, 2));
        
        // Skip non-message events (read receipts, delivery confirmations, etc.)
        if (!event.message) {
          console.log(`⏭️ SKIPPING: Non-message event (read/delivery/etc.) from ${senderId}`);
          console.log('~'.repeat(40) + '\n');
          continue;
        }
        
        // 💬 MESSAGE-LEVEL DETAILED LOGGING
        console.log('\n' + '*'.repeat(50));
        console.log('💬 MESSAGE DETAILS BREAKDOWN');
        console.log('*'.repeat(50));
        console.log('🔍 Message Analysis:');
        console.log('  📝 Has Text:', !!event.message.text);
        console.log('  📎 Has Attachments:', !!event.message.attachments);
        console.log('  🔄 Is Echo:', !!event.message.is_echo);
        console.log('  ⚡ Has Quick Reply:', !!event.message.quick_reply);
        console.log('  🏷️ Has Sticker ID:', !!event.message.sticker_id);
        
        if (event.message.text) {
          console.log('📝 Message Text:', `"${event.message.text}"`);
          console.log('📏 Text Length:', event.message.text.length);
        }
        
        if (event.message.attachments) {
          console.log('📎 Attachments Count:', event.message.attachments.length);
          event.message.attachments.forEach((attachment, index) => {
            console.log(`  📎 Attachment ${index + 1}:`);
            console.log(`    🔖 Type: ${attachment.type}`);
            console.log(`    🔗 Payload:`, JSON.stringify(attachment.payload, null, 4));
          });
        }
        
        if (event.message.quick_reply) {
          console.log('⚡ Quick Reply:', JSON.stringify(event.message.quick_reply, null, 2));
        }
        
        if (event.message.sticker_id) {
          console.log('🏷️ Sticker ID:', event.message.sticker_id);
        }
        
        console.log('📋 Complete Message Object:', JSON.stringify(event.message, null, 2));
        console.log('*'.repeat(50));
        
        // Skip echo messages (messages sent by the bot)
        if (event.message.is_echo) {
          console.log(`⏭️ SKIPPING: Echo message (sent by bot): ${messageId}`);
          console.log('~'.repeat(40) + '\n');
          continue;
        }
        
        // Skip messages sent by the bot itself (sender ID = page ID)
        if (senderId === pageId) {
          console.log(`⏭️ SKIPPING: Bot's own message from ${senderId}`);
          console.log('~'.repeat(40) + '\n');
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
        
        console.log('\n' + '🔐'.repeat(25));
        console.log('🔐 DUPLICATE DETECTION & PROCESSING');
        console.log('🔐'.repeat(25));
        console.log('🔑 Event Signature:', eventSignature);
        console.log('🔍 Already Processed:', processedEvents.has(eventSignature));
        
        // Check for duplicate event using signature
        if (processedEvents.has(eventSignature)) {
          console.log(`⏭️ SKIPPING: Duplicate Instagram event: ${eventSignature}`);
          console.log('🔐'.repeat(25) + '\n');
          continue;
        }
        
        // Mark event as processed
        processedEvents.add(eventSignature);
        console.log(`✅ PROCESSING: New Instagram event: ${eventSignature}`);
        console.log('🔐'.repeat(25));
        
        // This is an Instagram webhook (object: "instagram"), so process all messages as Instagram
        console.log('\n' + '🚀'.repeat(25));
        console.log('🚀 MESSAGE PROCESSING START');
        console.log('🚀'.repeat(25));
        console.log(`📨 Platform: Instagram`);
        console.log(`👤 Sender: ${senderId}`);
        console.log(`🆔 Message ID: ${messageId}`);
        console.log(`📱 Account ID: ${pageId}`);
        console.log('🚀'.repeat(25));
        
        if (!senderId || !messageId) {
          console.log('\n' + '❌'.repeat(20));
          console.log('❌ VALIDATION ERROR');
          console.log('❌'.repeat(20));
          console.log(`❌ Missing required fields:`);
          console.log(`   senderId: ${senderId}`);
          console.log(`   messageId: ${messageId}`);
          console.log('❌'.repeat(20) + '\n');
          continue;
        }
        let messageText = event.message?.text;

        // Load business - Instagram lookup using the account ID (pageId)
        let business;
        try {
          console.log('\n' + '🏢'.repeat(25));
          console.log('🏢 BUSINESS LOOKUP');
          console.log('🏢'.repeat(25));
          console.log(`🔍 Looking up business for Instagram account: ${pageId}`);
          business = await getBusinessInfo({ instagram_account_id: pageId });
          console.log(`✅ Found business:`, {
            id: business.id,
            name: business.name,
            instagram_account_id: business.instagram_account_id
          });
          console.log('🏢'.repeat(25));
        } catch (e) {
          console.log('\n' + '⚠️'.repeat(20));
          console.log('⚠️ BUSINESS LOOKUP FAILED');
          console.log('⚠️'.repeat(20));
          console.warn(`⚠️ No business found for Instagram account ${pageId}: ${e.message}`);
          console.log('⚠️'.repeat(20) + '\n');
          continue;
        }

        // Get Instagram access token from the database
        let token = process.env.PAGE_ACCESS_TOKEN; // Default fallback
        const platform = 'instagram';
        
        console.log('\n' + '🔑'.repeat(25));
        console.log('🔑 ACCESS TOKEN SETUP');
        console.log('🔑'.repeat(25));
        console.log('🔍 Default token available:', !!process.env.PAGE_ACCESS_TOKEN);
        console.log('🔍 Business has Instagram channel:', !!business.channels?.instagram);
        console.log('🔍 Business has access token:', !!business.channels?.instagram?.access_token);
        
        // Get the specific Instagram access token from the database
        if (business.channels?.instagram?.access_token) {
          token = business.channels.instagram.access_token;
          console.log(`✅ Using business-specific Instagram access token for account: ${pageId}`);
        } else {
          console.warn(`⚠️ No Instagram access token found for account ${pageId}, using default`);
        }
        console.log('🔑'.repeat(25));

        // 🎤 VOICE
        const audio = event.message.attachments?.find(att => att.type === 'audio');
        if (audio?.payload?.url) {
          console.log('\n' + '🎤'.repeat(25));
          console.log('🎤 VOICE MESSAGE PROCESSING');
          console.log('🎤'.repeat(25));
          console.log('🔗 Audio URL:', audio.payload.url);
          console.log('📋 Audio Attachment:', JSON.stringify(audio, null, 2));
          
          const access = checkAccess(business, { feature: 'voiceInput' });
          if (!access.allowed) {
            console.log('❌ Voice input not allowed:', access.reasons);
            const reply = getFallback(access.reasons);
            await respond(platform, senderId, reply, token);
            logConversation({ platform, userId: senderId, message: '[Voice]', aiReply: { reply }, source: 'policy' });
            console.log('🎤'.repeat(25) + '\n');
            continue;
          }

          const filePath = await downloadVoiceFile(audio.payload.url, `voice_${messageId}.ogg`);
          console.log('📁 Downloaded voice file:', filePath);
          
          const transcript = await transcribeWithWhisper(filePath);
          console.log('📝 Voice transcript:', transcript);
          fs.unlink(filePath, () => {});

          if (transcript === '__TOO_LONG__') {
            const warning = '⚠️ Voice too long. Please resend (max 30s).';
            await respond(platform, senderId, warning, token);
            console.log('🎤'.repeat(25) + '\n');
            continue;
          }

          if (!transcript?.trim()) {
            console.log('❌ Empty transcript, skipping');
            console.log('🎤'.repeat(25) + '\n');
            continue;
          }

          const estimatedMinutes = Math.ceil((transcript.length || 1) / 150); // ~150 words/min
          await trackUsage(business.id, 'voice', estimatedMinutes);
          console.log('📊 Tracked voice usage:', estimatedMinutes, 'minutes');

          messageText = transcript;
          logConversation({ platform, userId: senderId, message: '[Voice]', aiReply: { reply: transcript }, source: 'voice' });
          console.log('✅ Voice message processed successfully');
          console.log('🎤'.repeat(25));
        }

        // 🖼️ IMAGE
        const image = event.message.attachments?.find(att => att.type === 'image');
        if (image?.payload?.url) {
          console.log('\n' + '🖼️'.repeat(25));
          console.log('🖼️ IMAGE MESSAGE PROCESSING');
          console.log('🖼️'.repeat(25));
          console.log('🔗 Image URL:', image.payload.url);
          console.log('📋 Image Attachment:', JSON.stringify(image, null, 2));
          
          const access = checkAccess(business, { feature: 'imageAnalysis' });
          if (!access.allowed) {
            console.log('❌ Image analysis not allowed:', access.reasons);
            const reply = getFallback(access.reasons);
            await respond(platform, senderId, reply, token);
            logConversation({ platform, userId: senderId, message: '[Image]', aiReply: { reply }, source: 'policy' });
            console.log('🖼️'.repeat(25) + '\n');
            continue;
          }

          const filePath = await downloadMedia(image.payload.url, `img_${messageId}.jpg`);
          console.log('📁 Downloaded image file:', filePath);
          
          const { reply } = await matchImageAndGenerateReply(senderId, filePath, { instagram_account_id: pageId });
          console.log('🤖 Generated image reply:', reply);
          
          fs.unlink(filePath, () => {});

          await trackUsage(business.id, 'image');
          await respond(platform, senderId, xss(reply), token);
          logConversation({ platform, userId: senderId, message: '[Image]', reply, source: 'image' });
          console.log('✅ Image message processed successfully');
          console.log('🖼️'.repeat(25) + '\n');
          continue;
        }

        if (!messageText) {
          console.log('\n' + '⚠️'.repeat(20));
          console.log('⚠️ NO TEXT MESSAGE CONTENT');
          console.log('⚠️'.repeat(20));
          console.log('⚠️ No text content to process, skipping');
          console.log('⚠️'.repeat(20) + '\n');
          continue;
        }
        
        messageText = xss(messageText.trim().substring(0, 1000));
        
        console.log('\n' + '�'.repeat(25));
        console.log('💬 TEXT MESSAGE PROCESSING');
        console.log('💬'.repeat(25));
        console.log(`📝 Original text: "${event.message.text}"`);
        console.log(`📝 Processed text: "${messageText}"`);
        console.log(`📏 Text length: ${messageText.length}`);
        console.log(`👤 From: ${senderId}`);
        console.log(`📱 Platform: ${platform}`);
        console.log('💬'.repeat(25));

        const access = checkAccess(business, { messages: true, feature: 'aiReplies' });
        
        console.log('\n' + '🔐'.repeat(25));
        console.log('🔐 ACCESS CONTROL CHECK');
        console.log('🔐'.repeat(25));
        console.log('✅ Access allowed:', access.allowed);
        console.log('📝 Access reasons:', access.reasons);
        console.log('🔐'.repeat(25));
        
        if (!access.allowed) {
          console.log('\n' + '❌'.repeat(20));
          console.log('❌ ACCESS DENIED');
          console.log('❌'.repeat(20));
          const reply = getFallback(access.reasons);
          console.log('📝 Fallback reply:', reply);
          await respond(platform, senderId, reply, token);
          logConversation({ platform, userId: senderId, message: '[Text]', aiReply: { reply }, source: 'policy' });
          console.log('❌'.repeat(20) + '\n');
          continue;
        }

        // ✅ BATCHED REPLY
        console.log('\n' + '🚀'.repeat(25));
        console.log('🚀 SCHEDULING BATCHED REPLY');
        console.log('🚀'.repeat(25));
        console.log('📝 Message for batching:', messageText);
        console.log('🆔 Sender ID:', senderId);
        console.log('📱 Account ID:', pageId);
        console.log('🔑 Access Token:', token ? 'Available' : 'Missing');
        console.log('🚀'.repeat(25));
        
        scheduleBatchedReply(senderId, messageText, { 
          instagram_account_id: pageId,
          access_token: token 
        }, async (aiReply) => {
          console.log('\n' + '🤖'.repeat(25));
          console.log('🤖 BATCHED REPLY CALLBACK');
          console.log('🤖'.repeat(25));
          console.log('📝 AI Reply:', JSON.stringify(aiReply, null, 2));
          const { reply } = aiReply;
          console.log('📤 Sending reply:', reply);
          
          await respond(platform, senderId, xss(reply), token);
          await trackUsage(business.id, 'message');
          logConversation({ platform, userId: senderId, message: '[Batched]', aiReply, source: 'text' });
          
          console.log('✅ Batched reply sent successfully');
          console.log('🤖'.repeat(25) + '\n');
        });
        
        console.log('✅ Message processing completed for this event');
        console.log('~'.repeat(40) + '\n');
      }
      console.log('-'.repeat(60));
      console.log('✅ ENTRY PROCESSING COMPLETED');
      console.log('-'.repeat(60) + '\n');
    }

    console.log('='.repeat(80));
    console.log('✅ INSTAGRAM WEBHOOK PROCESSING COMPLETED SUCCESSFULLY');
    console.log('='.repeat(80) + '\n');
    res.sendStatus(200);
  } catch (err) {
    console.log('\n' + '💥'.repeat(30));
    console.log('💥 INSTAGRAM WEBHOOK ERROR');
    console.log('💥'.repeat(30));
    console.error('❌ Error details:', err.response?.data || err.message);
    console.error('❌ Full error:', err);
    console.log('💥'.repeat(30) + '\n');
    res.sendStatus(500);
  }
});

module.exports = router;
