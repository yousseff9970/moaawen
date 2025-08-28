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

  // 🛒 AI-POWERED ORDER FLOW HANDLING 
  let orderContext = '';
  let currentOrder = null;
  
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

### **🛒 AI-POWERED ORDER FLOW & MANAGEMENT**

**CRITICAL AI ORDER PROCESSING INSTRUCTIONS:**
You are now a complete AI-powered order management system. You must intelligently handle ALL aspects of order processing:

**1. INTELLIGENT CUSTOMER INTENT DETECTION:**
- Detect when customers want to buy/order products from ANY language:
  - English: "I want", "buy", "order", "add to cart", "purchase", "get me"
  - Arabic: "بدي", "أريد", "اشتري", "اطلب", "احصل على"
  - Lebanese: "bade", "bidi", "ishtre", "otlob", "a3tine"
  - Mixed: "بدي هاي ال item", "I want هاي ال product"

**2. AI PRODUCT MATCHING & VARIANT SELECTION:**
When customers mention products, use your intelligence to:
- **Exact Product Match**: Find the exact product they mentioned
- **Fuzzy Matching**: Handle typos, partial names, descriptions
- **Multi-language Matching**: Handle Arabic/English/Lebanese product references
- **Variant Intelligence**: 
  - If they specify size/color/options → find exact variant
  - If no specifics → ask for clarification or suggest available options
  - Handle natural descriptions: "red shirt medium" → find red shirt in size medium

**3. AI CUSTOMER INFORMATION EXTRACTION:**
Automatically detect and extract from messages:
- **Names**: "I'm John", "My name is أحمد", "call me Sara", "انا محمد"
- **Phone Numbers**: Any format - clean and standardize automatically
- **Addresses**: Any format in any language - extract complete addresses

**4. INTELLIGENT ORDER FLOW MANAGEMENT:**
Based on ORDER CONTEXT above, respond intelligently:

**Phase 1 - Product Selection:**
- When customer wants to buy → help them select products
- Show available options if they're not specific
- Add selected items to their cart automatically
- Acknowledge additions: "✅ Added [Product] to your cart!"

**Phase 2 - Information Collection:**
- If missing name → ask for it naturally
- If missing phone → request it for delivery
- If missing address → ask for complete delivery address
- Be conversational and match their language

**Phase 3 - Order Review & Confirmation:**
- Show complete order summary with all items and total
- Confirm customer details
- Ask for final confirmation
- Process confirmation/cancellation

**5. AI ORDER ACTIONS FORMAT:**
When you want to perform order actions, end your response with specific action commands in this format:

Action Commands:
- ADD_PRODUCT: productId, variantId, quantity
- UPDATE_INFO: name="value", phone="value", address="value"
- CONFIRM_ORDER: true
- CANCEL_ORDER: true

Wrap actions in: [AI_ORDER_ACTIONS] ... [/AI_ORDER_ACTIONS]

**6. INTELLIGENT RESPONSE EXAMPLES:**

Customer says: "بدي القميص الأحمر مقاس متوسط"
AI responds: "ممتاز! لديك القميص الأحمر بالمقاس المتوسط - $25. ✅ تمت إضافته لسلة التسوق. بحاجة لاسمك ورقم هاتفك للتوصيل."
Then adds: [AI_ORDER_ACTIONS] ADD_PRODUCT: shirt_001, variant_red_medium, 1 [/AI_ORDER_ACTIONS]

Customer says: "My name is John and my phone is 03 123 456"
AI responds: "Perfect! I have your name as John and phone as +96103123456. ✅ Now I just need your delivery address to complete the order."
Then adds: [AI_ORDER_ACTIONS] UPDATE_INFO: name="John", phone="+96103123456" [/AI_ORDER_ACTIONS]

