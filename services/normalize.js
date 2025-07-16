const fs = require('fs');
const path = require('path');

const mappingPath = path.join(__dirname, 'mappings/arabizi_mapping.json');
const pendingPath = path.join(__dirname, 'mappings/pending_mappings.json');
const arabiziMap = fs.existsSync(mappingPath) ? JSON.parse(fs.readFileSync(mappingPath)) : {};
let pendingMap = fs.existsSync(pendingPath) ? JSON.parse(fs.readFileSync(pendingPath)) : {};

function saveArabiziMap() {
  fs.writeFileSync(mappingPath, JSON.stringify(arabiziMap, null, 2));
}
function savePendingMap() {
  fs.writeFileSync(pendingPath, JSON.stringify(pendingMap, null, 2));
}

function normalize(str) {
  let text = str.toLowerCase()
    .replace(/(.)\1{2,}/g, '$1')
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = text.split(' ');
  const normalizedWords = words.map(word => {
    if (arabiziMap[word]) return arabiziMap[word];
    pendingMap[word] = (pendingMap[word] || 0) + 1;
    if (pendingMap[word] >= 3) {
      arabiziMap[word] = word;
      delete pendingMap[word];
      saveArabiziMap();
    }
    savePendingMap();
    return word;
  });

  return normalizedWords.join(' ');
}


module.exports = { normalize };