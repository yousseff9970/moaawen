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

  // 🛒 ORDER FLOW HANDLING - Check for order-related intents
  let orderContext = '';
  let currentOrder = null;
  
  try {
    // Get current order if exists
    currentOrder = await getActiveOrder(senderId, business._id || business.id, 'whatsapp'); // Adjust platform as needed
    
    // Check for order-related keywords
    const orderKeywords = /\b(order|buy|purchase|cart|checkout|add to cart|i want|place order|confirm order|cancel order)\b/i;
    const nameKeywords = /\b(my name is|i'm|im|call me|name:|مين|اسمي|بدي اعرف حالي)\b/i;
    const phoneKeywords = /\b(phone|number|contact|mobile|رقم|تلفون|هاتف|موبايل)\b/i;
    const addressKeywords = /\b(address|location|deliver|shipping|عنوان|مكان|توصيل|شحن)\b/i;
    
    // Extract phone numbers (Lebanese format)
    const phonePattern = /(\+?961|0)?[\s-]?([0-9]{1,2})[\s-]?([0-9]{3})[\s-]?([0-9]{3})/g;
    const extractedPhone = userMessage.match(phonePattern);
    
    // Extract potential names (after "my name is" or similar patterns)
    const nameMatch = userMessage.match(/(?:my name is|i'm|im|call me|اسمي|مين)\s+([a-zA-Z\u0600-\u06FF\s]{2,30})/i);
    const extractedName = nameMatch ? nameMatch[1].trim() : null;
    
    // Handle order actions
    if (orderKeywords.test(userMessage) || currentOrder?.items.length > 0 || extractedPhone || extractedName) {
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
        
        orderContext += `Missing Information: ${currentOrder.getMissingInfo().join(', ') || 'None'}\n`;
      } else {
        orderContext += `No active order. Ready to start new order.\n`;
      }
      
      // Auto-extract customer information
      if (extractedName && currentOrder && !currentOrder.orderFlow.collectedInfo.hasName) {
        await updateCustomerInfo(senderId, business._id || business.id, { name: extractedName });
        orderContext += `\n🤖 AUTO-DETECTED NAME: ${extractedName}\n`;
      }
      
      if (extractedPhone && currentOrder && !currentOrder.orderFlow.collectedInfo.hasPhone) {
        await updateCustomerInfo(senderId, business._id || business.id, { phone: extractedPhone[0] });
        orderContext += `\n🤖 AUTO-DETECTED PHONE: ${extractedPhone[0]}\n`;
      }
      
      orderContext += `=== END ORDER CONTEXT ===\n`;
    }
    
  } catch (error) {
    console.error('Error handling order context:', error);
    orderContext = '\n\n=== ORDER CONTEXT ===\nError loading order information.\n=== END ORDER CONTEXT ===\n';
  }

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
  
  if (hasProducts) {
    productDatabase = buildProductDatabase(business.products);
    formattedProductData = formatProductDatabaseForAI(productDatabase);
    categoryOverview = groupProductsByCategory(productDatabase);
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

### **🛒 ORDER FLOW & CUSTOMER MANAGEMENT**

**CRITICAL ORDER INSTRUCTIONS:**
You are an intelligent order assistant. When customers want to buy products, guide them through a complete order process:

**1. PRODUCT SELECTION PHASE:**
- Help customers find and select products they want
- Show product details, variants, prices clearly
- When customer expresses intent to buy (words like: "I want", "buy", "order", "add to cart", "purchase"), guide them to place an order
- Use phrases like: "Great choice! Let me help you place an order for this."

**2. ORDER INFORMATION COLLECTION:**
You MUST collect these details for every order:
- ✅ **Customer Name**: "What's your name for the order?"
- ✅ **Phone Number**: "What's your phone number for delivery contact?"
- ✅ **Delivery Address**: "What's your complete delivery address?"

**3. SMART INFORMATION EXTRACTION:**
- Automatically detect when customer provides information in their messages
- If they say "My name is John" or "I'm John" → extract the name
- If they provide a phone number in Lebanese format → extract it
- If they mention their address → extract it
- Acknowledge when you detect information: "Got it! I have your name as John."

**4. ORDER CONFIRMATION PROCESS:**
- Show complete order summary with all items, quantities, prices
- Confirm customer details (name, phone, address)
- Ask for final confirmation: "Everything looks correct? Shall I confirm your order?"
- When confirmed, provide order reference number

**5. ORDER FLOW RESPONSES:**
Based on the ORDER CONTEXT provided above, respond intelligently:

**If no active order:**
- When customer wants to buy → start order process
- Guide them to select products first

**If order has items but missing customer info:**
- Ask for missing information (name, phone, address)
- Be conversational: "I have your items ready! Now I just need your delivery details."

**If order is complete (has items + customer info):**
- Show final order summary
- Ask for confirmation to place the order

**6. ORDER LANGUAGE HANDLING:**
- Handle orders in customer's language (Arabic, English, Lebanese)
- Use appropriate cultural context for Lebanese customers
- Be warm and helpful throughout the process

**7. ORDER STATUS COMMUNICATION:**
- Always acknowledge when items are added/removed
- Show running total after changes
- Clearly indicate what information is still needed
- Celebrate when order is complete and confirmed

**ORDER RESPONSE FORMAT:**
- Use clear sections with emojis
- Show order progress visually
- Make next steps obvious to the customer
- Be encouraging and professional

Use your AI intelligence to understand what users want and provide the most helpful response using the complete product data above.` : `

**NO PRODUCTS AVAILABLE**
This business does not currently have products in their catalog. Focus on:
- Answering questions about services
- Providing contact information
- Explaining business description and offerings
- Directing customers to contact directly for product inquiries`;

  // Add general rules that apply to all businesses
  const generalRules = `

**GENERAL RULES:**
1. **Scope**: Only answer questions about the business, its ${hasProducts ? 'products, ' : ''}services, or general operations
2. **Greetings**: For casual greetings, respond politely & briefly, then guide to business topics
3. **Irrelevant Questions**: For unrelated topics, politely redirect to business-related questions
4. **Response Style**: Be conversational, helpful, and use emojis appropriately
5. **Language Consistency**: Always match the user's language and dialect exactly${hasProducts ? '' : '\n6. **Product Queries**: If asked about products, explain that the business doesn\'t have an online catalog and provide contact information'}`;

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

    // 🛒 POST-PROCESSING: Handle order actions based on AI response and user message
    try {
      await processOrderActions(senderId, business._id || business.id, userMessage, replyText, productDatabase);
    } catch (orderError) {
      console.error('Error processing order actions:', orderError);
    }

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
  }, 10000);

  replyTimeouts.set(senderId, timeout);
};

/**
 * Process order actions based on user message and AI response
 */
async function processOrderActions(senderId, businessId, userMessage, aiResponse, productDatabase) {
  try {
    // Skip if no products available
    if (!productDatabase || productDatabase.length === 0) {
      return;
    }

    // Extract product selection from user message
    const productIds = extractProductReferences(userMessage, productDatabase);
    
    // Process product additions
    for (const { productId, variantId, quantity } of productIds) {
      try {
        await addItemToOrder(senderId, businessId, productId, variantId, quantity);
        console.log(`Added product ${productId}, variant ${variantId} to order for ${senderId}`);
      } catch (error) {
        console.error(`Error adding product to order:`, error);
      }
    }

    // Extract customer information from user message
    const customerInfo = extractCustomerInfo(userMessage);
    if (Object.keys(customerInfo).length > 0) {
      try {
        await updateCustomerInfo(senderId, businessId, customerInfo);
        console.log(`Updated customer info for ${senderId}:`, customerInfo);
      } catch (error) {
        console.error(`Error updating customer info:`, error);
      }
    }

    // Handle order confirmation
    if (isOrderConfirmation(userMessage)) {
      try {
        const result = await confirmOrder(senderId, businessId);
        if (result.success) {
          console.log(`Order confirmed for ${senderId}:`, result.orderId);
        }
      } catch (error) {
        console.error(`Error confirming order:`, error);
      }
    }

    // Handle order cancellation
    if (isOrderCancellation(userMessage)) {
      try {
        await cancelOrder(senderId, businessId);
        console.log(`Order cancelled for ${senderId}`);
      } catch (error) {
        console.error(`Error cancelling order:`, error);
      }
    }

  } catch (error) {
    console.error('Error in processOrderActions:', error);
  }
}

/**
 * Extract product references from user message
 */
function extractProductReferences(message, productDatabase) {
  const references = [];
  const lowerMessage = message.toLowerCase();
  
  // Look for product matches by title, variants, or options
  productDatabase.forEach(product => {
    const productTitle = product.title.toLowerCase();
    
    // Check if product title is mentioned
    if (lowerMessage.includes(productTitle)) {
      // Default to first variant if no specific variant mentioned
      let selectedVariant = product.variants[0];
      let quantity = 1;
      
      // Try to find specific variant matches
      product.variants.forEach(variant => {
        const variantName = variant.name.toLowerCase();
        const options = [variant.option1, variant.option2, variant.option3].filter(Boolean).map(o => o.toLowerCase());
        
        if (lowerMessage.includes(variantName) || options.some(opt => lowerMessage.includes(opt))) {
          selectedVariant = variant;
        }
      });
      
      // Extract quantity if mentioned
      const quantityMatch = message.match(/(\d+)\s*(?:x|pieces?|items?|pcs?)/i);
      if (quantityMatch) {
        quantity = parseInt(quantityMatch[1]);
      }
      
      references.push({
        productId: product.id,
        variantId: selectedVariant.id,
        quantity: quantity
      });
    }
  });
  
  return references;
}

/**
 * Extract customer information from user message
 */
function extractCustomerInfo(message) {
  const info = {};
  
  // Extract name
  const nameMatch = message.match(/(?:my name is|i'm|im|call me|اسمي|مين)\s+([a-zA-Z\u0600-\u06FF\s]{2,30})/i);
  if (nameMatch) {
    info.name = nameMatch[1].trim();
  }
  
  // Extract phone number (Lebanese format)
  const phoneMatch = message.match(/(\+?961|0)?[\s-]?([0-9]{1,2})[\s-]?([0-9]{3})[\s-]?([0-9]{3})/);
  if (phoneMatch) {
    info.phone = phoneMatch[0];
  }
  
  // Extract address (look for address keywords followed by location info)
  const addressMatch = message.match(/(?:address|location|deliver to|at|في|عنوان|مكان)\s*:?\s*([a-zA-Z\u0600-\u06FF0-9\s,.-]{5,100})/i);
  if (addressMatch) {
    info.address = addressMatch[1].trim();
  }
  
  // Extract email
  const emailMatch = message.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  if (emailMatch) {
    info.email = emailMatch[0];
  }
  
  return info;
}

/**
 * Check if message indicates order confirmation
 */
function isOrderConfirmation(message) {
  const confirmationKeywords = /\b(yes|confirm|place order|go ahead|submit|ok|نعم|موافق|تأكيد|بدي اطلب)\b/i;
  return confirmationKeywords.test(message);
}

/**
 * Check if message indicates order cancellation
 */
function isOrderCancellation(message) {
  const cancellationKeywords = /\b(cancel|no|stop|cancel order|لا|الغاء|توقف|ما بدي)\b/i;
  return cancellationKeywords.test(message);
}

module.exports = { generateReply, scheduleBatchedReply };


