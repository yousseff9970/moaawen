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
      console.log(`Sample product IDs:`, productDatabase.slice(0, 3).map(p => ({ id: p.id, title: p.title })));
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

### **🛒 NATURAL ORDER CONVERSATION FLOW**

**HUMAN-LIKE CONVERSATION APPROACH:**
You are a friendly, helpful human assistant - NOT a pushy salesperson. Your goal is to have natural conversations and help customers when THEY express interest.

**1. CONVERSATIONAL INTELLIGENCE:**
- **Be genuinely helpful**: Answer questions thoroughly and naturally
- **Don't be pushy**: Never pressure customers to buy or place orders
- **Let customers lead**: Only discuss ordering when they show clear interest
- **Be patient**: Allow natural conversation flow without rushing to sales
- **Show personality**: Be warm, friendly, and relatable

**2. NATURAL PRODUCT DISCUSSIONS:**
When customers ask about products:
- Share information enthusiastically but naturally
- Focus on helping them understand options
- Let them express interest before suggesting purchases
- Answer questions completely without always leading to orders
- Be descriptive and helpful about product details

**3. GENTLE ORDER ASSISTANCE (Only when customers show buying intent):**
Detect genuine buying interest through phrases like:
- English: "I want", "I'd like to buy", "can I order", "how do I get"
- Arabic: "بدي اشتري", "كيف اطلب", "ممكن احصل على"
- Lebanese: "bade ishtare", "kif adar otlob"

**4. NATURAL ORDER FLOW (Only when customers initiate):**
- **Product Selection**: Help them choose what they want naturally
- **Information Gathering**: Ask for delivery details conversationally when needed
- **Order Confirmation**: Review their order in a friendly, non-pressured way

**5. AI ORDER ACTIONS FORMAT:**
When you need to perform order actions, use these specific action commands at the end of your response:

**CRITICAL: USE ONLY REAL PRODUCT AND VARIANT IDs FROM THE DATABASE ABOVE**

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

**6. CONVERSATION EXAMPLES:**

Customer: "What colors do you have for this shirt?"
AI: "Great question! 😊 This shirt comes in several beautiful colors - we have blue, red, pink, and black. Each one looks really nice! The blue is particularly popular. Which color catches your eye?"

Customer: "بدي اشتري القميص الأحمر"
AI: "أكيد! 😊 القميص الأحمر خيار ممتاز. بأي مقاس بدك ياه؟ عنا S, M, L, XL"
[AI_ORDER_ACTIONS]
ADD_PRODUCT: {use_actual_product_id_from_database}, {use_actual_variant_id_from_database}, 1
[/AI_ORDER_ACTIONS]

Customer: "My name is John, phone 03-123-456"
AI: "Perfect John! 😊 I have your contact details. Just need your delivery address to complete the order."
[AI_ORDER_ACTIONS]
UPDATE_INFO: name="John", phone="03-123-456"
[/AI_ORDER_ACTIONS]

**7. HUMANIZED INTERACTION RULES:**
- **Be conversational**: Use natural language and expressions
- **Show enthusiasm**: Be genuinely excited about products when appropriate
- **Ask follow-up questions**: Show interest in their preferences
- **Give recommendations**: Share suggestions based on what they're looking for
- **Be understanding**: If they're just browsing, that's perfectly fine
- **Don't repeat order requests**: If someone isn't ready to buy, focus on helping them learn about products
- **Let conversations develop naturally**: Not every interaction needs to end in a sale` : `

**NO PRODUCTS AVAILABLE**
This business does not currently have products in their catalog. Focus on:
- Answering questions about services
- Providing contact information
- Explaining business description and offerings
- Directing customers to contact directly for product inquiries`;

  // Add general rules that apply to all businesses
  const generalRules = `

