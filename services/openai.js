const axios = require('axios');
const path = require('path');
const { getBusinessInfo } = require('./business');
const { normalize } = require('./normalize');
const { matchModelResponse, matchFAQSmart } = require('./modelMatcher');
const { loadJsonArrayFile, getBusinessModel } = require('../utils/jsonLoader');
const { logToJson } = require('./jsonLog');
const { trackUsage } = require('../utils/trackUsage');
const { buildSmartCatalog } = require('./catalogBuilder');
const { updateSession, getSessionHistory, getSessionSummary } = require('./sessionManager');

const generalModelPath = path.join(__dirname, 'mappings/model_general.json');
const generalModel = loadJsonArrayFile(generalModelPath);

// Batched reply handling - keep in this file
const replyTimeouts = new Map();
const pendingMessages = new Map();

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

  // 🛡️ Plan/access check
  const { checkAccess } = require('../utils/businessPolicy');
  const access = checkAccess(business, { messages: true, feature: 'aiReplies' });

  // If access blocked, reply and exit
  if (!access.allowed) {
    const reason = access.reasons.join(', ');
    const fallbackMessage = '🚫 Your access is restricted. Please contact support.';

    logToJson({
      layer: 'policy',
      senderId,
      businessId: business.id,
      message: userMessage,
      reasons: access.reasons,
      ai_reply: fallbackMessage,
      duration: 0
    });

    return {
      reply: fallbackMessage,
      source: 'policy',
      layer_used: 'plan_check',
      duration: 0
    };
  }

  // Intent/model/FAQ layers
  const normalizedMsg = normalize(userMessage);
  const businessModel = getBusinessModel(business.id);

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

  // Save user message
  updateSession(senderId, 'user', userMessage);

  // Get history for context
  const memorySummary = getSessionSummary(senderId);
  const history = getSessionHistory(senderId).map(({ role, content, timestamp }) => ({ 
    role, 
    content: role === 'user' ? `[Time: ${timestamp || 'unknown'}] ${content}` : content
  }));

  // Product catalog - now using smart catalog
  const productList = buildSmartCatalog(userMessage, business.products || []);

  const systemPrompt = {
    role: 'system',
    content: `
You are Moaawen, the helpful assistant for ${business.name} in Lebanon.

**CRITICAL LANGUAGE INSTRUCTION**
Analyze the user's most recent message and respond in the EXACT SAME LANGUAGE and dialect they used:
- If they wrote in English → respond in English
- If they wrote in Arabic (formal, Lebanese dialect, or Arabizi) → respond in Lebanese Arabic using Arabic script
- If they wrote in Lebanese dialect → respond in Lebanese dialect using Arabic script
- Match their tone, formality, and style naturally

IGNORE all previous conversation languages - only focus on their current message language.

**Memory Handling**
- Use conversation history and memory summary as context to respond accurately
- Refer back to previous user messages when relevant
- If a question was already answered, use that information
- Don't repeat the same questions unnecessarily

📞 **Contact Details**
- Phone: ${business.contact?.phone || 'N/A'}
- Email: ${business.contact?.email || 'N/A'}
- WhatsApp: ${business.contact?.whatsapp || 'N/A'}
- Instagram: ${business.contact?.instagram || 'N/A'}

⚙️ **Description, Services, Benefits & Features**
${business.description || 'N/A'}

🌐 **Website**
${business.website || 'N/A'}

---

### **SMART CATALOG SYSTEM**
🛒 **Product Information** (CONTEXT-AWARE FORMATTING):

${productList || 'N/A'}

**CATALOG USAGE INSTRUCTIONS:**
- The catalog above is automatically sized based on the user's query
- For general inquiries: shows compact overview with key products
- For detailed requests: shows full catalog with variants and specifications
- If user wants more details, suggest they ask for "detailed products" or "full catalog"
- Always use the catalog exactly as provided - don't modify the formatting
- The catalog is already perfectly formatted for the user's intent

### **IMPORTANT RULES**
1) **Scope**
   - Only answer questions about the business, its products, services, or general operations
   - If information is unavailable, provide contact details for follow-up

2) **Greetings**
   - For casual greetings: respond politely & briefly, then guide to business topics

3) **Irrelevant Questions**
   - For unrelated topics: politely redirect to business-related questions

4) **Product Display Rules**
   - ALWAYS use the pre-formatted catalog sections when showing products
   - NEVER create simplified lists or modify the catalog format
   - If showing specific categories, extract the relevant sections with ALL formatting intact
   - If user wants more detail, suggest asking for "detailed products" or "full catalog"

5) **Response Style**
   - Be conversational and helpful
   - When NOT showing the catalog, be concise and clear
   - Guide users to ask for more details if they need comprehensive product information

**FINAL REMINDER: The catalog is smart and automatically adapts to user intent. Use it exactly as provided.**
`.trim()
  };

  const messages = [
    systemPrompt,
    ...(memorySummary ? [{ role: 'system', content: `Conversation memory summary: ${memorySummary}` }] : []),
    ...history
  ];

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.3,
      max_tokens: 1400
    }, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });

    const replyText = response.data.choices[0].message.content;
    const duration = Date.now() - start;

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

    await trackUsage(business.id, 'message');

    updateSession(senderId, 'assistant', replyText);
    return { reply: replyText, source: 'ai', layer_used: 'ai', duration };
  } catch (err) {
    const duration = Date.now() - start;
    const errMsg = err?.response?.data?.error?.message || err.message;

    const fallbackReply = "Sorry, I'm having trouble right now. Please try again or contact us directly.";

    logToJson({
      layer: 'error',
      senderId,
      businessId: business.id,
      duration,
      message: userMessage,
      error: errMsg
    });

    return { reply: fallbackReply, source: 'error', layer_used: 'error', duration };
  }
};

const scheduleBatchedReply = (senderId, userMessage, metadata, onReply) => {
  if (!pendingMessages.has(senderId)) pendingMessages.set(senderId, []);
  pendingMessages.get(senderId).push(userMessage);

  if (replyTimeouts.has(senderId)) clearTimeout(replyTimeouts.get(senderId));

  const timeout = setTimeout(async () => {
    const allMessages = pendingMessages.get(senderId).join('\n');
    pendingMessages.delete(senderId);
    replyTimeouts.delete(senderId);

    const result = await generateReply(senderId, allMessages, metadata);
    onReply(result);
  }, 1000);

  replyTimeouts.set(senderId, timeout);
};

module.exports = { generateReply, scheduleBatchedReply };


