const axios = require('axios');
const path = require('path');
const { getBusinessInfo } = require('./business');
const { normalize } = require('./normalize');
const { matchModelResponse, matchFAQSmart } = require('./modelMatcher');
const { loadJsonArrayFile, getBusinessModel } = require('../utils/jsonLoader');
const { logToJson } = require('./jsonLog');

const sessionHistory = new Map();
const sessionTimeouts = new Map();
const replyTimeouts = new Map();
const pendingMessages = new Map();
const summaries = new Map(); // Store long-term memory summaries

const generalModelPath = path.join(__dirname, 'mappings/model_general.json');
const generalModel = loadJsonArrayFile(generalModelPath);

function updateSession(senderId, role, content) {
  if (!sessionHistory.has(senderId)) sessionHistory.set(senderId, []);
  const history = sessionHistory.get(senderId);
  history.push({ role, content });
  if (history.length > 20) {
  
  const oldMessages = history.splice(0, history.length - 20);
  const summaryText = oldMessages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join(' ')
    .slice(0, 1200); // limit length

  const previousSummary = summaries.get(senderId) || '';
  summaries.set(senderId, `${previousSummary} ${summaryText}`.trim());
}

  // Reset timer (10 min)
  if (sessionTimeouts.has(senderId)) {
    clearTimeout(sessionTimeouts.get(senderId));
  }

  const timeout = setTimeout(() => {
    sessionHistory.delete(senderId);
    sessionTimeouts.delete(senderId);
    console.log(`🗑️ Cleared session history for ${senderId} after 10 min`);
  }, 10 * 60 * 1000); // 10 min (corrected)


  sessionTimeouts.set(senderId, timeout);
}