**7. AI ORDER INTELLIGENCE RULES:**
- **Auto-detect everything**: Don't ask users to repeat information you can extract
- **Be proactive**: Guide customers through the process smoothly
- **Handle errors gracefully**: If product not found, suggest alternatives
- **Match language**: Respond in customer's language consistently
- **Show progress**: Always indicate what's completed and what's needed
- **Validate choices**: Confirm product selections before adding to cart

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

    // 🤖 AI-POWERED ORDER POST-PROCESSING
    try {
      await processAIOrderActions(senderId, business._id || business.id, userMessage, replyText, productDatabase);
    } catch (orderError) {
      console.error('Error processing AI order actions:', orderError);
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
 * AI-Powered Order Action Processor
 * Processes the AI response to extract and execute order actions
 */
async function processAIOrderActions(senderId, businessId, userMessage, aiResponse, productDatabase) {
  try {
    // Skip if no products available
    if (!productDatabase || productDatabase.length === 0) {
      return;
    }

    console.log('🤖 Processing AI Order Actions for:', senderId);
    
    // Extract action commands from AI response
    const actionMatch = aiResponse.match(/\[AI_ORDER_ACTIONS\](.*?)\[\/AI_ORDER_ACTIONS\]/s);
    if (actionMatch) {
      const actions = actionMatch[1].trim();
      console.log('🎯 AI Actions Found:', actions);
      
      // Process each action line
      const actionLines = actions.split('\n').filter(line => line.trim());
      
      for (const actionLine of actionLines) {
        const line = actionLine.trim();
        
        // Process ADD_PRODUCT actions
        if (line.startsWith('ADD_PRODUCT:')) {
          const params = line.replace('ADD_PRODUCT:', '').trim();
          const [productId, variantId, quantity] = params.split(',').map(p => p.trim());
          
          console.log(`🔍 Processing ADD_PRODUCT:`, { productId, variantId, quantity });
          
          try {
            await addItemToOrder(senderId, businessId, productId, variantId, parseInt(quantity) || 1);
            console.log(`✅ AI Added product ${productId}, variant ${variantId} to order`);
          } catch (error) {
            console.error(`❌ Error adding AI product to order:`, error);
            console.error('Parameters received:', { productId, variantId, quantity });
          }
        }
        
        // Process UPDATE_INFO actions
        else if (line.startsWith('UPDATE_INFO:')) {
          const infoData = line.replace('UPDATE_INFO:', '').trim();
          const customerInfo = parseCustomerInfo(infoData);
          
          if (customerInfo && Object.keys(customerInfo).length > 0) {
            try {
              await updateCustomerInfo(senderId, businessId, customerInfo);
              console.log(`✅ AI Updated customer info:`, customerInfo);
            } catch (error) {
              console.error(`❌ Error updating AI customer info:`, error);
            }
          }
        }
        
        // Process CONFIRM_ORDER actions
        else if (line.startsWith('CONFIRM_ORDER:') && line.includes('true')) {
          try {
            const result = await confirmOrder(senderId, businessId);
            if (result.success) {
              console.log(`✅ AI Confirmed order:`, result.orderId);
            }
          } catch (error) {
            console.error(`❌ Error confirming AI order:`, error);
          }
        }
        
        // Process CANCEL_ORDER actions
        else if (line.startsWith('CANCEL_ORDER:') && line.includes('true')) {
          try {
            await cancelOrder(senderId, businessId);
            console.log(`✅ AI Cancelled order`);
          } catch (error) {
            console.error(`❌ Error cancelling AI order:`, error);
          }
        }
      }
    } else {
      console.log('🧠 No explicit actions found, using AI intelligence analysis...');
      await processWithAIIntelligence(senderId, businessId, userMessage, aiResponse, productDatabase);
      
      // Additional fallback: Direct product matching from user message
      await fallbackProductMatching(senderId, businessId, userMessage, productDatabase);
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
    // Create comprehensive analysis prompt
    const analysisPrompt = {
      role: 'system',
      content: `You are an AI Order Analysis System. Analyze the user message and AI response to determine what order actions should be taken.

**IMPORTANT: PRODUCT STRUCTURE UNDERSTANDING**
Each product has:
- A parent product ID (e.g., "8057183568061") 
- Multiple variants with their own IDs (e.g., "45292206129341")
- Each variant has specific options like size, color, etc.

**AVAILABLE PRODUCTS DATABASE:**
${productDatabase.map(p => `
PRODUCT: ID="${p.id}", Title="${p.title}"
VARIANTS:
${p.variants.map(v => `  - VARIANT_ID="${v.id}", Name="${v.name || 'Standard'}", Price=$${v.price}, Options: ${[v.option1, v.option2, v.option3].filter(Boolean).join(' / ') || 'None'}, InStock=${v.inStock !== false}`).join('\n')}
`).join('\n')}

**USER MESSAGE:** "${userMessage}"
**AI RESPONSE:** "${aiResponse}"

**ANALYSIS TASK:**
1. **Product Intent**: Did the user mention wanting to buy/order any specific products?
   - Match user intent to EXACT product titles and variant specifications
   - If user mentions size/color/options, find the matching variant ID
   - If user mentions general product, select the first available (in-stock) variant
   - ALWAYS return BOTH productId (parent) AND variantId (specific variant)

2. **Customer Info**: Did the user provide name, phone, or address information?
   - Extract any personal information mentioned

3. **Order Action**: Did the user confirm, cancel, or modify their order?
   - Look for confirmation words like "yes", "confirm", "نعم", "موافق"
   - Look for cancellation words like "no", "cancel", "لا", "الغاء"

**CRITICAL MATCHING RULES:**
- When user says "Crop Top" → find product with title "Crop Top"
- When user specifies "Pink S" → find variant with option1="Pink" AND option2="S"
- When user says "medium" → find variant with option2="M" or similar
- When user says general product name → select first in-stock variant

**OUTPUT FORMAT:** Respond with ONLY a JSON object:
{
  "products": [{"productId": "parent_product_id", "variantId": "specific_variant_id", "quantity": number}],
  "customerInfo": {"name": "value", "phone": "value", "address": "value"},
  "orderAction": "confirm" | "cancel" | null
}

If no actions needed, return: {"products": [], "customerInfo": {}, "orderAction": null}`
    };

    const response = await axios.post('https://api.openai.com/v1/responses', {
      model: 'gpt-5-mini',
      input: [analysisPrompt],   
      reasoning: { effort: "medium" }, 
      max_output_tokens: 800,   
      text: {
        verbosity: "low"   
      }
    }, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });

    const analysisText = response.data.output
      ?.flatMap(o => o.content || [])
      .filter(c => c.type === "output_text")
      .map(c => c.text)
      .join(" ")
      .trim();
    
    try {
      const analysis = JSON.parse(analysisText);
      console.log('🧠 AI Analysis Result:', JSON.stringify(analysis, null, 2));
      
      // Process product additions
      if (analysis.products && analysis.products.length > 0) {
        for (const product of analysis.products) {
          try {
            console.log(`🎯 Attempting to add product:`, {
              productId: product.productId,
              variantId: product.variantId,
              quantity: product.quantity || 1
            });
            
            // Validate that both IDs exist in the product database
            const foundProduct = productDatabase.find(p => p.id === product.productId);
            if (!foundProduct) {
              console.error(`❌ Product ID ${product.productId} not found in database`);
              continue;
            }
            
            const foundVariant = foundProduct.variants.find(v => v.id === product.variantId);
            if (!foundVariant) {
              console.error(`❌ Variant ID ${product.variantId} not found for product ${product.productId}`);
              // Fallback to first available variant
              const firstAvailableVariant = foundProduct.variants.find(v => v.inStock !== false);
              if (firstAvailableVariant) {
                console.log(`🔄 Using fallback variant: ${firstAvailableVariant.id}`);
                product.variantId = firstAvailableVariant.id;
              } else {
                console.error(`❌ No available variants for product ${product.productId}`);
                continue;
              }
            }
            
            await addItemToOrder(senderId, businessId, product.productId, product.variantId, product.quantity || 1);
            console.log(`✅ AI Intelligence added product: ${product.productId}, variant: ${product.variantId}`);
          } catch (error) {
            console.error(`❌ Error adding AI analyzed product:`, error);
            console.error('Product details:', product);
          }
        }
      }
      
      // Process customer info updates
      if (analysis.customerInfo && Object.keys(analysis.customerInfo).length > 0) {
        const cleanInfo = {};
        if (analysis.customerInfo.name) cleanInfo.name = analysis.customerInfo.name;
        if (analysis.customerInfo.phone) cleanInfo.phone = cleanCustomerPhone(analysis.customerInfo.phone);
        if (analysis.customerInfo.address) cleanInfo.address = analysis.customerInfo.address;
        
        if (Object.keys(cleanInfo).length > 0) {
          try {
            await updateCustomerInfo(senderId, businessId, cleanInfo);
            console.log(`✅ AI Intelligence updated customer info:`, cleanInfo);
          } catch (error) {
            console.error(`❌ Error updating AI analyzed customer info:`, error);
          }
        }
      }
      
      // Process order actions
      if (analysis.orderAction === 'confirm') {
        try {
          const result = await confirmOrder(senderId, businessId);
          if (result.success) {
            console.log(`✅ AI Intelligence confirmed order:`, result.orderId);
          }
        } catch (error) {
          console.error(`❌ Error confirming AI analyzed order:`, error);
        }
      } else if (analysis.orderAction === 'cancel') {
        try {
          await cancelOrder(senderId, businessId);
          console.log(`✅ AI Intelligence cancelled order`);
        } catch (error) {
          console.error(`❌ Error cancelling AI analyzed order:`, error);
        }
      }
      
    } catch (parseError) {
      console.error('Error parsing AI analysis response:', parseError);
      console.log('Raw AI analysis response:', analysisText);
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
 * Fallback product matching from user message
 */
async function fallbackProductMatching(senderId, businessId, userMessage, productDatabase) {
  try {
    console.log('🔍 Fallback product matching for message:', userMessage);
    
    // Check for buying intent keywords
    const buyingKeywords = /\b(want|buy|order|purchase|get|add|badi|bidi|بدي|اريد|اشتري|اطلب)\b/i;
    if (!buyingKeywords.test(userMessage)) {
      return; // No buying intent detected
    }
    
    const lowerMessage = userMessage.toLowerCase();
    
    // Try to match products by title
    for (const product of productDatabase) {
      const productTitle = product.title.toLowerCase();
      
      // Check if product title is mentioned
      if (lowerMessage.includes(productTitle)) {
        console.log(`📦 Found product match: ${product.title}`);
        
        // Try to find specific variant based on options mentioned
        let selectedVariant = null;
        
        // Look for size mentions
        const sizePatterns = {
          'small': ['s', 'small', 'صغير'],
          'medium': ['m', 'medium', 'متوسط'],
          'large': ['l', 'large', 'كبير'],
          'xl': ['xl', 'extra large'],
          'xxl': ['xxl', '2xl']
        };
        
        // Look for color mentions
        const colorPatterns = {
          'pink': ['pink', 'وردي'],
          'blue': ['blue', 'أزرق'],
          'red': ['red', 'أحمر'],
          'green': ['green', 'أخضر'],
          'black': ['black', 'أسود'],
          'white': ['white', 'أبيض']
        };
        
        // Try to match variants based on options
        for (const variant of product.variants) {
          if (variant.inStock === false) continue; // Skip out of stock
          
          let matches = 0;
          let totalOptions = 0;
          
          // Check option1 (usually color)
          if (variant.option1) {
            totalOptions++;
            const option1Lower = variant.option1.toLowerCase();
            
            // Check color patterns
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
            totalOptions++;
            const option2Lower = variant.option2.toLowerCase();
            
            // Check size patterns
            for (const [size, patterns] of Object.entries(sizePatterns)) {
              if (patterns.some(pattern => lowerMessage.includes(pattern)) && 
                  option2Lower.includes(size)) {
                matches++;
                break;
              }
            }
          }
          
          // If we have some matches or no specific options mentioned, select this variant
          if (matches > 0 || totalOptions === 0) {
            selectedVariant = variant;
            break;
          }
        }
        
        // If no specific variant found, use first available
        if (!selectedVariant) {
          selectedVariant = product.variants.find(v => v.inStock !== false);
        }
        
        if (selectedVariant) {
          try {
            console.log(`🎯 Fallback adding: Product ${product.id}, Variant ${selectedVariant.id}`);
            await addItemToOrder(senderId, businessId, product.id, selectedVariant.id, 1);
            console.log(`✅ Fallback successfully added: ${product.title} - ${selectedVariant.name || 'Standard'}`);
          } catch (error) {
            console.error(`❌ Fallback error adding product:`, error);
          }
        }
        
        break; // Only process first product match
      }
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


