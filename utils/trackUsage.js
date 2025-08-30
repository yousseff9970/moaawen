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
    const db = getDb();
    await db.collection('businesses').updateOne(
      { _id: new ObjectId(businessId) },
      { $inc: { [field]: amount } }
    );
    console.log(`✅ Tracked usage for business ${businessId}: +${amount} ${type}`);
  } catch (err) {
    console.error('❌ Usage tracking error:', err.message);
  }
}

module.exports = { trackUsage };
