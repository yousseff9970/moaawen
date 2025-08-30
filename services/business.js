const getDb = require('../db');

async function getBusinessInfo({ phone_number_id, page_id, domain, shop, instagram_account_id }) {
  if (!phone_number_id && !page_id && !domain && !shop && !instagram_account_id) {
    throw new Error('getBusinessInfo: Missing all identifiers (phone_number_id, page_id, domain, shop, instagram_account_id)');
  }


  const db = await getDb();
  const collection = db.collection('businesses');

  let business = null;

  //console.log('🔍 Business lookup started:', { phone_number_id, page_id, domain, shop, instagram_account_id });

  // Match WhatsApp
  if (phone_number_id) {
    business = await collection.findOne({ 'channels.whatsapp.phone_number_id': phone_number_id });
    if (business) {
      //console.log(`📱 Found business via WhatsApp phone_number_id: ${phone_number_id}`);
      return business;
    }
  }

  // Match Instagram by account ID
  if (!business && instagram_account_id) {
    //console.log(`🔍 Looking for Instagram account: ${instagram_account_id}`);
    
    business = await collection.findOne({ 'channels.instagram.account_id': instagram_account_id });
    
    if (business) {
      //console.log(`📸 Found business via Instagram account_id: ${instagram_account_id}`);
      return business;
    }

    //console.log(`❌ No business found for Instagram account: ${instagram_account_id}`);
  }

  // Match Messenger by page ID
  if (!business && page_id) {
    //console.log(`🔍 Looking for page: ${page_id}`);
    
    business = await collection.findOne({ 'channels.messenger.page_id': page_id });
    
    if (business) {
      // console.log(`📄 Found business via Messenger page_id: ${page_id}`);
      return business;
    }
  }

  // Match website domain
  if (!business && domain) {
    business = await collection.findOne({ 'channels.website.domain': domain });
    if (business) {
      console.log(`🌐 Found business via website domain: ${domain}`);
      return business;
    }
  }

  // Match Shopify
  if (!business && shop) {
    business = await collection.findOne({ shop });
    if (business) {
      //console.log(`🛒 Found business via Shopify shop: ${shop}`);
      return business;
    }
  }

  if (!business) {
    throw new Error(`getBusinessInfo: No business found for ${phone_number_id || page_id || instagram_account_id || domain || shop}`);
  }

  return {
    trackid: business.id,
    id: business._id.toString(),
    name: business.name,
    contact: business.contact || {},
    faqs: business.faqs || [],
    description: business.description || [],
    products: business.products || [],
    accessToken: business.accessToken || null,
    settings: business.settings || {},
    shop: business.shop || null,
    channels: business.channels || {},
    website: business.website || null
  };
}

module.exports = { getBusinessInfo };
