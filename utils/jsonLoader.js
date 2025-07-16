const fs = require('fs');
const path = require('path');

function getBusinessModel(businessId) {
  const filePath = path.join(__dirname, `mappings/business_models/model_${businessId}.json`);
  return loadJsonArrayFile(filePath);
}


function loadJsonArrayFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(json) ? json : [];
  } catch (err) {
    console.error(`Failed to load JSON array at ${filePath}:`, err.message);
    return [];
  }
}

module.exports = { loadJsonArrayFile, getBusinessModel };