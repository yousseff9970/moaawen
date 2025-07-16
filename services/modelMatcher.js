const { normalize } = require('./normalize');

function matchFAQSmart(userMessage, faqs, threshold = 0.5) {
  const userWords = new Set(normalize(userMessage).split(' '));
  let best = null, bestScore = 0;

  for (const faq of faqs) {
    const faqWords = new Set(normalize(faq.question).split(' '));
    let matches = 0;
    for (const word of userWords) {
      if (faqWords.has(word)) matches++;
    }

    const score = matches / faqWords.size;
    if (score > bestScore && score >= threshold) {
      best = faq;
      bestScore = score;
    }
  }

  return best?.answer || null;
}

function matchModelResponse(normalizedMsg, modelData) {
  for (const entry of modelData) {
    const sources = {
      lebenglish: entry.lebenglish || [],
      arabic: entry.arabic || [],
      english: entry.english || []
    };

    for (const [lang, phrases] of Object.entries(sources)) {
      const normalizedPhrases = phrases.map(p => normalize(p));
      if (normalizedPhrases.includes(normalizedMsg)) {
        return {
          reply: entry.response?.[lang] || entry.response,
          intent: entry.intent,
          language: lang
        };
      }
    }
  }

  return null;
}

module.exports = { matchModelResponse, matchFAQSmart };