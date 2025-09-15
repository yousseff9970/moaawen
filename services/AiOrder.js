const axios = require('axios');
const {
  getActiveOrder,
  addItemToOrder,
  removeItemFromOrder,
  updateCustomerInfo,
  confirmOrder,
  cancelOrder,
  getOrderSummary
} = require('./orderManager');




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

        //console.log(`Processing ADD_PRODUCT: productId=${productId}, variantId=${variantId}, quantity=${quantity}`);

        // product = variant mistake → auto-pick a valid variant
        if (productId && variantId && productId === variantId) {
          //console.log(`AI used same ID for product and variant (${productId}) - attempting to fix...`);
          const prod = findProduct(productId);
          const chosen = firstAvailableVariant(prod);
          if (prod && chosen) {
            try {
              await addItemToOrder(senderId, businessId, String(prod.id), String(chosen.id), quantity);
              //console.log(`Auto-corrected with variant ${chosen.id} for product ${prod.id}`);
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
             // console.log(`Successfully added fallback product: ${productMatch.productTitle}`);
            } catch (e) {
              console.error('Error adding fallback product:', e);
            }
          } else {
            console.error(`No fallback product found for user message: "${userMessage}"`);
          }
          await processWithAIIntelligence(senderId, businessId, userMessage, aiResponse, productDatabase)
  .catch(e => console.error('AI analysis repair failed:', e));

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
          //console.log(`Order confirmed successfully: ${result?.orderId || 'N/A'}`);
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

    //console.log(`Attempting to parse AI analysis: ${cleanedText.substring(0, 200)}...`);

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
      //console.log(`Fallback found product match: ${productMatch.productTitle} (${productMatch.productId})`);
      try {
        await addItemToOrder(senderId, businessId, productMatch.productId, productMatch.variantId, 1);
        //console.log(`Fallback successfully added: ${productMatch.productTitle}`);
      } catch (error) {
        console.error(`Fallback error adding product:`, error);
      }
    } else {
      //console.log(`No fallback product match found for: "${userMessage}"`);
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
module.exports = { processAIOrderActions, processWithAIIntelligence  }