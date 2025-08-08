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

// 🔒 Language locks (manual override like "reply in English") → 15 min
const langLocks = new Map(); // senderId -> { lang: 'arabic'|'arabizi'|'english', expiresAt: ms }

const generalModelPath = path.join(__dirname, 'mappings/model_general.json');
const generalModel = loadJsonArrayFile(generalModelPath);
const unknownWordsPath = path.join(__dirname, 'unknownWords.json');
if (!fs.existsSync(unknownWordsPath)) fs.writeFileSync(unknownWordsPath, JSON.stringify([]));

// Load short words and arabizi keywords from a separate file
const { shortWordMap, arabiziKeywords } = require('./languageData');

// Compile arabizi keywords into regex for faster detection
const arabiziRegex = new RegExp(`\\b(${arabiziKeywords.join('|')})\\b`, 'i');

// Tiny helper stopwords (keep small)
const EN_WORDS = new Set(['the','and','is','it','this','that','i','you','we','they','price','how','when','where','why','what','hi','hello','thanks','please']);
const AR_WORDS = new Set(['مرحبا','السلام','كيفك','قديش','كم','سعر','شكراً','شكرا','لو','عندي','بدّي','بدي','هيدا','هيك','ليش','وين','امتى']);

/**
 * Detect explicit language requests like:
 *  - "reply in English", "English please"
 *  - "حكيني عربي"
 *  - "7ki bel 3arabizi" / "arabizi"
 */
function detectExplicitLangRequest(text) {
  const t = (text || '').toLowerCase();

  // English
  if (/\b(reply|answer|talk|speak)\s+(in|with)\s+english\b/.test(t) || /\benglish please\b/.test(t)) {
    return 'english';
  }

  // Arabic (Arabic script)
  if (/(\b|^)(رد|حكي|احكي|حكيني)\s*(ب|بال)?الع(ر|)بي(ة)?(\b|$)/.test(t) || /\b(arabic)\b/.test(t)) {
    return 'arabic';
  }

  // Arabizi
  if (/(7ki|ehki|7akini|hki)\s*(ma3e|m3e)?\s*(bel|bi|b)\s*3arabizi/.test(t) || /\b3arabizi|arabizi|3rbezi\b/.test(t)) {
    return 'arabizi';
  }

  // Simple switches
  if (/\b(en|english)\b/.test(t) && !/arabic|عرب/.test(t)) return 'english';
  if (/عربي|عرب/.test(t)) return 'arabic';
  if (/3arabizi|arabizi|3rbezi/.test(t)) return 'arabizi';

  return null;
}

/**
 * Advanced language detection with fallback & stickiness.
 * Returns { lang: 'arabic'|'arabizi'|'english', confidence: 0..1 }
 */