const generateReply = async (senderId, userMessage, metadata = {}) => {
  const start = Date.now();
  const { phone_number_id, page_id, domain } = metadata;

  if (!phone_number_id && !page_id && !domain) {
    logToJson({
      layer: 'error',
      senderId,
      businessId: null,
      message: userMessage,
      error: 'Missing identifiers (phone_number_id, page_id, domain)'
    });
    throw new Error('Unsupported metadata or missing identifiers');
  }

  const business = await getBusinessInfo({ phone_number_id, page_id, domain });
  const normalizedMsg = normalize(userMessage);
  const businessModel = getBusinessModel(business.id);

  const { startOrder, get: getOrder, advance, clear } = require('../utils/orderState');
  const shopifyClient = require('../utils/shopifyClient');

  const wantsToOrder = /order|buy|purchase|أطلب|بدي اشتري|بدي اطلب/i.test(userMessage);
  const orderSession = getOrder(senderId);

  if (!orderSession && wantsToOrder && business.products?.length) {
    const match = business.products.find(p => p.variants?.[0]?.inStock);
    if (match) {
      startOrder(senderId, {
        id: match.variants[0].id,
        title: match.title,
        price: match.variants[0].price
      });
      return { reply: `What is your name please?`, source: 'order_wizard', layer_used: 'order_flow' };
    }
  }

  if (orderSession) {
    if (orderSession.step === 'need_name') {
      advance(senderId, 'name', userMessage.trim());
      return { reply: 'Whats your phone number?', source: 'order_wizard', layer_used: 'order_flow' };
    }
    if (orderSession.step === 'need_phone') {
      advance(senderId, 'phone', userMessage.trim());
      return { reply: 'Okay, now please provide us with your full address in details.', source: 'order_wizard', layer_used: 'order_flow' };
    }
    if (orderSession.step === 'need_address') {
      advance(senderId, 'address', userMessage.trim());
    }

    if (orderSession.step === 'ready') {
      try {
        const client = shopifyClient(business.shop, business.accessToken);
        const order = await client.createOrder({
          variant_id: orderSession.variant.id,
          email: `${orderSession.data.phone}@autobot.local`,
          name: orderSession.data.name,
          phone: orderSession.data.phone,
          address: orderSession.data.address
        });

        clear(senderId);

        // Extract order details
        const orderNumber = order.order_number;
        const status = order.fulfillment_status || 'Processing...';
        const trackUrl = order.order_status_url || '';

        return {
          reply: `✅ Your order for **${orderSession.variant.title}** has been created successfully!\n\n` +
                 `🔢 Order Number: **${orderNumber}**\n` +
                 `📦 Order Status: **${status}**\n` +
                 (trackUrl ? `🌐 Track your order: ${trackUrl}` : ''),
          source: 'shopify',
          layer_used: 'order_created'
        };

      } catch (e) {
        const errorData = e.response?.data?.errors;
        console.error('Shopify order error:', errorData);
        throw new Error(`Shopify order creation failed: ${JSON.stringify(errorData)}`);
      }
    }
  }

  const modelMatch = matchModelResponse(normalizedMsg, businessModel);
  if (modelMatch) {
    const duration = Date.now() - start;
    logToJson({
      layer: 'model_business',
      senderId,
      businessId: business.id,
      intent: modelMatch.intent,
      language: modelMatch.language,
      duration,
      message: userMessage,
      matchedWith: normalizedMsg,
      ai_reply: modelMatch.reply
    });
    return { reply: modelMatch.reply, source: 'model', layer_used: 'model_business', duration };
  }

  const generalMatch = matchModelResponse(normalizedMsg, generalModel);
  if (generalMatch) {
    const duration = Date.now() - start;
    logToJson({
      layer: 'model_general',
      senderId,
      businessId: business.id,
      intent: generalMatch.intent,
      duration,
      message: userMessage,
      matchedWith: normalizedMsg,
      ai_reply: generalMatch.reply
    });
    return { reply: generalMatch.reply, source: 'model', layer_used: 'model_general', duration };
  }

  const faqAnswer = matchFAQSmart(userMessage, business.faqs || []);
  if (faqAnswer) {
    const duration = Date.now() - start;
    logToJson({
      layer: 'faq',
      senderId,
      businessId: business.id,
      duration,
      message: userMessage,
      matched: true,
      ai_reply: faqAnswer
    });
    return { reply: faqAnswer, source: 'faq', layer_used: 'faq', duration };
  }

  updateSession(senderId, 'user', userMessage);

  const productList = (business.products || []).map((p, i) => {
    const variant = p.variants?.[0] || {};
    const price = variant.price ? `$${variant.price}` : 'Price not available';
    const stockStatus = variant.inStock === false ? '❌ Out of stock' : '✅ In stock';

    return `${i + 1}. **${p.title}**\n   - Price: ${price}\n   - ${stockStatus}\n   - Description: ${p.description || 'No description.'}`;
  }).join('\n\n');

  const systemPrompt = {
    role: 'system',
    content: `
You are Moaawen, the helpful assistant for ${business.name} in Lebanon.  
Use the conversation history and memory summary as context to respond accurately.  

**Memory Handling:**  
- Refer back to previous user messages whenever relevant.  
- If a question was already answered, use that information instead of asking again.  
- If you are unsure or the info is missing, politely ask for clarification.  
- Do not repeat the same questions unnecessarily.  

---

📞 **Contact Details:**  
- Phone: ${business.contact?.phone || 'N/A'}  
- Email: ${business.contact?.email || 'N/A'}  
- WhatsApp: ${business.contact?.whatsapp || 'N/A'}  
- Instagram: ${business.contact?.instagram || 'N/A'}  



⚙️ **Description, Services, Benefits & Features:**  
${business.description || 'N/A'}  

🌐 **Website:**  
${business.website || 'N/A'}  

---

### **IMPORTANT RULES**

1. **Scope:**  
   - Only answer questions about the business, its products, services, or general operations.  
   - If the user asks for information not in your context, politely state it’s unavailable and provide phone/email for follow-up:  
     > "I’m sorry, I don’t have that information right now. Please contact us at ${business.contact?.phone || 'N/A'} or ${business.contact?.email || 'N/A'} for more details."  

2. **Greetings:**  
   - For casual greetings (e.g., “Hi”, “Good morning”, “كيفك”): respond politely & briefly, then guide the user back to the business:  
     > "I’m doing well, thank you! How can I assist you with ${business.name} today?"

3. **Irrelevant Questions:**  
   - For topics like politics, religion, news, life advice, or anything unrelated:  
     > "I can only answer questions related to ${business.name}. How can I assist you today?"

4. **Response Style:**  
   - Be structured and organized (use paragraphs and bullet points when needed).  
   - Be concise but clear.  

5. **Language:**  
   - If the user’s message is mainly in English → Reply in English.  
   - If the user’s message is in Arabic (script or Arabizi/Lebglish) → Reply in **Lebanese Arabic using Arabic script**.  
     - Make it sound informal, natural, and authentically Lebanese.  
     - Even if user writes Arabizi (Latin letters with numbers), your response should be in Arabic script.
6. Language Rule (strict):
   - If the user message is mainly English: **ALWAYS reply in English.**
   - If the user message is Arabic (script or Arabizi): **ALWAYS reply in Lebanese Arabic (Arabic script).**
   - This rule overrides all others.


`.trim()
  };

  const memorySummary = summaries.get(senderId) || '';


const isEnglish = /^[A-Za-z0-9\s.,!?'"-]+$/.test(userMessage.trim());
const languageInstruction = isEnglish
  ? "The user is speaking in English. Reply in English."
  : "The user is speaking Arabic or Arabizi. Reply in Lebanese Arabic, using Arabic script.";

const messages = [
  { role: "system", content: languageInstruction },
  systemPrompt,
  ...(memorySummary 
    ? [{ role: 'system', content: `Conversation memory summary: ${memorySummary}` }]
    : []),
  ...(sessionHistory.get(senderId) || [])
];



  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4.1-mini',
      messages,
      temperature: 0.5,
      max_tokens: 1200
    }, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });

    const replyText = response.data.choices[0].message.content;
    const duration = Date.now() - start;

    // Log AI reply too
    logToJson({
      layer: 'ai',
      senderId,
      businessId: business.id,
      intent: 'general',
      duration,
      tokens: response.data.usage || {},
      message: userMessage,
      ai_reply: replyText
    });

    updateSession(senderId, 'assistant', replyText);
    return { reply: replyText, source: 'ai', layer_used: 'ai', duration };
  } catch (err) {
    const duration = Date.now() - start;
    logToJson({
      layer: 'error',
      senderId,
      businessId: business.id,
      duration,
      message: userMessage,
      error: err.response?.data?.error?.message || err.message
    });
    return { reply: 'عذرًا، لم أفهم تمامًا. ممكن توضّح أكثر؟', source: 'error', layer_used: 'error', duration };
  }
};

const scheduleBatchedReply = (senderId, userMessage, metadata, onReply) => {
  if (!pendingMessages.has(senderId)) {
    pendingMessages.set(senderId, []);
  }
  pendingMessages.get(senderId).push(userMessage);

  if (replyTimeouts.has(senderId)) {
    clearTimeout(replyTimeouts.get(senderId));
  }

  const timeout = setTimeout(async () => {
    const allMessages = pendingMessages.get(senderId).join('\n');
    pendingMessages.delete(senderId);
    replyTimeouts.delete(senderId);

    const result = await generateReply(senderId, allMessages, metadata);
    onReply(result);
  }, 1000); // 1s

  replyTimeouts.set(senderId, timeout);
};

module.exports = { generateReply, scheduleBatchedReply };
