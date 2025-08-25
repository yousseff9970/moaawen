const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGO_URI);

async function getBusinessInfo({ phone_number_id, page_id, domain, shop, instagram_account_id }) {
  if (!phone_number_id && !page_id && !domain && !shop && !instagram_account_id) {
    throw new Error('getBusinessInfo: Missing all identifiers (phone_number_id, page_id, domain, shop, instagram_account_id)');
  }

  await client.connect();
  const db = client.db(process.env.DB_NAME || 'moaawen');
  const collection = db.collection('businesses');

  let business = null;

  console.log('🔍 Business lookup started:', { phone_number_id, page_id, domain, shop, instagram_account_id });

  // Match WhatsApp
  if (phone_number_id) {
    business = await collection.findOne({ 'channels.whatsapp.phone_number_id': phone_number_id });
    if (business) {
      console.log(`📱 Found business via WhatsApp phone_number_id: ${phone_number_id}`);
      return business;
    }
  }

  // Match Instagram by account ID - Enhanced for new structure
  if (!business && instagram_account_id) {
    console.log(`🔍 Looking for Instagram account: ${instagram_account_id}`);
    
    // Try direct Instagram channel lookup (new structure)
    business = await collection.findOne({
      [`channels.instagram_${instagram_account_id}.connected`]: true
    });
    
    if (business) {
      console.log(`📸 Found business via new Instagram channel structure: ${instagram_account_id}`);
      return business;
    }
    
    // Try facebook_business.instagram_accounts lookup using Instagram ID
    business = await collection.findOne({
      [`channels.facebook_business.instagram_accounts.${instagram_account_id}`]: { $exists: true }
    });
    
    if (business) {
      console.log(`📸 Found business via Facebook Business Instagram accounts (Instagram ID): ${instagram_account_id}`);
      return business;
    }
    
    // Try legacy structure lookups for backward compatibility
    business = await collection.findOne({
      $or: [
        { 'channels.instagram_direct.instagram_business_account_id': instagram_account_id },
        { 'channels.instagram.page_id': instagram_account_id },
        { 'channels.instagram.business_account_id': instagram_account_id },
        { 'channels.instagram.user_id': instagram_account_id },
        { 'channels.instagram.account_id': instagram_account_id }
      ]
    });
    
    if (business) {
      console.log(`📸 Found business via legacy Instagram structure: ${instagram_account_id}`);
      return business;
    }
    
    console.log(`❌ No business found for Instagram account: ${instagram_account_id}`);
  }

  // Match Instagram or Messenger by page ID (fallback)
  if (!business && page_id) {
    console.log(`🔍 Looking for page: ${page_id}`);
    
    // Try Instagram channel lookup by page ID
    business = await collection.findOne({
      [`channels.instagram_${page_id}.connected`]: true
    });
    
    if (business) {
      console.log(`📄 Found business via Instagram channel page ID: ${page_id}`);
      return business;
    }
    
    // Try Facebook Pages lookup
    business = await collection.findOne({
      [`channels.facebook_business.pages.${page_id}`]: { $exists: true }
    });
    
    if (business) {
      console.log(`📄 Found business via Facebook Business page: ${page_id}`);
      return business;
    }
    
    // Try legacy Instagram/Messenger lookup
    business = await collection.findOne({
      $or: [
        { 'channels.instagram.page_id': page_id },
        { 'channels.messenger.page_id': page_id }
      ]
    });
    
    if (business) {
      console.log(`📄 Found business via legacy page structure: ${page_id}`);
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
      console.log(`🛒 Found business via Shopify shop: ${shop}`);
      return business;
    }
  }

  if (!business) {
    throw new Error(`getBusinessInfo: No business found for ${phone_number_id || page_id || instagram_account_id || domain || shop}`);
  }

  return {
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
