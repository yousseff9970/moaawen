const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { getBusinessInfo } = require('./business');
const { normalize } = require('./normalize');
const { matchModelResponse, matchFAQSmart } = require('./modelMatcher');
const { loadJsonArrayFile, getBusinessModel } = require('../utils/jsonLoader');
const { logToJson } = require('./jsonLog');
const { trackUsage } = require('../utils/trackUsage');

// ===== Advanced Catalog Builder (organized, compact, relevant) =====
const CATALOG_CFG = {
  maxTags: 6,
  maxProductsPerTag: 6,
  maxVariantsPerProduct: 2,       // only show 2 key variants per product
  preferInStock: true,            // sort in-stock first
  preferDiscounted: true,         // then discounted
  sortByRelevance: true,          // rank by user query relevance
};

function safeText(x, max = 220) {
  if (!x) return '';
  const s = String(x).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function priceNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function primaryTag(p) {
  // Use first tag; fallback to product type, then "Other"
  if (Array.isArray(p.tags) && p.tags.length) return p.tags[0];
  return p.type || 'Other';
}

function aggregateProduct(p) {
  const vs = Array.isArray(p.variants) ? p.variants : [];
  let min = null, max = null, discounted = false, inStockCount = 0;

  for (const v of vs) {
    const dp = priceNum(v.discountedPrice);
    const op = priceNum(v.originalPrice);
    if (dp != null) {
      min = min == null ? dp : Math.min(min, dp);
      max = max == null ? dp : Math.max(max, dp);
    }
    if (v.isDiscounted && op && dp && op > dp) discounted = true;
    if (v.inStock !== false) inStockCount += 1; // treat undefined as in-stock unless you want strict
  }

  return {
    minPrice: min, maxPrice: max,
    discounted,
    inStockCount,
    totalVariants: vs.length
  };
}

function pctDiscount(p) {
  const vs = Array.isArray(p.variants) ? p.variants : [];
  let best = 0;
  for (const v of vs) {
    const op = priceNum(v.originalPrice), dp = priceNum(v.discountedPrice);
    if (op && dp && op > dp) {
      const pct = Math.round(((op - dp) / op) * 100);
      if (pct > best) best = pct;
    }
  }
  return best;
}

function pickTopVariants(p, limit) {
  const vs = Array.isArray(p.variants) ? p.variants : [];
  // sort: in-stock then discounted then cheapest
  const sorted = [...vs].sort((a, b) => {
    const aStock = a.inStock !== false, bStock = b.inStock !== false;
    if (aStock !== bStock) return bStock - aStock;
    const aDisc = a.isDiscounted ? 1 : 0, bDisc = b.isDiscounted ? 1 : 0;
    if (aDisc !== bDisc) return bDisc - aDisc;
    const aP = priceNum(a.discountedPrice) ?? Infinity;
    const bP = priceNum(b.discountedPrice) ?? Infinity;
    return aP - bP;
  });
  return sorted.slice(0, limit).map(v => {
    const label = v.variantName ? `(${v.variantName})` : '';
    let priceDisplay = 'Price N/A';
    const dp = priceNum(v.discountedPrice), op = priceNum(v.originalPrice);
    if (dp != null && op && v.isDiscounted && op > dp) {
      priceDisplay = `~~$${op}~~ ➡️ **$${dp}**`;
    } else if (dp != null) {
      priceDisplay = `$${dp}`;
    }
    const stock = v.inStock === false ? '❌' : '✅';
    const sku = v.sku ? ` • SKU: ${v.sku}` : '';
    const bc = v.barcode ? ` • Barcode: ${v.barcode}` : '';
    return `      • ${label} — ${priceDisplay} ${stock}${sku}${bc}`;
  });
}

function scoreByQuery(p, query) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const hay = [
    p.title, p.description, p.vendor, p.type,
    ...(Array.isArray(p.tags) ? p.tags : [])
  ].join(' ').toLowerCase();
  let s = 0;
  // naive term scoring
  for (const term of q.split(/\W+/).filter(x => x.length > 1)) {
    if (hay.includes(term)) s += 1;
  }
  return s;
}

