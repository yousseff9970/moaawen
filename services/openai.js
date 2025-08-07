const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { getBusinessInfo } = require('./business');
const { normalize } = require('./normalize');
const { matchModelResponse, matchFAQSmart } = require('./modelMatcher');
const { loadJsonArrayFile, getBusinessModel } = require('../utils/jsonLoader');
const { logToJson } = require('./jsonLog');
const { trackUsage } = require('../utils/trackUsage');


const sessionHistory = new Map();
const sessionTimeouts = new Map();
const replyTimeouts = new Map();
const pendingMessages = new Map();
const summaries = new Map(); // Store long-term memory summaries

const generalModelPath = path.join(__dirname, 'mappings/model_general.json');
const generalModel = loadJsonArrayFile(generalModelPath);
const unknownWordsPath = path.join(__dirname, 'unknownWords.json');
if (!fs.existsSync(unknownWordsPath)) fs.writeFileSync(unknownWordsPath, JSON.stringify([]));
// Load short words and arabizi keywords from a separate file
const { shortWordMap, arabiziKeywords } = require('./languageData');

// Compile arabizi keywords into regex for faster detection
const arabiziRegex = new RegExp(`\\b(${arabiziKeywords.join('|')})\\b`, 'i');

/**
 * Advanced language detection with fallback support
 */
function detectLanguage(text, lastKnownLanguage = 'arabic', lastHistory = []) {
  if (!text || typeof text !== 'string') return lastKnownLanguage;

  const cleanText = text.toLowerCase().trim();
  if (/^[\s\p{Emoji_Presentation}\p{P}\p{S}]+$/u.test(cleanText)) return lastKnownLanguage;

  const words = cleanText.split(/\s+/);

  // Special short words: fallback or map
  if (words.length === 1) {
    if (shortWordMap[words[0]]) return shortWordMap[words[0]];
    // Ambiguous single words fallback to last language
    return lastKnownLanguage;
  }

  let arabicScore = 0, arabiziScore = 0, englishScore = 0;

  // Main scoring
  for (const word of words) {
    if (/[\u0600-\u06FF]/.test(word)) {
      arabicScore += 3;
    } else if (/\d/.test(word)) {
      arabiziScore += 2;
    } else if (arabiziRegex.test(word)) {
      arabiziScore += 2;
    } else if (/[a-z]+/.test(word)) {
      // Check if it's Arabizi-like but not in dictionary
      if (!shortWordMap[word] && !arabiziRegex.test(word)) {
        logUnknownWord(word);
      }
      englishScore += 1;
    }

    // Emoji influence
    if (/🇱🇧|🤲|❤️|🕌/.test(word)) arabicScore += 1;
    if (/🇺🇸|👍|✌️|🤞/.test(word)) englishScore += 1;
  }

  // History bias: consider last 5 messages
  const recentLangs = lastHistory.slice(-5).map(m => m.lang);
  const langBias = recentLangs.reduce((acc, l) => {
    if (l === 'arabic') acc.arabic += 1;
    if (l === 'arabizi') acc.arabizi += 1.5;
    if (l === 'english') acc.english += 1;
    return acc;
  }, { arabic: 0, arabizi: 0, english: 0 });

  // Extra bias for last known language to prevent flip-flop
  langBias[lastKnownLanguage] += 2;

  arabicScore += langBias.arabic;
  arabiziScore += langBias.arabizi;
  englishScore += langBias.english;

  // Sort and get top language
  const scores = { arabic: arabicScore, arabizi: arabiziScore, english: englishScore };
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [lang, maxScore] = entries[0];
  const totalScore = arabicScore + arabiziScore + englishScore;

  // Adaptive confidence: higher threshold for short messages
  const adaptiveThreshold = words.length < 3 ? 0.7 : 0.55;
  const confidence = maxScore / (totalScore || 1);

  if (confidence < adaptiveThreshold) return lastKnownLanguage;

  // Mixed language handling: prevent switching if scores too close
  const margin = words.length < 4 ? 2 : 1;
  if (entries.length > 1 && Math.abs(entries[0][1] - entries[1][1]) <= margin) {
    return lastKnownLanguage;
  }

  // Stability check: require 2 consistent detections before switching
  if (lang !== lastKnownLanguage) {
    const stable = lastHistory.slice(-2).every(m => m.lang === lang);
    if (!stable) return lastKnownLanguage;
  }

  return lang;
}


