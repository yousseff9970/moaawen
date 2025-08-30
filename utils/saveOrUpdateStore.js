const getDb = require('../db');
const { generateSettingsFromPlan } = require('./applyPlanSettings');



async function saveOrUpdateStore(shop, accessToken, storeInfo, flatProducts, collections) {
  
  
  const db = await getDb();
  const col = db.collection('businesses');

  const existing = await col.findOne({ shop });
  //console.log(`${existing ? '🔄 Updating existing' : '🆕 Creating new'} business record for ${shop}`);

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
  

  return savedBusiness;
}

module.exports = saveOrUpdateStore;
