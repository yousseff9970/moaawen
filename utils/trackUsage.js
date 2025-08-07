const { MongoClient, ObjectId } = require('mongodb');
const client = new MongoClient(process.env.MONGO_URI);

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
    await client.connect();
    await client.db().collection('businesses').updateOne(
      { _id: new ObjectId(businessId) },
      { $inc: { [field]: amount } }
    );
  } catch (err) {
    console.error('❌ Usage tracking error:', err.message);
  }
}

module.exports = { trackUsage };