function logUnknownWord(word) {
  const data = JSON.parse(fs.readFileSync(unknownWordsPath, 'utf8'));
  if (!data.includes(word)) {
    data.push(word);
    fs.writeFileSync(unknownWordsPath, JSON.stringify(data, null, 2));
  }
}


/**
 * Memory handling with language tracking
 */
function updateSession(senderId, role, content) {
  if (!sessionHistory.has(senderId)) sessionHistory.set(senderId, []);
  const history = sessionHistory.get(senderId);

  // Detect language for each message and store it (fallback to last known)
  const lastLang = history.length ? history[history.length - 1].lang : 'arabic';
  const lang = detectLanguage(content.trim(), lastLang);

  history.push({ role, content, lang });

  // Summarize if history > 20
  if (history.length > 20) {
    const oldMessages = history.splice(0, history.length - 20);

    // Add role & language tag in summary
    const summaryText = oldMessages
      .map(m => `[${m.lang}] ${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join(' ')
      .slice(0, 1200);

    const previousSummary = summaries.get(senderId) || '';
    summaries.set(senderId, `${previousSummary} ${summaryText}`.trim());
  }

  // Reset 10-min timer
  if (sessionTimeouts.has(senderId)) {
    clearTimeout(sessionTimeouts.get(senderId));
  }

  const timeout = setTimeout(() => {
    sessionHistory.delete(senderId);
    sessionTimeouts.delete(senderId);
    summaries.delete(senderId); // clear summaries too
    console.log(`🗑️ Cleared session history for ${senderId} after 10 min`);
  }, 10 * 60 * 1000);

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
const history = sessionHistory.get(senderId) || [];
const lastLang = history.slice(-1)[0]?.lang || 'arabic';
let lang = detectLanguage(userMessage.trim(), lastLang, history);

const { checkAccess } = require('../utils/businessPolicy');

const access = checkAccess(business, {
  messages: true,
  feature: 'aiReplies'
});

if (!access.allowed) {
  const reason = access.reasons.join(', ');
  const fallbackMessage = (lang) => {
    if (lang === 'arabic') {
      if (access.reasons.includes('expired')) return '⚠️ اشتراكك انتهى. جدد الخطة للاستمرار.';
      if (access.reasons.includes('inactive')) return '⚠️ الحساب غير مفعل حالياً.';
      if (access.reasons.includes('message_limit')) return '⚠️ وصلت للحد الأقصى من الرسائل. تحتاج لترقية.';
      if (access.reasons.find(r => r.startsWith('feature'))) return '🚫 هذه الميزة غير متوفرة في خطتك الحالية.';
      return '🚫 لا يمكنك استخدام هذه الميزة حالياً.';
    }

    if (lang === 'arabizi') {
      if (access.reasons.includes('expired')) return '⚠️ el eshterak khallas. jadded l plan la tekammel.';
      if (access.reasons.includes('inactive')) return '⚠️ el hesab mesh mef3al.';
      if (access.reasons.includes('message_limit')) return '⚠️ woselna lal 7ad el ma7doud. 7awwel terka.';
      if (access.reasons.find(r => r.startsWith('feature'))) return '🚫 hal feature mesh available bel plan taba3ak.';
      return '🚫 ma feek tista3mel hal feature.';
    }

    // English fallback
    if (access.reasons.includes('expired')) return '⚠️ Your subscription has expired. Please renew to continue.';
    if (access.reasons.includes('inactive')) return '⚠️ Your account is currently inactive.';
    if (access.reasons.includes('message_limit')) return '⚠️ You’ve reached your message limit. Please upgrade your plan.';
    if (access.reasons.find(r => r.startsWith('feature'))) return '🚫 This feature is not available in your current plan.';
    return '🚫 Your access is restricted: ' + reason;
  };
logToJson({
  layer: 'policy',
  senderId,
  businessId: business.id,
  message: userMessage,
  reasons: access.reasons,
  ai_reply: fallbackMessage(lang),
  duration: 0
});

  return {
    reply: fallbackMessage(lang),
    source: 'policy',
    layer_used: 'plan_check',
    duration: 0
  };
}




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

  updateSession(senderId, 'user', userMessage);

const productList = (business.products || []).map((p, i) => {
  const productHeader = `${i + 1}. **${p.title}**\n   📝 ${p.description || 'No description.'}\n   🏷️ Vendor: ${p.vendor || 'N/A'}\n   🗂️ Type: ${p.type || 'N/A'}`;

  const variantsList = (p.variants || []).map((v) => {
    let priceDisplay = 'Price not available';
    if (v.discountedPrice) {
      if (v.isDiscounted) {
        priceDisplay = `~~$${v.originalPrice}~~ ➡️ **$${v.discountedPrice}**`;
      } else {
        priceDisplay = `$${v.discountedPrice}`;
      }
    }

    const stockStatus = v.inStock === false ? '❌ Out of stock' : '✅ In stock';
    const variantLabel = v.variantName ? `(${v.variantName})` : '';
    const skuText = v.sku ? `SKU: ${v.sku}` : '';
    const barcodeText = v.barcode ? `Barcode: ${v.barcode}` : '';
    const imageText = v.image ? `🖼️ [Image](${v.image})` : '';

    return `      • ${variantLabel} — ${priceDisplay} ${stockStatus} ${imageText}\n         ${skuText} ${barcodeText}`;
  }).join('\n');

  return `${productHeader}\n   🔢 Variants:\n${variantsList}`;
}).join('\n\n');



  // Detect language for the current user message
  // Get user history and detect language with bias


// Optional stability check: only switch if stable in last 2 messages
if (lang !== lastLang) {
  const stable = history.slice(-2).every(m => m.lang === lang);
  if (!stable) lang = lastLang;
}

// Dynamic fallback message based on detected language
const fallbackMessage = (language) => {
  if (language === 'arabic') {
    return `عذرًا ما عندي هالمعلومة هلّق. فيك تتواصل معنا عالتليفون ${business.contact?.phone || ''} أو عالإيميل ${business.contact?.email || ''} لمزيد من التفاصيل.`;
  }
  if (language === 'arabizi') {
    return `Sorry ma 3nde hal ma3lome 7aliyan fikon tetwasalo m3na 3al ${business.contact?.phone || ''} aw email ${business.contact?.email || ''}.`;
  }
  return `I’m sorry, I don’t have that information right now. Please contact us at ${business.contact?.phone || 'N/A'} or ${business.contact?.email || 'N/A'} for more details.`;
};

// Language instruction (enforces output language)
const languageInstruction =
  lang === 'english'
    ? "The user is speaking in English. Reply in English."
    : "The user is speaking Arabic or Arabizi. Reply in Lebanese Arabic, using Arabic script.";

// Main system prompt
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

🛒 **Product Catalog:**  

${productList || 'N/A'}

_Note: Each product lists **all its available variants, variants include anything such as sizes, colors, etc...**, with pricing (discounts shown if applicable), stock status, SKU, barcode, and image link._


⚙️ **Description, Services, Benefits & Features:**  
${business.description || 'N/A'}  

🌐 **Website:**  
${business.website || 'N/A'}  

---

### **IMPORTANT RULES**

1. **Scope:**  
   - Only answer questions about the business, its products, services, or general operations.  
   - If the user asks for information not in your context, politely state it’s unavailable and provide phone/email for follow-up:  
     > ${fallbackMessage(lang)}

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

6. **Language Rule (strict):**  
   - If the user message is mainly English: **ALWAYS reply in English.**  
   - If the user message is Arabic (script or Arabizi): **ALWAYS reply in Lebanese Arabic (Arabic script).**  
   - This rule overrides all others.
`.trim()
};

const memorySummary = summaries.get(senderId) || '';


const messages = [
  { role: 'system', content: languageInstruction },
  systemPrompt,
  ...(memorySummary
    ? [{ role: 'system', content: `Conversation memory summary: ${memorySummary}` }]
    : []),
  ...history
];


  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4.1-mini',
      messages,
      temperature: 0.6,
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

await trackUsage(business.id, 'message');



    updateSession(senderId, 'assistant', replyText);
    return { reply: replyText, source: 'ai', layer_used: 'ai', duration };
  } catch (err) {
    const fallbackReply =
      lang === 'english'
        ? "Sorry, I didn't understand. Could you clarify?"
        : "عذرًا ما فهمت تمامًا، فيك توضح أكتر؟";

    const duration = Date.now() - start;
    logToJson({
      layer: 'error',
      senderId,
      businessId: business.id,
      duration,
      message: userMessage,
      error: err.response?.data?.error?.message || err.message
    });
    return { reply: fallbackReply, source: 'error', layer_used: 'error', duration };
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