function detectLanguage(text, lastKnownLanguage = 'arabic', lastHistory = []) {
  if (!text || typeof text !== 'string') return { lang: lastKnownLanguage, confidence: 1 };

  const clean = text.trim();

  // Only punctuation/emoji → keep last
  if (/^[\s\p{P}\p{S}\p{Emoji_Presentation}]+$/u.test(clean)) {
    return { lang: lastKnownLanguage, confidence: 0.6 };
  }

  const hasArabicChars = /[\u0600-\u06FF]/.test(clean);
  const hasLatin = /[A-Za-z]/.test(clean);
  const hasDigits = /\d/.test(clean);

  // Arabizi cues: Latin + digits or common combos
  const hasArabiziCues = hasLatin && (hasDigits || /\b(3|7|2|5|9|sh|kh|gh|aa|ee|ou)\b/i.test(clean));

  const words = clean.toLowerCase().split(/\s+/).slice(0, 40);

  let ar = 0, en = 0, az = 0;

  if (hasArabicChars) ar += 5;
  if (hasArabiziCues) az += 4;
  if (hasLatin && !hasArabiziCues) en += 3;

  for (const w of words) {
    if (AR_WORDS.has(w)) ar += 1.5;
    if (EN_WORDS.has(w)) en += 1;
    // digits inside a Latin token → Arabizi boost
    if (/[A-Za-z]+\d+|\d+[A-Za-z]+/.test(w)) az += 1;
    // dictionary-like arabizi keyword match
    if (arabiziRegex.test(w)) az += 0.6;
    // short single-word messages: use your map
    if (words.length === 1 && shortWordMap[w]) {
      if (shortWordMap[w] === 'arabic') ar += 2;
      if (shortWordMap[w] === 'arabizi') az += 2;
      if (shortWordMap[w] === 'english') en += 2;
    }
  }

  // light emoji bias
  if (/🇱🇧|🤲|❤️|🕌/.test(clean)) ar += 0.3;
  if (/🇺🇸|👍|✌️|🤞/.test(clean)) en += 0.3;

  // History bias (last 5)
  const recent = lastHistory.slice(-5).map(m => m.lang);
  for (const l of recent) {
    if (l === 'arabic') ar += 0.6;
    if (l === 'arabizi') az += 0.8;
    if (l === 'english') en += 0.6;
  }
  // Stickiness to last
  if (lastKnownLanguage === 'arabic') ar += 1.2;
  if (lastKnownLanguage === 'arabizi') az += 1.2;
  if (lastKnownLanguage === 'english') en += 1.2;

  const scores = { arabic: ar, arabizi: az, english: en };
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topLang, topScore] = sorted[0];
  const [secLang, secScore] = sorted[1] || [null, 0];

  const total = ar + az + en || 1;
  const confidence = topScore / total;

  // Avoid flips on short msgs or close scores: prefer lastKnownLanguage
  const close = Math.abs(topScore - secScore) < 1.25;
  const short = words.length < 3;
  const lang = (short || close) ? lastKnownLanguage : topLang;

  return { lang, confidence };
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
  const { lang } = detectLanguage(String(content || '').trim(), lastLang, history);

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

  // 🛡️ Plan/access check
  const { checkAccess } = require('../utils/businessPolicy');
  const access = checkAccess(business, {
    messages: true,
    feature: 'aiReplies'
  });

  // Language target calculation (before any early returns)
  const preHistory = sessionHistory.get(senderId) || [];
  const lastLang = preHistory.slice(-1)[0]?.lang || 'arabic';

  // Manual override lock?
  const requestedLang = detectExplicitLangRequest(userMessage);
  const now = Date.now();
  let lock = langLocks.get(senderId);
  if (requestedLang) {
    langLocks.set(senderId, { lang: requestedLang, expiresAt: now + 15 * 60 * 1000 });
    lock = langLocks.get(senderId);
  }

  let targetLang;
  if (lock && lock.expiresAt > now) {
    targetLang = lock.lang;
  } else {
    const { lang: detected, confidence } = detectLanguage(String(userMessage || '').trim(), lastLang, preHistory);

    // Require previous user msg to match new language (soft hysteresis)
    const lastUserMsg = [...preHistory].reverse().find(m => m.role === 'user');
    const prevUserLang = lastUserMsg?.lang;

    if (detected !== lastLang && !(prevUserLang === detected && confidence >= 0.55)) {
      targetLang = lastLang;
    } else {
      targetLang = detected;
    }

    if (lock && lock.expiresAt <= now) langLocks.delete(senderId);
  }

  // If access blocked, reply in the right language and exit
  if (!access.allowed) {
    const reason = access.reasons.join(', ');
    const fallbackMessage = (language) => {
      if (language === 'arabic') {
        if (access.reasons.includes('expired')) return '⚠️ اشتراكك انتهى. جدد الخطة للاستمرار.';
        if (access.reasons.includes('inactive')) return '⚠️ الحساب غير مفعل حالياً.';
        if (access.reasons.includes('message_limit')) return '⚠️ وصلت للحد الأقصى من الرسائل. تحتاج لترقية.';
        if (access.reasons.find(r => r.startsWith('feature'))) return '🚫 هذه الميزة غير متوفرة في خطتك الحالية.';
        return '🚫 لا يمكنك استخدام هذه الميزة حالياً.';
      }

      if (language === 'arabizi') {
        if (access.reasons.includes('expired')) return '⚠️ el eshterak khallas. jadded l plan la tekammel.';
        if (access.reasons.includes('inactive')) return '⚠️ el hesab mesh mef3al.';
        if (access.reasons.includes('message_limit')) return '⚠️ woselna lal 7ad el ma7doud. 7awwel terka.';
        if (access.reasons.find(r => r.startsWith('feature'))) return '🚫 hal feature mesh available bel plan taba3ak.';
        return '🚫 ma feek tista3mel hal feature.';
      }

      // English
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
      ai_reply: fallbackMessage(targetLang),
      duration: 0
    });

    return {
      reply: fallbackMessage(targetLang),
      source: 'policy',
      layer_used: 'plan_check',
      duration: 0
    };
  }

  // Intent/model/FAQ
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

  // Store the user message (this also tags it with detected lang internally)
  updateSession(senderId, 'user', userMessage);

  // ---------- Product catalog grouped by first tag ----------
  const groupedByTag = (business.products || []).reduce((acc, product) => {
    const tag = (product.tags && product.tags[0]) || 'Other';
    if (!acc[tag]) acc[tag] = [];
    acc[tag].push(product);
    return acc;
  }, {});

  const productList = Object.entries(groupedByTag)
    .map(([tag, products]) => {
      const tagHeader = `## 🗂️ ${tag}`;
      const productsText = products.map((p, i) => {
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

      return `${tagHeader}\n${productsText}`;
    })
    .join('\n\n');

  // ---------- Language-constrained prompts ----------
  function fallbackMessage(language) {
    if (language === 'arabic') {
      return `عذرًا ما عندي هالمعلومة هلّق. فيك تتواصل معنا عالتليفون ${business.contact?.phone || ''} أو عالإيميل ${business.contact?.email || ''} لمزيد من التفاصيل.`;
    }
    if (language === 'arabizi') {
      // Keep your older style
      return `Sorry ma 3nde hal ma3lome 7aliyan fikon tetwasalo m3na 3al ${business.contact?.phone || ''} aw email ${business.contact?.email || ''}.`;
    }
    return `I’m sorry, I don’t have that information right now. Please contact us at ${business.contact?.phone || 'N/A'} or ${business.contact?.email || 'N/A'} for more details.`;
  }

  function languageInstructionFor(lang) {
    if (lang === 'english') return [
      "User language: EN.",
      "Reply ONLY in natural English.",
      "Do NOT switch languages unless the user explicitly asks or writes two consecutive messages in another language."
    ].join(' ');

    if (lang === 'arabizi') return [
      "User language: Arabizi (Lebanese Arabic using Latin letters + numerals).",
      "Reply ONLY in Lebanese Arabizi (use forms like 3=ع, 7=ح, kh, gh, etc.).",
      "Avoid Arabic script. Do NOT switch languages unless explicitly asked."
    ].join(' ');

    return [
      "User language: Arabic (Lebanese).",
      "Reply ONLY in Lebanese Arabic using Arabic script.",
      "Do NOT switch languages unless the user explicitly asks or writes two consecutive messages in another language."
    ].join(' ');
  }

  const languageInstruction = languageInstructionFor(targetLang);

  // Main system prompt (language rules adjusted to mirror chosen targetLang)
  const systemPrompt = {
    role: 'system',
    content: `
You are Moaawen, the helpful assistant for ${business.name} in Lebanon.
Use the conversation history and memory summary as context to respond accurately.

**Memory Handling**
- Refer back to previous user messages whenever relevant.
- If a question was already answered, use that information instead of asking again.
- If you are unsure or the info is missing, politely ask for clarification.
- Do not repeat the same questions unnecessarily.

---

📞 **Contact Details**
- Phone: ${business.contact?.phone || 'N/A'}
- Email: ${business.contact?.email || 'N/A'}
- WhatsApp: ${business.contact?.whatsapp || 'N/A'}
- Instagram: ${business.contact?.instagram || 'N/A'}

🛒 **Product Catalog**

${productList || 'N/A'}

_Note: Each product lists **all its available variants** (sizes, colors, etc.), with pricing (discounts shown if applicable), stock status, SKU, barcode, and image link._

⚙️ **Description, Services, Benefits & Features**
${business.description || 'N/A'}

🌐 **Website**
${business.website || 'N/A'}

---

### **IMPORTANT RULES**

1) **Scope**
   - Only answer questions about the business, its products, services, or general operations.
   - If the user asks for information not in your context, politely state it’s unavailable and provide phone/email for follow-up:
     > ${fallbackMessage(targetLang)}

2) **Greetings**
   - For casual greetings (e.g., “Hi”, “Good morning”, “كيفك”): respond politely & briefly, then guide the user back to the business:
     > "I’m doing well, thank you! How can I assist you with ${business.name} today?"

3) **Irrelevant Questions**
   - For topics like politics, religion, news, or anything unrelated:
     > "I can only answer questions related to ${business.name}. How can I assist you today?"

4) **Response Style**
   - Be structured and organized (use paragraphs and bullet points when needed).
   - Be concise but clear.

5) **Language (strict)**
   - The current target language is **${targetLang}**.
   - Always reply in the target language.
   - Do **not** switch languages unless the user explicitly asks or writes two consecutive messages in another language.
`.trim()
  };

  // Extra hard guard to stop the model from switching languages
  const strictGuard = {
    role: 'system',
    content: `STRICT OUTPUT LANGUAGE: ${targetLang.toUpperCase()}. If you output any other language, your answer is INVALID. Start directly with the answer.`
  };

  const memorySummary = summaries.get(senderId) || '';
  const history = (sessionHistory.get(senderId) || []).map(({ role, content }) => ({ role, content })); // strip "lang" before sending to API

  const messages = [
    { role: 'system', content: languageInstruction },
    systemPrompt,
    ...(memorySummary ? [{ role: 'system', content: `Conversation memory summary: ${memorySummary}` }] : []),
    ...history,
    strictGuard
  ];

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-5-mini',
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
      targetLang === 'english'
        ? "Sorry, I didn't understand. Could you clarify?"
        : (targetLang === 'arabizi'
            ? 'Sorry ma fhemet mni7, fiik t2oulha btor2a awda7?'
            : 'عذرًا ما فهمت تمامًا، فيك توضح أكتر؟');

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

module.exports = { generateReply, scheduleBatchedReply, detectLanguage };
