const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGO_URI);

async function saveOrUpdateStore(shop, accessToken, storeInfo, fullProducts) {
  await client.connect();
  const col = client.db().collection('businesses');

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
    products: fullProducts,
    updatedAt: new Date()
  };

  await col.updateOne(
    { shop },
    { $set: doc, $setOnInsert: { createdAt: new Date(), channels: {} } },
    { upsert: true }
  );

  return col.findOne({ shop });
}

module.exports = saveOrUpdateStore;
