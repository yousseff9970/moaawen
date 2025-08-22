const axios = require('axios');
const path = require('path');
const { getBusinessInfo } = require('./business');
const { normalize } = require('./normalize');
const { matchModelResponse, matchFAQSmart } = require('./modelMatcher');
const { loadJsonArrayFile, getBusinessModel } = require('../utils/jsonLoader');
const { logToJson } = require('./jsonLog');
const { trackUsage } = require('../utils/trackUsage');
const { 
  buildSmartCatalog, 
  buildComprehensiveVariantDatabase, 
  formatVariantDatabaseForAI,
  intelligentVariantSearch,
  createVariantInstructions,
  buildProductDatabase,
  formatProductDatabaseForAI,
  groupProductsByCategory
} = require('./catalogBuilder');
const { updateSession, getSessionHistory, getSessionSummary } = require('./sessionManager');

const generalModelPath = path.join(__dirname, 'mappings/model_general.json');
const generalModel = loadJsonArrayFile(generalModelPath);

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
  
  // Build comprehensive product database
  const productDatabase = buildProductDatabase(business.products || []);
  const formattedProductData = formatProductDatabaseForAI(productDatabase);
  const categoryOverview = groupProductsByCategory(productDatabase);

  const systemPrompt = {
    role: 'system',
    content: `
You are Moaawen, the helpful assistant for ${business.name} in Lebanon.

**CRITICAL LANGUAGE INSTRUCTION**
Analyze the user's most recent message and respond in the EXACT SAME LANGUAGE and dialect they used:
- If they wrote in English → respond in English
- If they wrote in Arabic → respond in Arabic using Arabic script
- If they wrote in Lebanese dialect → respond in Lebanese dialect using Arabic script
- If they wrote in Arabizi → respond in Lebanese Arabic using Arabic script
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

### **COMPLETE PRODUCT DATABASE**
${formattedProductData}

### **CATEGORY OVERVIEW**
${categoryOverview}

**AI PRODUCT INTELLIGENCE INSTRUCTIONS:**

You have COMPLETE access to all product and variant data above. Use your intelligence to:

1. **Understand ANY query about products/variants**:
   - Colors, sizes, materials, prices, availability
   - Product comparisons, recommendations
   - Category browsing, specific searches
   - Stock availability, pricing questions

2. **Handle ALL languages naturally**:
   - Arabic: "عندك قميص أحمر مقاس متوسط؟"
   - English: "Do you have a red shirt in medium?"
   - Lebanese: "fi 3andak qamis a7mar medium?"
   - Mixed: "عندك هاي ال shirt بالblue؟"

3. **Provide intelligent responses**:
   - Exact matches when available
   - Smart alternatives when requested item unavailable
   - Category recommendations
   - Price comparisons
   - Stock status updates

4. **Format responses beautifully**:
   - Use emojis and clear structure
   - Show prices, discounts, stock status
   - Group related items logically
   - Make it scannable and attractive

5. **Be contextually smart**:
   - For general queries → show overview/categories
   - For specific queries → show exact matches
   - For browsing → show relevant selections
   - For comparisons → highlight differences

**RESPONSE EXAMPLES:**

For "What products do you have?":
🛍️ **Our Product Collection**

**Electronics** (15 products, 12 in stock)
- Latest smartphones and accessories
- Audio equipment and headphones

**Clothing** (8 products, 6 in stock) 
- Casual and formal wear
- Various sizes and colors available

*Ask me about specific categories or items!*

For "عندك قميص أحمر؟":
🔍 **Red Shirts Available:**

✅ **Cotton Polo Shirt** - $25
   • Red, Size M/L/XL available
   • 100% cotton, casual fit

✅ **Formal Dress Shirt** - $35 
   • Red, Size S/M/L in stock
   • Slim fit, premium quality

*All items are currently in stock!*

**IMPORTANT RULES:**
1. **Always check stock status** before confirming availability
2. **Show prices clearly** including any discounts
3. **Suggest alternatives** if exact request unavailable  
4. **Match user's language** perfectly
5. **Be conversational and helpful** - don't just list data
6. **Format beautifully** with emojis and structure

Use your AI intelligence to understand what users want and provide the most helpful response using the complete product data above.
`.trim()
  };

  const messages = [
    systemPrompt,
    ...(memorySummary ? [{ role: 'system', content: `Conversation memory summary: ${memorySummary}` }] : []),
    ...history
  ];

  try {
     const response = await axios.post('https://api.openai.com/v1/responses', {
  model: 'gpt-5-mini',
  input: messages,   
  reasoning: { effort: "medium" }, 
  max_output_tokens: 1400,   
    text: {
    verbosity: "low"   
  }

}, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });

    const replyText = response.data.output
  ?.flatMap(o => o.content || [])
  .filter(c => c.type === "output_text")
  .map(c => c.text)
  .join(" ")
  .trim();
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


