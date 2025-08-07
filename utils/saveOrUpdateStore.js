const { MongoClient } = require('mongodb');
const { generateSettingsFromPlan } = require('./applyPlanSettings');

const client = new MongoClient(process.env.MONGO_URI);

async function saveOrUpdateStore(shop, accessToken, storeInfo, flatProducts, collections) {
  await client.connect();
  const col = client.db().collection('businesses');

  const existing = await col.findOne({ shop });

  const doc = {
    shop,
    accessToken,
    name: storeInfo.name,
    description: storeInfo.about || storeInfo.domain,
    website: storeInfo.domain,
    contact: {
      phone: storeInfo.phone,
      email: storeInfo.email,
      whatsapp: '',
      instagram: ''
    },
    products: flatProducts,    // ✅ flat list
    collections: collections,  // ✅ grouped by collection
    updatedAt: new Date()
  };

  // 🟢 Apply Growth plan only on initial creation
  if (!existing) {
    doc.settings = generateSettingsFromPlan('growth');  // free trial
    doc.status = 'active';
    doc.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    doc.createdAt = new Date();
    doc.channels = {};
  }

  await col.updateOne(
    { shop },
    { $set: doc, $setOnInsert: {} },
    { upsert: true }
  );

  return col.findOne({ shop });
}

module.exports = saveOrUpdateStore;
