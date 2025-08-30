const axios = require('axios');
const path = require('path');
const { getBusinessInfo } = require('./business');
const { matchFAQSmart } = require('./modelMatcher');
const { logToJson } = require('./jsonLog');
const { trackUsage } = require('../utils/trackUsage');
const { 
  buildProductDatabase,
  formatProductDatabaseForAI,
  groupProductsByCategory
} = require('./catalogBuilder');
const { updateSession, getSessionHistory, getSessionSummary } = require('./sessionManager');
const {
  getActiveOrder,

} = require('./orderManager');
const { getMissingInfo, isOrderFlowComplete } = require('../models/Order');
const { processAIOrderActions } = require('./AiOrder');



const replyTimeouts = new Map();
const pendingMessages = new Map();
const generateReply = async (senderId, userMessage, metadata = {}) => {
  const start = Date.now();
  const { phone_number_id, page_id, domain, instagram_account_id, shop } = metadata;

  if (!phone_number_id && !page_id && !domain && !instagram_account_id && !shop) {
    logToJson({
      layer: 'error',
      senderId,
      businessId: null,
      message: userMessage,
      error: 'Missing identifiers (phone_number_id, page_id, domain, instagram_account_id, shop)'
    });
    throw new Error('Unsupported metadata or missing identifiers');
  }

  const business = await getBusinessInfo({ phone_number_id, page_id, domain, instagram_account_id, shop });

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

  // Build comprehensive product database only if products exist
  const hasProducts = business.products && business.products.length > 0;
  let productDatabase = [];
  let formattedProductData = '';
  let categoryOverview = '';
  
  // 🛒 AI-POWERED ORDER FLOW HANDLING - Only if business has products
  let orderContext = '';
  let currentOrder = null;
  
  if (hasProducts) {
    productDatabase = buildProductDatabase(business.products);
    formattedProductData = formatProductDatabaseForAI(productDatabase);
    categoryOverview = groupProductsByCategory(productDatabase);
    
    
    if (productDatabase.length > 0) {
      
      productDatabase.slice(0, 2).forEach(p => {
       
        p.variants.slice(0, 2).forEach(v => {
         
        });
      });
    }
    
    // Determine platform from metadata
    let platform = 'whatsapp'; // default
    if (page_id) platform = 'facebook';
    if (instagram_account_id) platform = 'instagram';
    
    try {
      // Get current order if exists
      currentOrder = await getActiveOrder(senderId, business._id || business.id, platform);
      
      // Build order context for AI
      orderContext = `\n\n=== ORDER CONTEXT ===\n`;
      
      if (currentOrder) {
        orderContext += `Current Order Status: ${currentOrder.orderFlow.stage}\n`;
        orderContext += `Items in Cart: ${currentOrder.items.length}\n`;
        orderContext += `Order Total: $${currentOrder.total || 0}\n`;
        orderContext += `Customer Info Collected:\n`;
        orderContext += `  - Name: ${currentOrder.orderFlow.collectedInfo.hasName ? '✅' : '❌'}\n`;
        orderContext += `  - Phone: ${currentOrder.orderFlow.collectedInfo.hasPhone ? '✅' : '❌'}\n`;
        orderContext += `  - Address: ${currentOrder.orderFlow.collectedInfo.hasAddress ? '✅' : '❌'}\n\n`;
        
        if (currentOrder.items.length > 0) {
          orderContext += `Cart Contents:\n`;
          currentOrder.items.forEach((item, index) => {
            orderContext += `${index + 1}. ${item.productTitle} - ${item.variantName} (Qty: ${item.quantity}) - $${item.totalPrice}\n`;
          });
          orderContext += `\n`;
        }
        
        orderContext += `Missing Information: ${getMissingInfo(currentOrder).join(', ') || 'None'}\n`;
      } else {
        orderContext += `No active order. Ready to start new order.\n`;
      }
      
      orderContext += `=== END ORDER CONTEXT ===\n`;
      
    } catch (error) {
      console.error('Error handling order context:', error);
      orderContext = '\n\n=== ORDER CONTEXT ===\nError loading order information.\n=== END ORDER CONTEXT ===\n';
    }
  }

  // Build dynamic system prompt based on whether business has products
  const basePrompt = `
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
${business.website || 'N/A'}`;

  // Add product-specific content only if products exist
  const productPrompt = hasProducts ? `

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
   - IMPORTANT: never say in stock and out of stock. just show whats availble and dont say anything about out of stock products

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

**PRODUCT-SPECIFIC RULES:**
1. **Always check stock status** before confirming availability
2. **Show prices clearly** including any discounts
3. **Suggest alternatives** if exact request unavailable  
4. **Be conversational and helpful** - don't just list data
5. **Format beautifully** with emojis and structure
6. **Never say in stock or out of stock** 

---

### **🛒 STREAMLINED ORDER CONVERSATION FLOW**

**EFFICIENT ORDER HANDLING APPROACH:**
You are a helpful assistant who can efficiently guide customers through purchases without excessive confirmations.

**1. SMART ORDER DETECTION:**
When customers express buying intent, immediately help them complete their order:
- English: "I want", "I'd like to buy", "can I order", "how do I get", "add to cart"
- Arabic: "بدي اشتري", "كيف اطلب", "ممكن احصل على", "بدي"
- Lebanese: "bade ishtare", "kif adar otlob", "bade"

**2. IMMEDIATE ACTION APPROACH:**
When customers show buying intent:
- **Add products immediately** - don't ask for confirmation unless unclear
- **Collect info as you go** - ask for name, phone, address naturally in conversation
- **Move forward confidently** - trust customer intent and act on it
- **Avoid repetitive confirmations** - one confirmation is enough

**3. STREAMLINED ORDER FLOW:**
- **Step 1**: Customer says they want something → Add it immediately + ask what else they need
- **Step 2**: Collect delivery info naturally in conversation
- **Step 3**: Summarize order and complete it - don't ask "are you sure" multiple times

**4. CONFIDENCE RULES:**
- **Trust customer intent** - if they say they want it, add it
- **Ask once, act on answer** - don't re-confirm repeatedly  
- **Be decisive** - help them complete their order efficiently
- **Only ask for clarification** when genuinely unclear about what they want

**5. AI ORDER ACTIONS FORMAT:**
When you need to perform order actions, use these specific action commands at the end of your response:

**CRITICAL: UNDERSTAND PRODUCT vs VARIANT IDs**
- Each product has a main PRODUCT_ID (e.g., "8057184747709")  
- Each product has multiple VARIANT_IDs (e.g., "45292206129341", "45292206129342")
- NEVER use the same ID for both productId and variantId
- ALWAYS use: ADD_PRODUCT: PRODUCT_ID, VARIANT_ID, quantity

**Available Action Commands:**
- ADD_PRODUCT: productId, variantId, quantity
- UPDATE_INFO: name="value", phone="value", address="value"  
- CONFIRM_ORDER: true
- CANCEL_ORDER: true

**Format Rules:**
- Wrap all actions in: [AI_ORDER_ACTIONS] ... [/AI_ORDER_ACTIONS]
- Use EXACT product and variant IDs from the product database above
- Copy the IDs exactly as shown in the database - DO NOT modify or guess
- One action per line within the action block
- Actions are executed automatically after your response

**EXAMPLE - CORRECT FORMAT:**
[AI_ORDER_ACTIONS]
ADD_PRODUCT: 8057184747709, 45292206129341, 2
UPDATE_INFO: name="John", phone="03123456"
[/AI_ORDER_ACTIONS]

**WRONG - DO NOT DO THIS:**
[AI_ORDER_ACTIONS]
ADD_PRODUCT: 8057184747709, 8057184747709, 2  ← WRONG: Same ID used twice
[/AI_ORDER_ACTIONS]

**6. CONVERSATION EXAMPLES:**

**Efficient Order Handling:**

Customer: "What colors do you have for this shirt?"
AI: "Great question! 😊 This shirt comes in blue, red, pink, and black. The blue is particularly popular. Which color would you like?"

Customer: "بدي القميص الأحمر"
AI: "ممتاز! 😊 أضفت القميص الأحمر لطلبك. أي مقاس تفضل؟ عنا S, M, L, XL"
[AI_ORDER_ACTIONS]
ADD_PRODUCT: {product_id_from_database}, {red_variant_id_from_database}, 1
[/AI_ORDER_ACTIONS]

Customer: "Medium please"
AI: "مثالي! القميص الأحمر مقاس M أضفته لطلبك. شو اسمك ورقم تلفونك للتوصيل؟"
[AI_ORDER_ACTIONS]
ADD_PRODUCT: {product_id_from_database}, {red_medium_variant_id_from_database}, 1
[/AI_ORDER_ACTIONS]

Customer: "I want to buy the blue hoodie"
AI: "Perfect! 😊 I've added the blue hoodie to your order. What size would you like? We have S, M, L, XL available."
[AI_ORDER_ACTIONS]
ADD_PRODUCT: {product_id_from_database}, {blue_variant_id_from_database}, 1
[/AI_ORDER_ACTIONS]

Customer: "My name is John, phone 03-123-456"
AI: "Thanks John! 😊 Just need your delivery address and we'll have your order ready."
[AI_ORDER_ACTIONS]
UPDATE_INFO: name="John", phone="03-123-456"
[/AI_ORDER_ACTIONS]

Customer: "Beirut, Hamra street"
AI: "Perfect! 🎉 Your order is complete:\n- Blue hoodie (Medium) - $25\nTotal: $25\nDelivery to: Beirut, Hamra street\n\nWe'll process this right away!"
[AI_ORDER_ACTIONS]
UPDATE_INFO: address="Beirut, Hamra street"
CONFIRM_ORDER: true
[/AI_ORDER_ACTIONS]

**7. ACTION-ORIENTED INTERACTION RULES:**
- **Be confident and helpful**: When customers want something, help them get it quickly
- **Act on clear intent**: If they say they want to buy, start the order process immediately
- **Minimize confirmations**: Don't ask "are you sure?" multiple times - trust their intent
- **Flow naturally**: Collect info as part of natural conversation, not formal interrogation
- **Complete orders efficiently**: Guide them from interest to completed order smoothly
- **Only clarify when unclear**: Ask questions only when you genuinely don't understand their request
- **Show enthusiasm**: Be excited to help them complete their purchase` : `

**NO PRODUCTS AVAILABLE**
This business does not currently have products in their catalog. Focus on:
- Answering questions about services
- Providing contact information
- Explaining business description and offerings
- Directing customers to contact directly for product inquiries`;

  // Add general rules that apply to all businesses
  const generalRules = `

**EFFICIENT INTERACTION PRINCIPLES:**
1. **Decisive Action**: When customers express buying intent, act immediately to help them
2. **Trust Customer Intent**: If they say they want something, believe them and proceed
3. **Minimize Friction**: Reduce unnecessary confirmations and questions
4. **Smooth Flow**: Guide from interest → selection → info collection → completion
5. **Natural Efficiency**: Be helpful and fast without being robotic

**GENERAL RULES:**
1. **Scope**: Only answer questions about the business, its ${hasProducts ? 'products, ' : ''}services, or general operations
2. **Greetings**: For casual greetings, respond warmly and be genuinely welcoming
3. **Irrelevant Questions**: For unrelated topics, politely redirect to business-related questions with a smile
4. **Response Style**: Be conversational, helpful, warm, and use emojis naturally
5. **Language Consistency**: Always match the user's language and dialect exactly
6. **No Pressure**: Never make customers feel obligated to buy anything${hasProducts ? '' : '\n7. **Product Queries**: If asked about products, explain that the business doesn\'t have an online catalog and provide contact information'}`;

  const systemPrompt = {
    role: 'system',
    content: (basePrompt + productPrompt + generalRules).trim()
  };


  const messages = [
    systemPrompt,
    ...(memorySummary ? [{ role: 'system', content: `Conversation memory summary: ${memorySummary}` }] : []),
    ...(orderContext ? [{ role: 'system', content: orderContext }] : []),
    ...history
  ];

  try {
     const response = await axios.post('https://api.openai.com/v1/responses', {
  model: 'gpt-5-mini',
  input: messages,   
  reasoning: { effort: "medium" }, 
  max_output_tokens: 1600,   
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
  
    // Remove AI action commands from user-facing response
    const cleanReplyText = replyText.replace(/\[AI_ORDER_ACTIONS\].*?\[\/AI_ORDER_ACTIONS\]/gs, '').trim();
    
    const duration = Date.now() - start;

    logToJson({
      layer: 'ai',
      senderId,
      businessId: business.id,
      intent: 'general',
      duration,
      tokens: response.data.usage || {},
      message: userMessage,
      ai_reply: cleanReplyText
    });

    await trackUsage(business.id, 'message');

    // 🤖 AI-POWERED ORDER POST-PROCESSING - Use original response with actions
    try {
      await processAIOrderActions(senderId, business._id || business.id, userMessage, replyText, productDatabase);
    } catch (orderError) {
      console.error('Error processing AI order actions:', orderError);
    }

    updateSession(senderId, 'assistant', cleanReplyText);
    return { reply: cleanReplyText, source: 'ai', layer_used: 'ai', duration };
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
  }, 10000);

  replyTimeouts.set(senderId, timeout);
};


module.exports = { generateReply, scheduleBatchedReply };