**HUMANIZED INTERACTION PRINCIPLES:**
1. **Natural Conversation**: Be genuinely helpful and conversational, like talking to a friend
2. **Patient Assistance**: Never rush customers or pressure them into purchases
3. **Authentic Responses**: Show real interest in helping, not just selling
4. **Respectful Browsing**: If someone is just looking around, that's perfectly fine
5. **Organic Flow**: Let conversations develop naturally without forcing order topics

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
async function processAIOrderActions(senderId, businessId, userMessage, aiResponse, productDatabase) {
  try {
    // Skip if no products available
    if (!productDatabase || productDatabase.length === 0) {
      return;
    }
    
    // Extract action commands from AI response
    const actionMatch = aiResponse.match(/\[AI_ORDER_ACTIONS\](.*?)\[\/AI_ORDER_ACTIONS\]/s);
    if (actionMatch) {
      const actions = actionMatch[1].trim();
      
      // Process each action line
      const actionLines = actions.split('\n').filter(line => line.trim());
      
      for (const actionLine of actionLines) {
        const line = actionLine.trim();
        
        // Process ADD_PRODUCT actions
        if (line.startsWith('ADD_PRODUCT:')) {
          const params = line.replace('ADD_PRODUCT:', '').trim();
          const [productId, variantId, quantity] = params.split(',').map(p => p.trim());
          
          // Validate IDs exist in product database
          const foundProduct = productDatabase.find(p => p.id === productId);
          if (!foundProduct) {
            console.error(`AI sent invalid product ID: ${productId}`);
            console.error(`Available product IDs:`, productDatabase.map(p => p.id));
            
            // Try to find product by title matching
            const productMatch = findProductByUserMessage(userMessage, productDatabase);
            if (productMatch) {
              console.log(`Found alternative product: ${productMatch.productId}`);
              try {
                await addItemToOrder(senderId, businessId, productMatch.productId, productMatch.variantId, parseInt(quantity) || 1);
                console.log(`Successfully added fallback product: ${productMatch.productTitle}`);
              } catch (error) {
                console.error(`Error adding fallback product:`, error);
              }
            } else {
              console.error(`No fallback product found for user message: "${userMessage}"`);
            }
            continue;
          }
          
          const foundVariant = foundProduct.variants.find(v => v.id === variantId);
          if (!foundVariant) {
            console.error(`AI sent invalid variant ID: ${variantId} for product: ${productId}`);
            // Use first available variant as fallback
            const fallbackVariant = foundProduct.variants[0];
            if (fallbackVariant) {
              try {
                await addItemToOrder(senderId, businessId, productId, fallbackVariant.id, parseInt(quantity) || 1);
              } catch (error) {
                console.error(`Error adding product with fallback variant:`, error);
              }
            }
            continue;
          }
          
          try {
            await addItemToOrder(senderId, businessId, productId, variantId, parseInt(quantity) || 1);
          } catch (error) {
            console.error(`Error adding AI product to order:`, error);
          }
        }
        
        // Process UPDATE_INFO actions
        else if (line.startsWith('UPDATE_INFO:')) {
          const infoData = line.replace('UPDATE_INFO:', '').trim();
          const customerInfo = parseCustomerInfo(infoData);
          
          if (customerInfo && Object.keys(customerInfo).length > 0) {
            try {
              await updateCustomerInfo(senderId, businessId, customerInfo);
            } catch (error) {
              console.error(`Error updating AI customer info:`, error);
            }
          }
        }
        
        // Process CONFIRM_ORDER actions
        else if (line.startsWith('CONFIRM_ORDER:') && line.includes('true')) {
          try {
            // Check if order has items before confirming
            const currentOrder = await getActiveOrder(senderId, businessId, 'whatsapp');
            if (!currentOrder || currentOrder.items.length === 0) {
              console.error(`Cannot confirm order: No items in cart`);
              continue;
            }
            
            const result = await confirmOrder(senderId, businessId);
            console.log(`Order confirmed successfully: ${result.orderId || 'N/A'}`);
          } catch (error) {
            console.error(`Error confirming AI order:`, error);
          }
        }
        
        // Process CANCEL_ORDER actions
        else if (line.startsWith('CANCEL_ORDER:') && line.includes('true')) {
          try {
            await cancelOrder(senderId, businessId);
          } catch (error) {
            console.error(`Error cancelling AI order:`, error);
          }
        }
      }
    } else {
      // Temporarily disable processWithAIIntelligence to prevent JSON parsing errors
      // await processWithAIIntelligence(senderId, businessId, userMessage, aiResponse, productDatabase);
      
      // Use only direct fallback matching for now
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
1. **Product Intent**: Did the user mention wanting to buy/order any specific products?
   - Match user intent to EXACT product titles and variant specifications
   - If user mentions size/color/options, find the matching variant ID
   - If user mentions general product, select the first available (in-stock) variant
   - ALWAYS return BOTH productId (parent) AND variantId (specific variant)
   - USE THE EXACT IDs FROM THE DATABASE ABOVE - DO NOT MODIFY OR GUESS IDs

2. **Customer Info**: Did the user provide name, phone, or address information?
   - Extract any personal information mentioned

3. **Order Action**: Did the user confirm, cancel, or modify their order?
   - Look for confirmation words like "yes", "confirm", "نعم", "موافق"
   - Look for cancellation words like "no", "cancel", "لا", "الغاء"

**CRITICAL MATCHING RULES:**
- When user says "Crop Top" → find PRODUCT_ID for "Crop Top"
- When user specifies "Pink S" → find VARIANT_ID with OPTIONS "Pink / S"
- When user says "medium" → find VARIANT_ID with option containing "M" or "Medium"
- When user says general product name → select first VARIANT_ID from that product
- COPY THE EXACT PRODUCT_ID AND VARIANT_ID FROM THE DATABASE - DO NOT GUESS OR MODIFY

**EXAMPLE MATCHING:**
User: "I want the crop top in pink size S"
→ Find PRODUCT_ID from database for "Crop Top"
→ Find VARIANT_ID from database for Pink / S variant
→ Return: {"productId": "actual_product_id", "variantId": "actual_variant_id", "quantity": 1}

**CRITICAL: NEVER USE FAKE IDs - ONLY USE IDs FROM THE DATABASE ABOVE**

**OUTPUT FORMAT:** 
You MUST respond with ONLY a valid JSON object. No additional text before or after.
VALID EXAMPLE:
{
  "products": [{"productId": "actual_id_from_database", "variantId": "actual_variant_id_from_database", "quantity": 1}],
  "customerInfo": {"name": "John", "phone": "+96103123456", "address": "Beirut"},
  "orderAction": "confirm"
}

If no actions needed:
{"products": [], "customerInfo": {}, "orderAction": null}`
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
      // Clean the response to ensure it's valid JSON
      let cleanedText = analysisText.trim();
      
      // Remove any text before the first { or after the last }
      const firstBrace = cleanedText.indexOf('{');
      const lastBrace = cleanedText.lastIndexOf('}');
      
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanedText = cleanedText.substring(firstBrace, lastBrace + 1);
      }
      
      console.log(`Attempting to parse AI analysis: ${cleanedText.substring(0, 200)}...`);
      
      const analysis = JSON.parse(cleanedText);
      
      // Validate the structure
      if (typeof analysis !== 'object' || analysis === null) {
        throw new Error('Analysis result is not a valid object');
      }
      
      // Ensure required properties exist
      if (!analysis.products) analysis.products = [];
      if (!analysis.customerInfo) analysis.customerInfo = {};
      if (!analysis.orderAction) analysis.orderAction = null;
      
      console.log(`AI Analysis parsed successfully:`, {
        productCount: analysis.products.length,
        hasCustomerInfo: Object.keys(analysis.customerInfo).length > 0,
        orderAction: analysis.orderAction
      });
      
      // Process product additions
      if (analysis.products && analysis.products.length > 0) {
        for (const product of analysis.products) {
          try {
            // Validate that both IDs exist in the product database
            const foundProduct = productDatabase.find(p => p.id === product.productId);
            if (!foundProduct) {
              console.error(`Product ID ${product.productId} not found in database`);
              continue;
            }
            
            const foundVariant = foundProduct.variants.find(v => v.id === product.variantId);
            if (!foundVariant) {
              console.error(`Variant ID ${product.variantId} not found for product ${product.productId}`);
              // Fallback to first available variant
              const firstAvailableVariant = foundProduct.variants.find(v => v.inStock !== false);
              if (firstAvailableVariant) {
                product.variantId = firstAvailableVariant.id;
              } else {
                console.error(`No available variants for product ${product.productId}`);
                continue;
              }
            }
            
            await addItemToOrder(senderId, businessId, product.productId, product.variantId, product.quantity || 1);
          } catch (error) {
            console.error(`Error adding AI analyzed product:`, error);
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
          } catch (error) {
            console.error(`Error updating AI analyzed customer info:`, error);
          }
        }
      }
      
      // Process order actions
      if (analysis.orderAction === 'confirm') {
        try {
          const result = await confirmOrder(senderId, businessId);
        } catch (error) {
          console.error(`Error confirming AI analyzed order:`, error);
        }
      } else if (analysis.orderAction === 'cancel') {
        try {
          await cancelOrder(senderId, businessId);
        } catch (error) {
          console.error(`Error cancelling AI analyzed order:`, error);
        }
      }
      
    } catch (parseError) {
      console.error('Error parsing AI analysis response:', parseError.message);
      console.error('Raw response that failed to parse:', analysisText);
      console.error('Length of raw response:', analysisText.length);
      
      // Try to identify the issue
      if (analysisText.includes('```')) {
        console.error('Response contains markdown code blocks - this is incorrect formatting');
      }
      if (!analysisText.startsWith('{')) {
        console.error('Response does not start with { - likely has extra text');
      }
      if (!analysisText.endsWith('}')) {
        console.error('Response does not end with } - likely has extra text');
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


