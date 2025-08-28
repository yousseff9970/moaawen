const axios = require('axios');
const path = require('path');
const { getBusinessInfo } = require('./business');
const { normalize } = require('./normalize');
const { matchModelResponse, matchFAQSmart } = require('./modelMatcher');
const { loadJsonArrayFile, getBusinessModel } = require('../utils/jsonLoader');
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
  addItemToOrder,
  removeItemFromOrder,
  updateCustomerInfo,
  confirmOrder,
  cancelOrder,
  getOrderSummary
} = require('./orderManager');
const { getMissingInfo, isOrderFlowComplete } = require('../models/Order');



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
    
    // Debug: Log product database to verify correct IDs
    console.log(`Product database built for business ${business.name}:`);
    console.log(`Number of products: ${productDatabase.length}`);
    if (productDatabase.length > 0) {
      console.log(`Sample product structure:`);
      productDatabase.slice(0, 2).forEach(p => {
        console.log(`  Product ID: ${p.id} | Title: ${p.title}`);
        p.variants.slice(0, 2).forEach(v => {
          console.log(`    Variant ID: ${v.id} | Name: ${v.name} | Price: $${v.price}`);
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

/**
 * AI-Powered Order Action Processor
 * Processes the AI response to extract and execute order actions
 */
/**
 * AI-Powered Order Action Processor (hardened)
 * - Normalizes IDs (strings)
 * - Robust action parsing
 * - Smart repair when productId === variantId or variant invalid
 * - Platform-agnostic confirmation
 */
async function processAIOrderActions(senderId, businessId, userMessage, aiResponse, productDatabase) {
  try {
    if (!Array.isArray(productDatabase) || productDatabase.length === 0) return;

    // -------- helpers --------
    const toId = (v) => String(v ?? '').trim().replace(/^"|"$/g, '');
    const toQty = (v) => {
      const m = String(v ?? '').match(/\d+/);
      const n = m ? parseInt(m[0], 10) : 1;
      return n > 0 ? n : 1;
    };
    const findProduct = (pid) => productDatabase.find(p => String(p.id) === String(pid));
    const findVariant = (prod, vid) => prod?.variants.find(v => String(v.id) === String(vid));
    const firstAvailableVariant = (prod) => prod?.variants?.find(v => v.inStock !== false) || prod?.variants?.[0];

    const actionMatch = aiResponse.match(/\[AI_ORDER_ACTIONS\](.*?)\[\/AI_ORDER_ACTIONS\]/s);
 if (!actionMatch) {
  // Try structured AI analysis first, then fall back to simple keyword matcher
  await processWithAIIntelligence(senderId, businessId, userMessage, aiResponse, productDatabase)
    .catch(e => console.error('AI analysis failed:', e));
  await fallbackProductMatching(senderId, businessId, userMessage, productDatabase);
  return;
}


    const actions = actionMatch[1].trim();
    const actionLines = actions.split('\n').map(l => l.trim()).filter(Boolean);

    for (const line of actionLines) {
      // ------------- ADD_PRODUCT -------------
      if (line.toUpperCase().startsWith('ADD_PRODUCT:')) {
        // lenient parsing: allow quotes/spaces/extra commas
        const raw = line.slice('ADD_PRODUCT:'.length).trim();
        const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
        const rawPid = parts[0];
        const rawVid = parts[1];
        const rawQty = parts[2];

        const productId = toId(rawPid);
        const variantId = rawVid ? toId(rawVid) : '';
        const quantity = toQty(rawQty);

        console.log(`Processing ADD_PRODUCT: productId=${productId}, variantId=${variantId}, quantity=${quantity}`);

        // product = variant mistake → auto-pick a valid variant
        if (productId && variantId && productId === variantId) {
          console.log(`AI used same ID for product and variant (${productId}) - attempting to fix...`);
          const prod = findProduct(productId);
          const chosen = firstAvailableVariant(prod);
          if (prod && chosen) {
            try {
              await addItemToOrder(senderId, businessId, String(prod.id), String(chosen.id), quantity);
              console.log(`Auto-corrected with variant ${chosen.id} for product ${prod.id}`);
              continue;
            } catch (e) {
              console.error('Error adding corrected product:', e);
              // fall through to normal flow
            }
          }
        }

        // validate product
        const prod = findProduct(productId);
        if (!prod) {
          console.error(`AI sent invalid product ID: ${productId}`);
          console.error('Available product IDs:', productDatabase.map(p => String(p.id)));

          // try fallback by understanding the user message
          const productMatch = findProductByUserMessage(userMessage, productDatabase);
          if (productMatch) {
            try {
              await addItemToOrder(
                senderId,
                businessId,
                String(productMatch.productId),
                String(productMatch.variantId),
                quantity
              );
              console.log(`Successfully added fallback product: ${productMatch.productTitle}`);
            } catch (e) {
              console.error('Error adding fallback product:', e);
            }
          } else {
            console.error(`No fallback product found for user message: "${userMessage}"`);
          }
          continue;
        }

        // validate / infer variant
        let variant = variantId ? findVariant(prod, variantId) : null;
        if (!variant) {
          console.error(`AI sent invalid/missing variant ID: ${variantId} for product: ${productId}`);
          // 1) try to infer from message (size/color)
          const inferred = matchProductFromMessage(userMessage, [prod]);
          if (inferred && String(inferred.variantId)) {
            variant = findVariant(prod, inferred.variantId);
          }
          // 2) otherwise first available
          if (!variant) {
            variant = firstAvailableVariant(prod);
          }
          if (!variant) {
            console.error(`No variants available to add for product ${productId}`);
            await processWithAIIntelligence(senderId, businessId, userMessage, aiResponse, productDatabase)
  .catch(e => console.error('AI analysis repair failed:', e));

            continue;
          }
        }

        try {
          await addItemToOrder(senderId, businessId, String(prod.id), String(variant.id), quantity);
        } catch (e) {
          console.error('Error adding AI product to order:', e);
        }
      }

      // ------------- UPDATE_INFO -------------
      else if (line.toUpperCase().startsWith('UPDATE_INFO:')) {
        const infoData = line.slice('UPDATE_INFO:'.length).trim();
        const customerInfo = parseCustomerInfo(infoData);
        if (customerInfo && Object.keys(customerInfo).length > 0) {
          try {
            await updateCustomerInfo(senderId, businessId, customerInfo);
          } catch (e) {
            console.error('Error updating AI customer info:', e);
          }
        }
      }

      // ------------- CONFIRM_ORDER -------------
      else if (line.toUpperCase().startsWith('CONFIRM_ORDER:') && /true/i.test(line)) {
        try {
          // platform-agnostic lookup (don't force 'whatsapp')
          const currentOrder = await getActiveOrder(senderId, businessId);
          if (!currentOrder || !Array.isArray(currentOrder.items) || currentOrder.items.length === 0) {
            console.error('Cannot confirm order: No items in cart');
            continue;
          }
          const result = await confirmOrder(senderId, businessId);
          console.log(`Order confirmed successfully: ${result?.orderId || 'N/A'}`);
        } catch (e) {
          console.error('Error confirming AI order:', e);
        }
      }

      // ------------- CANCEL_ORDER -------------
      else if (line.toUpperCase().startsWith('CANCEL_ORDER:') && /true/i.test(line)) {
        try {
          await cancelOrder(senderId, businessId);
        } catch (e) {
          console.error('Error cancelling AI order:', e);
        }
      }
    }
  } catch (error) {
    console.error('Error in processAIOrderActions:', error);
  }
}


/**
 * Use AI to intelligently analyze the conversation and determine actions
 */
async function processWithAIIntelligence(senderId, businessId, userMessage, aiResponse, productDatabase) {
  try {
    if (!Array.isArray(productDatabase) || productDatabase.length === 0) return;

    // ---------- Build analysis prompt ----------
    const analysisPrompt = {
      role: 'system',
      content: `You are an AI Order Analysis System. Analyze the user message and AI response to determine what order actions should be taken.

**IMPORTANT: PRODUCT STRUCTURE UNDERSTANDING**
Each product has:
- A parent product ID (e.g., "8057183568061") 
- Multiple variants with their own IDs (e.g., "45292206129341")
- Each variant has specific options like size, color, etc.

**YOU MUST USE EXACT IDs FROM THE DATABASE BELOW:**

**AVAILABLE PRODUCTS DATABASE:**
${productDatabase.map(p => `
PRODUCT_ID: "${p.id}"
TITLE: "${p.title}"
VARIANTS:
${p.variants.filter(v => v.inStock !== false).map(v => `  VARIANT_ID: "${v.id}" | NAME: "${v.name || v.variantName || 'Standard'}" | PRICE: $${v.price} | OPTIONS: ${[v.option1, v.option2, v.option3].filter(Boolean).join(' / ') || 'None'}`).join('\n')}
---`).join('\n')}

**USER MESSAGE:** "${userMessage}"
**AI RESPONSE:** "${aiResponse}"

**ANALYSIS TASK:**
1. **Product Intent**: Detect any specific product(s) the user wants. 
   - Return BOTH "productId" (parent) AND "variantId" (specific variant).
   - If size/color not provided, DO NOT GUESS a variantId; return no product or ask for the missing option.
2. **Customer Info**: Extract name/phone/address if present.
3. **Order Action**: "confirm" / "cancel" / null.

**OUTPUT FORMAT (STRICT JSON ONLY):**
{
  "products": [{"productId": "actual_id_from_database", "variantId": "actual_variant_id_from_database", "quantity": 1}],
  "customerInfo": {"name": "John", "phone": "+96103123456", "address": "Beirut"},
  "orderAction": "confirm"
}`
    };

    const response = await axios.post(
      'https://api.openai.com/v1/responses',
      {
        model: 'gpt-5-mini',
        input: [analysisPrompt],
        reasoning: { effort: 'medium' },
        max_output_tokens: 1200,
        text: { verbosity: 'low' }
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    // ---------- Extract text ----------
    const analysisText = response.data.output
      ?.flatMap(o => o.content || [])
      .filter(c => c.type === 'output_text')
      .map(c => c.text)
      .join(' ')
      .trim() || '';

    // ---------- Sanitize to JSON ----------
    let cleanedText = analysisText
      .replace(/```json|```/g, '')        // strip fences
      .replace(/\u200b/g, '')             // zero-width
      .trim();

    const firstBrace = cleanedText.indexOf('{');
    const lastBrace  = cleanedText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleanedText = cleanedText.substring(firstBrace, lastBrace + 1);
    }

    console.log(`Attempting to parse AI analysis: ${cleanedText.substring(0, 200)}...`);

    let analysis;
    try {
      analysis = JSON.parse(cleanedText);
    } catch (e) {
      console.error('Error parsing AI analysis JSON:', e.message);
      console.error('Raw response:', analysisText);
      return; // bail gracefully
    }

    // ---------- Normalize structure ----------
    if (typeof analysis !== 'object' || analysis === null) return;
    if (!Array.isArray(analysis.products)) analysis.products = [];
    if (!analysis.customerInfo || typeof analysis.customerInfo !== 'object') analysis.customerInfo = {};
    if (typeof analysis.orderAction !== 'string') analysis.orderAction = null;

    console.log('AI Analysis parsed:', {
      productCount: analysis.products.length,
      hasCustomerInfo: Object.keys(analysis.customerInfo).length > 0,
      orderAction: analysis.orderAction
    });

    // ---------- Helpers ----------
    const toId = v => String(v ?? '').trim().replace(/^"|"$/g, '');
    const toQty = v => {
      const m = String(v ?? '').match(/\d+/);
      const n = m ? parseInt(m[0], 10) : 1;
      return n > 0 ? n : 1;
    };
    const findProduct = pid => productDatabase.find(p => String(p.id) === String(pid));
    const findVariant = (prod, vid) => prod?.variants.find(v => String(v.id) === String(vid));
    const firstAvailableVariant = prod => prod?.variants?.find(v => v.inStock !== false) || prod?.variants?.[0];

    // ---------- Apply products ----------
    if (analysis.products.length > 0) {
      for (const item of analysis.products) {
        try {
          const productId = toId(item.productId);
          let variantId    = toId(item.variantId);
          const quantity   = toQty(item.quantity);

          let prod = findProduct(productId);
          if (!prod) {
            console.error(`Product ID ${productId} not found in database`);
            continue;
          }

          let variant = variantId ? findVariant(prod, variantId) : null;

          // If variant missing/invalid, try to infer from userMessage, else first available
          if (!variant) {
            const inferred = matchProductFromMessage(userMessage, [prod]);
            if (inferred && String(inferred.variantId)) {
              variant = findVariant(prod, inferred.variantId);
            }
            if (!variant) {
              variant = firstAvailableVariant(prod);
            }
            if (!variant) {
              console.error(`No available variants for product ${productId}`);
              continue;
            }
            variantId = String(variant.id);
          }

          await addItemToOrder(
            senderId,
            businessId,
            String(prod.id),
            String(variant.id),
            quantity
          );
        } catch (error) {
          console.error('Error adding AI analyzed product:', error);
        }
      }
    }

    // ---------- Apply customer info ----------
    if (analysis.customerInfo && Object.keys(analysis.customerInfo).length > 0) {
      const cleanInfo = {};
      if (analysis.customerInfo.name)   cleanInfo.name = String(analysis.customerInfo.name).trim();
      if (analysis.customerInfo.phone)  cleanInfo.phone = cleanCustomerPhone(String(analysis.customerInfo.phone));
      if (analysis.customerInfo.address) cleanInfo.address = String(analysis.customerInfo.address).trim();

      if (Object.keys(cleanInfo).length > 0) {
        try {
          await updateCustomerInfo(senderId, businessId, cleanInfo);
        } catch (e) {
          console.error('Error updating AI analyzed customer info:', e);
        }
      }
    }

    // ---------- Apply order action ----------
    if (analysis.orderAction === 'confirm') {
      try {
        // check there are items (platform-agnostic)
        const currentOrder = await getActiveOrder(senderId, businessId);
        if (currentOrder && Array.isArray(currentOrder.items) && currentOrder.items.length > 0) {
          await confirmOrder(senderId, businessId);
        } else {
          console.error('Cannot confirm: no items in cart');
        }
      } catch (e) {
        console.error('Error confirming AI analyzed order:', e);
      }
    } else if (analysis.orderAction === 'cancel') {
      try {
        await cancelOrder(senderId, businessId);
      } catch (e) {
        console.error('Error cancelling AI analyzed order:', e);
      }
    }

  } catch (error) {
    console.error('Error in AI intelligence analysis:', error);
  }
}


/**
 * Parse customer info from action line
 */
function parseCustomerInfo(infoData) {
  const info = {};
  
  // Parse name="value" format
  const nameMatch = infoData.match(/name="([^"]+)"/);
  if (nameMatch) info.name = nameMatch[1];
  
  // Parse phone="value" format
  const phoneMatch = infoData.match(/phone="([^"]+)"/);
  if (phoneMatch) info.phone = cleanCustomerPhone(phoneMatch[1]);
  
  // Parse address="value" format
  const addressMatch = infoData.match(/address="([^"]+)"/);
  if (addressMatch) info.address = addressMatch[1];
  
  return info;
}

/**
 * Shared product matching logic
 */
function matchProductFromMessage(userMessage, productDatabase) {
  try {
    const lowerMessage = userMessage.toLowerCase();
    
    // Define patterns for matching
    const sizePatterns = {
      's': ['small', 's ', ' s', 'صغير'],
      'm': ['medium', 'm ', ' m', 'متوسط'],
      'l': ['large', 'l ', ' l', 'كبير'],
      'xl': ['xl', 'extra large'],
      'xxl': ['xxl', '2xl']
    };
    
    const colorPatterns = {
      'pink': ['pink', 'وردي'],
      'blue': ['blue', 'أزرق'],
      'red': ['red', 'أحمر'],
      'green': ['green', 'أخضر'],
      'black': ['black', 'أسود'],
      'white': ['white', 'أبيض']
    };
    
    // Try to match products by title
    for (const product of productDatabase) {
      const productTitle = product.title.toLowerCase();
      
      // Check if product title is mentioned
      if (lowerMessage.includes(productTitle)) {
        // Try to find specific variant based on options mentioned
        let selectedVariant = null;
        let bestMatch = 0;
        
        // Try to match variants based on options
        for (const variant of product.variants) {
          if (variant.inStock === false) continue; // Skip out of stock
          
          let matches = 0;
          
          // Check option1 (usually color)
          if (variant.option1) {
            const option1Lower = variant.option1.toLowerCase();
            for (const [color, patterns] of Object.entries(colorPatterns)) {
              if (patterns.some(pattern => lowerMessage.includes(pattern)) && 
                  option1Lower.includes(color)) {
                matches++;
                break;
              }
            }
          }
          
          // Check option2 (usually size)
          if (variant.option2) {
            const option2Lower = variant.option2.toLowerCase();
            for (const [size, patterns] of Object.entries(sizePatterns)) {
              if (patterns.some(pattern => lowerMessage.includes(pattern)) && 
                  option2Lower.includes(size)) {
                matches++;
                break;
              }
            }
          }
          
          // If this variant has more matches, select it
          if (matches > bestMatch) {
            bestMatch = matches;
            selectedVariant = variant;
          }
        }
        
        // If no specific variant found, use first available
        if (!selectedVariant) {
          selectedVariant = product.variants.find(v => v.inStock !== false);
        }
        
        if (selectedVariant) {
          return {
            productId: product.id,
            variantId: selectedVariant.id,
            productTitle: product.title,
            variantName: selectedVariant.name
          };
        }
        
        break; // Only process first product match
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error in matchProductFromMessage:', error);
    return null;
  }
}

/**
 * Find product by analyzing user message
 */
function findProductByUserMessage(userMessage, productDatabase) {
  return matchProductFromMessage(userMessage, productDatabase);
}

/**
 * Fallback product matching from user message
 */
async function fallbackProductMatching(senderId, businessId, userMessage, productDatabase) {
  try {
    // Check for buying intent keywords
    const buyingKeywords = /\b(want|buy|order|purchase|get|add|badi|bidi|بدي|اريد|اشتري|اطلب)\b/i;
    if (!buyingKeywords.test(userMessage)) {
      return; // No buying intent detected
    }
    
    // Use the shared product matching logic
    const productMatch = matchProductFromMessage(userMessage, productDatabase);
    
    if (productMatch) {
      console.log(`Fallback found product match: ${productMatch.productTitle} (${productMatch.productId})`);
      try {
        await addItemToOrder(senderId, businessId, productMatch.productId, productMatch.variantId, 1);
        console.log(`Fallback successfully added: ${productMatch.productTitle}`);
      } catch (error) {
        console.error(`Fallback error adding product:`, error);
      }
    } else {
      console.log(`No fallback product match found for: "${userMessage}"`);
    }
    
  } catch (error) {
    console.error('Error in fallback product matching:', error);
  }
}

/**
 * Clean and standardize customer phone numbers
 */
function cleanCustomerPhone(phone) {
  if (!phone || typeof phone !== 'string') return phone;
  
  // Remove spaces, dashes, parentheses
  let cleanPhone = phone.replace(/[\s-().]/g, '');
  
  // Handle Lebanese phone number formats
  if (cleanPhone.startsWith('00961')) {
    cleanPhone = '+961' + cleanPhone.slice(5);
  } else if (cleanPhone.startsWith('961') && !cleanPhone.startsWith('+961')) {
    cleanPhone = '+961' + cleanPhone.slice(3);
  } else if (cleanPhone.startsWith('0') && cleanPhone.length === 8) {
    cleanPhone = '+961' + cleanPhone.slice(1);
  } else if (!cleanPhone.startsWith('+') && cleanPhone.length === 7) {
    cleanPhone = '+961' + cleanPhone;
  }
  
  return cleanPhone;
}

module.exports = { generateReply, scheduleBatchedReply };


