const getDb = require('../db');
const { ObjectId } = require('bson')

async function trackUsage(businessId, type, amount = 1) {
  if (!businessId || !type) return;

  const fieldMap = {
    message: 'settings.usedMessages',
    voice: 'settings.usedVoiceMinutes',
    image: 'settings.imageAnalysesUsed'
  };

  const field = fieldMap[type];
  if (!field) return;

  try {
  
     const db = await getDb();
    
    const businessesCol = db.collection('businesses');
    await businessesCol.updateOne(
      { _id: ObjectId(businessId) },
      { $inc: { [field]: amount } }
    );
    console.log(`✅ Tracked usage for business ${businessId}: +${amount} ${type}`);
  } catch (err) {
    console.error('❌ Usage tracking error:', err.message);
  }
}

module.exports = { trackUsage };