function buildAdvancedCatalog(userMessage, products = [], cfg = CATALOG_CFG) {
  // group by primary tag
  const groups = {};
  for (const p of products) {
    const tag = primaryTag(p);
    if (!groups[tag]) groups[tag] = [];
    groups[tag].push(p);
  }

  // order tags by relevance (sum of product scores)
  let tagEntries = Object.entries(groups).map(([tag, arr]) => {
    const scored = arr.map(p => ({
      p,
      s: cfg.sortByRelevance ? scoreByQuery(p, userMessage) : 0
    }));
    const score = scored.reduce((a, b) => a + b.s, 0);
    return { tag, products: arr, score };
  }).sort((a, b) => b.score - a.score);

  tagEntries = tagEntries.slice(0, cfg.maxTags);

  const out = [];

  for (const { tag, products } of tagEntries) {
    // sort each tag’s products
    const sorted = [...products].sort((a, b) => {
      const A = aggregateProduct(a), B = aggregateProduct(b);

      // in-stock first
      if (cfg.preferInStock && (A.inStockCount > 0) !== (B.inStockCount > 0)) {
        return (B.inStockCount > 0) - (A.inStockCount > 0);
      }
      // discounted next
      if (cfg.preferDiscounted && A.discounted !== B.discounted) {
        return (B.discounted ? 1 : 0) - (A.discounted ? 1 : 0);
      }
      // cheaper min price first
      const aMin = A.minPrice ?? Infinity, bMin = B.minPrice ?? Infinity;
      if (aMin !== bMin) return aMin - bMin;
      // finally, title
      return String(a.title).localeCompare(String(b.title));
    }).slice(0, cfg.maxProductsPerTag);

    // section header stats
    const stats = sorted.reduce((acc, p) => {
      const a = aggregateProduct(p);
      acc.inStock += a.inStockCount > 0 ? 1 : 0;
      acc.onSale += a.discounted ? 1 : 0;
      return acc;
    }, { inStock: 0, onSale: 0 });

    const header = `## 🗂️ ${tag} — ${sorted.length} products • ${stats.inStock} in stock • ${stats.onSale} on sale`;
    const lines = [header];

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const a = aggregateProduct(p);
      const range = (a.minPrice != null && a.maxPrice != null)
        ? (a.minPrice === a.maxPrice ? `$${a.minPrice}` : `$${a.minPrice}–$${a.maxPrice}`)
        : 'Price N/A';
      const saleBadge = a.discounted ? ` • 🔖 SALE -${pctDiscount(p)}%` : '';
      const stockBadge = a.inStockCount > 0 ? ' • ✅ In stock' : ' • ❌ Out of stock';

      const productHeader =
        `${i + 1}. **${safeText(p.title, 80)}** — ${range}${saleBadge}${stockBadge}\n` +
        `   📝 ${safeText(p.description, 160) || 'No description.'}\n` +
        `   🏷️ Vendor: ${p.vendor || 'N/A'} • 🗂️ Type: ${p.type || 'N/A'}`;

      const variantsBlock = pickTopVariants(p, cfg.maxVariantsPerProduct);
      lines.push(`${productHeader}\n   🔢 Variants:\n${variantsBlock.join('\n')}`);
    }

    out.push(lines.join('\n'));
  }

  return out.join('\n\n');
}


const sessionHistory = new Map();
const sessionTimeouts = new Map();
const replyTimeouts = new Map();
const pendingMessages = new Map();
const summaries = new Map(); // Store long-term memory summaries

// 🔒 Language locks (manual override like "reply in English") → 15 min
const langLocks = new Map(); // senderId -> { lang: 'arabic'|'english', expiresAt: ms }

const generalModelPath = path.join(__dirname, 'mappings/model_general.json');
const generalModel = loadJsonArrayFile(generalModelPath);
const unknownWordsPath = path.join(__dirname, 'unknownWords.json');
if (!fs.existsSync(unknownWordsPath)) fs.writeFileSync(unknownWordsPath, JSON.stringify([]));

// Load short words and arabizi keywords from a separate file
const { shortWordMap, arabiziKeywords } = require('./languageData');
const arabiziRegex = new RegExp(`\\b(${arabiziKeywords.join('|')})\\b`, 'i');

// Minimal helper words (keep tiny)
const EN_WORDS = new Set(['the','and','is','it','this','that','i','you','we','they','price','how','when','where','why','what','hi','hello','thanks','please']);
const AR_WORDS = new Set(['مرحبا','السلام','كيفك','قديش','كم','سعر','شكراً','شكرا','لو','عندي','بدي','بدّي','هيدا','هيك','ليش','وين','امتى']);

/** Map explicit language requests:
 *  - "reply in English", "English please" → english
 *  - "حكيني عربي" → arabic
 *  - "7ki bel 3arabizi" / "arabizi" → arabic (Arabic script enforced, never Arabizi output)
 */
