const fs = require('fs');
const path = require('path');
const { imageHash } = require('image-hash');

const imageDir = path.join(__dirname, '..', 'assets/images');
const outputPath = path.join(__dirname, '..', 'data', 'product_hashes.json');

function getHash(filePath) {
  return new Promise((resolve, reject) => {
    imageHash(filePath, 16, true, (err, hash) => {
      if (err) reject(err);
      else resolve(hash);
    });
  });
}

async function generateHashes() {
  const files = fs.readdirSync(imageDir).filter(file => /\.(jpg|jpeg|png)$/i.test(file));
  const hashes = {};

  for (const file of files) {
    const productId = path.parse(file).name;
    const filePath = path.join(imageDir, file);
    try {
      const hash = await getHash(filePath);
      hashes[productId] = hash;
      console.log(`✅ ${productId}: ${hash}`);
    } catch (err) {
      console.error(`❌ Failed to hash ${file}:`, err.message);
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(hashes, null, 2));
  console.log(`🧠 Saved to ${outputPath}`);
}

generateHashes();
