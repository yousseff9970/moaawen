const fs = require('fs');
const axios = require('axios');
const path = require('path');

async function downloadMedia(mediaUrl, filename, headers = {}) {
  const filePath = path.join(__dirname, '..', 'media', filename);
  const writer = fs.createWriteStream(filePath);
  const response = await axios.get(mediaUrl, { responseType: 'stream', headers });
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(filePath));
    writer.on('error', reject);
  });
}

module.exports = { downloadMedia };
