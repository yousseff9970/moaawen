const { MongoClient } = require('mongodb');
const { generateSettingsFromPlan } = require('./applyPlanSettings');

const client = new MongoClient(process.env.MONGO_URI);

async function saveOrUpdateStore(shop, accessToken, storeInfo, flatProducts, collections) {
  console.log(`💾 Saving store data for ${shop}...`);
  
  await client.connect();
  const col = client.db().collection('businesses');

  const existing = await col.findOne({ shop });
  console.log(`${existing ? '🔄 Updating existing' : '🆕 Creating new'} business record for ${shop}`);

  // Validate product data structure
  let totalVariants = 0;
  let variantsWithStock = 0;
  let variantsInStock = 0;

  flatProducts.forEach(product => {
    if (product.variants && Array.isArray(product.variants)) {
      product.variants.forEach(variant => {
        totalVariants++;
        if (variant.hasOwnProperty('inStock')) {
          variantsWithStock++;
          if (variant.inStock === true) {
            variantsInStock++;
          }
        }
      });
    }
  });

  console.log(`📊 Data Validation:
    • Products: ${flatProducts.length}
    • Collections: ${collections.length}
    • Total variants: ${totalVariants}
    • Variants with stock data: ${variantsWithStock}
    • Variants in stock: ${variantsInStock}
    • Stock data coverage: ${totalVariants > 0 ? ((variantsWithStock / totalVariants) * 100).toFixed(1) : 0}%`);

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
    products: flatProducts,
    collections: collections,
    updatedAt: new Date()
  };

  // 🟢 Apply Growth plan only on initial creation
  if (!existing) {
    doc.settings = generateSettingsFromPlan('growth');
    doc.status = 'active';
    doc.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    doc.createdAt = new Date();
    doc.channels = {};
    console.log('🎁 Applied Growth plan with 30-day trial');
  }

  await col.updateOne(
    { shop },
    { $set: doc, $setOnInsert: {} },
    { upsert: true }
  );

  const savedBusiness = await col.findOne({ shop });
  
  // Final validation of saved data
  const savedProducts = savedBusiness.products || [];
  const savedVariantCount = savedProducts.reduce((count, p) => count + (p.variants?.length || 0), 0);
  
  console.log(`✅ Successfully saved:
    • Business: ${savedBusiness.name}
    • Products: ${savedProducts.length}
    • Variants: ${savedVariantCount}
    • Collections: ${savedBusiness.collections?.length || 0}`);

  return savedBusiness;
}

module.exports = saveOrUpdateStore;