function detectExplicitLangRequest(text) {
  const t = (text || '').toLowerCase();

  // English
  if (/\b(reply|answer|talk|speak)\s+(in|with)\s+english\b/.test(t) || /\benglish please\b/.test(t)) {
    return 'english';
  }

  // Arabic (Arabic script)
  if (/(\b|^)(رد|حكي|احكي|حكيني)\s*(ب|بال)?الع(ر|)بي(ة)?(\b|$)/.test(t) || /\barabic\b/.test(t)) {
    return 'arabic';
  }

  // Arabizi → still Arabic script output
  if (/(7ki|ehki|7akini|hki)\s*(ma3e|m3e)?\s*(bel|bi|b)\s*3arabizi/.test(t) || /\b(3arabizi|arabizi|3rbezi)\b/.test(t)) {
    return 'arabic';
  }

  // Simple switches
  if (/\b(en|english)\b/.test(t) && !/arabic|عرب/.test(t)) return 'english';
  if (/عربي|عرب/.test(t)) return 'arabic';

  return null;
}

/** Advanced language detection (binary target: english | arabic).
 *  - Arabizi is detected as arabic (reply in Arabic script).
 *  - Returns { lang: 'english'|'arabic', confidence }
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
  const hasArabiziCues = hasLatin && (hasDigits || /\b(3|7|2|5|9|sh|kh|gh|aa|ee|ou)\b/i.test(clean));

  const words = clean.toLowerCase().split(/\s+/).slice(0, 40);

  let ar = 0, en = 0;

  // Strong script cues
  if (hasArabicChars) ar += 6;
  if (hasLatin && !hasArabiziCues) en += 4;
  if (hasArabiziCues || arabiziRegex.test(clean)) ar += 3; // Arabizi → Arabic target

  for (const w of words) {
    if (AR_WORDS.has(w)) ar += 1.2;
    if (EN_WORDS.has(w)) en += 1;
    if (/[A-Za-z]+\d+|\d+[A-Za-z]+/.test(w)) ar += 0.8; // more Arabizi hint
    if (words.length === 1 && shortWordMap[w]) {
      if (shortWordMap[w] === 'arabic') ar += 1.2;
      if (shortWordMap[w] === 'english') en += 1.2;
    }
  }

  // Emoji bias (light)
  if (/🇱🇧|🤲|❤️|🕌/.test(clean)) ar += 0.3;
  if (/🇺🇸|👍|✌️|🤞/.test(clean)) en += 0.3;

  // History bias (last 5)
  const recent = lastHistory.slice(-5).map(m => m.lang);
  for (const l of recent) {
    if (l === 'arabic') ar += 0.6;
    if (l === 'english') en += 0.6;
  }
  // Stickiness
  if (lastKnownLanguage === 'arabic') ar += 1.4;
  if (lastKnownLanguage === 'english') en += 1.4;

  const total = ar + en || 1;
  const confidence = Math.max(ar, en) / total;
  let lang = ar >= en ? 'arabic' : 'english';

  // Avoid flips on short/close → prefer last
  const close = Math.abs(ar - en) < 1.25;
  const short = words.length < 3;
  if (short || close) lang = lastKnownLanguage;

  return { lang, confidence };
}

function logUnknownWord(word) {
  const data = JSON.parse(fs.readFileSync(unknownWordsPath, 'utf8'));
  if (!data.includes(word)) {
    data.push(word);
    fs.writeFileSync(unknownWordsPath, JSON.stringify(data, null, 2));
  }
}

/** Memory handling with language tracking */
function updateSession(senderId, role, content) {
  if (!sessionHistory.has(senderId)) sessionHistory.set(senderId, []);
  const history = sessionHistory.get(senderId);

  const lastLang = history.length ? history[history.length - 1].lang : 'arabic';
  const { lang } = detectLanguage(String(content || '').trim(), lastLang, history);

  history.push({ role, content, lang });

  // Summarize if history > 20
  if (history.length > 20) {
    const oldMessages = history.splice(0, history.length - 20);
    const summaryText = oldMessages
      .map(m => `[${m.lang}] ${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join(' ')
      .slice(0, 1200);

    const previousSummary = summaries.get(senderId) || '';
    summaries.set(senderId, `${previousSummary} ${summaryText}`.trim());
  }

  // Reset 10-min timer
  if (sessionTimeouts.has(senderId)) clearTimeout(sessionTimeouts.get(senderId));
  const timeout = setTimeout(() => {
    sessionHistory.delete(senderId);
    sessionTimeouts.delete(senderId);
    summaries.delete(senderId);
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
  const access = checkAccess(business, { messages: true, feature: 'aiReplies' });

  // Target language (computed before early returns)
  // Target language (computed before early returns)
const preHistory = sessionHistory.get(senderId) || [];
const lastLang = preHistory.slice(-1)[0]?.lang || 'arabic';

// Manual override (15m lock)
const requestedLang = detectExplicitLangRequest(userMessage);
const now = Date.now();
let lock = langLocks.get(senderId);
if (requestedLang) {
  langLocks.set(senderId, { lang: requestedLang, expiresAt: now + 15 * 60 * 1000 });
  lock = langLocks.get(senderId);
}

let targetLang;
if (lock && lock.expiresAt > now) {
  // Respect manual lock
  targetLang = lock.lang; // 'english' or 'arabic'
} else {
  const { lang: detected, confidence } = detectLanguage(String(userMessage || '').trim(), lastLang, preHistory);

  // 👇 NEW: if this is the FIRST user message, just use the detection.
  const lastUserMsg = [...preHistory].reverse().find(m => m.role === 'user');
  const isFirstUserTurn = !lastUserMsg;

  if (isFirstUserTurn) {
    targetLang = detected;
  } else {
    // Soft hysteresis for subsequent turns
    const prevUserLang = lastUserMsg.lang;
    if (detected !== lastLang && !(prevUserLang === detected && confidence >= 0.55)) {
      targetLang = lastLang;
    } else {
      targetLang = detected;
    }
  }

  if (lock && lock.expiresAt <= now) langLocks.delete(senderId);
}


  // If access blocked, reply in target language and exit
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

  // ---------- Product catalog grouped by first tag ----------
  // ---------- Advanced, compact, query-relevant catalog ----------
const productList = buildAdvancedCatalog(userMessage, business.products || []);


  // ---------- Language-constrained prompts ----------
  function fallbackMessage(language) {
    if (language === 'arabic') {
      return `عذرًا ما عندي هالمعلومة هلّق. فيك تتواصل معنا عالتليفون ${business.contact?.phone || ''} أو عالإيميل ${business.contact?.email || ''} لمزيد من التفاصيل.`;
    }
    return `I’m sorry, I don’t have that information right now. Please contact us at ${business.contact?.phone || 'N/A'} or ${business.contact?.email || 'N/A'} for more details.`;
  }

  function languageInstructionFor(lang) {
    if (lang === 'english') return [
      "User language: English.",
      "Reply ONLY in natural English.",
      "Do NOT switch languages unless the user explicitly asks or writes two consecutive messages in another language."
    ].join(' ');

    // Arabic target: Lebanese Arabic in Arabic script ONLY
    return [
      "User language: Arabic (Lebanese).",
      "Reply ONLY in Lebanese Arabic using ARABIC SCRIPT (Arabic letters).",
      "NEVER use Latin letters or numerals to represent Arabic sounds (no Arabizi).",
      "Do NOT switch languages unless the user explicitly asks or writes two consecutive messages in another language."
    ].join(' ');
  }

  const languageInstruction = languageInstructionFor(targetLang);

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

   5) Catalog answers (formatting)
   - When the user asks about products, respond with:
     • A short intro sentence (1 line).
     • Sections grouped by collection/tag (use the most relevant collections first).
     • For each product: title, price range, SALE badge if discounted, and clear in-stock/out-of-stock status.
     • Show up to 2 key variants (best choices first).
   - Never dump the entire catalog; keep it concise and relevant.
   - If the user gives filters (size, color, budget), apply them and show only matching items.


6) **Language (strict)**
   - The current target language is **${targetLang}**.
   - If Arabic: write **only in Arabic script** (no Latin transliteration, no numbers like 3/7).
   - Do **not** switch languages unless explicitly asked or after two consecutive user messages in another language.
`.trim()
  };

  // Extra hard guard to stop switching/Arabizi
  const strictGuard = {
    role: 'system',
    content: targetLang === 'arabic'
      ? "STRICT OUTPUT: Use ARABIC SCRIPT only. Never use Latin letters or numerals for Arabic (no Arabizi). Any other script is INVALID."
      : "STRICT OUTPUT: English only. Any other language/script is INVALID."
  };

  const memorySummary = summaries.get(senderId) || '';
  const history = (sessionHistory.get(senderId) || []).map(({ role, content }) => ({ role, content })); // strip lang

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
      temperature: 1,
      max_completions_tokens: 1400
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

    const fallbackReply =
      targetLang === 'english'
        ? "Sorry, I didn't understand. Could you clarify?"
        : 'عذرًا ما فهمت تمامًا، فيك توضح أكتر؟';

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
  }, 1000); // 1s

  replyTimeouts.set(senderId, timeout);
};

module.exports = { generateReply, scheduleBatchedReply, detectLanguage };
