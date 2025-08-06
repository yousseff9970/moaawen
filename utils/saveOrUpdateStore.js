async function saveOrUpdateStore(shop, accessToken, storeInfo, flatProducts, collections) {
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
    products: flatProducts,    // ✅ flat list
    collections: collections,  // ✅ grouped by collection
    updatedAt: new Date()
  };

  await col.updateOne(
    { shop },
    { $set: doc, $setOnInsert: { createdAt: new Date(), channels: {} } },
    { upsert: true }
  );

  return col.findOne({ shop });
}
