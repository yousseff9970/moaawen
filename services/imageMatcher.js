const { imageHash } = require('image-hash');
const fs = require('fs');
const path = require('path');
const hamming = require('hamming-distance');
const { getBusinessInfo } = require('./business');

const hashFile = path.join(__dirname, '..', 'data', 'product_hashes.json');
const productHashes = fs.existsSync(hashFile) ? JSON.parse(fs.readFileSync(hashFile)) : {};

function getHash(filePath) {
  return new Promise((resolve, reject) => {
    imageHash(filePath, 16, true, (error, hash) => {
      if (error) reject(error);
      else resolve(hash);
    });
  });
}

function compareHashes(hash1, hash2) {
  return hamming(Buffer.from(hash1, 'hex'), Buffer.from(hash2, 'hex'));
}

async function matchImageAndGenerateReply(userId, imagePath, metadata = {}) {
  const imageHashVal = await getHash(imagePath);

  let bestMatch = null;
  let bestScore = Infinity;

  for (const [productId, hash] of Object.entries(productHashes)) {
    const dist = compareHashes(imageHashVal, hash);
    if (dist < bestScore) {
      bestScore = dist;
      bestMatch = productId;
    }
  }

  const business = await getBusinessInfo(metadata);
  const product = business.products?.find(p => p.id == bestMatch);

  if (bestMatch && bestScore <= 10 && product) {
    return {
      reply: `✅ هذه صورة لمنتجنا **${product.name}**\n💰 السعر: ${product.price}\n📦 ${product.description}`,
      matched: true
    };
  }

  // No match found — no AI fallback
  return {
    reply: '❓ لم أتمكن من التعرف على هذا المنتج. تأكد من وضوح الصورة أو اكتب اسم المنتج.',
    matched: false
  };
}

module.exports = { matchImageAndGenerateReply };
