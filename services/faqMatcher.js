

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

module.exports = { matchFAQSmart };