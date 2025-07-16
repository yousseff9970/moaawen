// utils/intent.js
const phraseModel = require('./phrase_model.json');

function classifyIntent(text) {
  const raw = text.toLowerCase().replace(/[\p{P}\p{S}]/gu, '').replace(/\s+/g, ' ').trim();
  const words = raw.split(' ');

  for (const [intent, group] of Object.entries(phraseModel)) {
    for (const word of words) {
      const cleanWord = word.replace(/[^a-z0-9]/gi, '');
      if (group.some(entry => entry.lebenglish.toLowerCase().replace(/[^a-z0-9]/gi, '') === cleanWord)) {
        return intent;
      }
    }
  }

  return 'general';
}

module.exports = classifyIntent;
