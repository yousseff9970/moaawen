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

  // Match WhatsApp
  if (phone_number_id) {
    business = await collection.findOne({ 'channels.whatsapp.phone_number_id': phone_number_id });
    if (business) {
      console.log(`📱 Found business via WhatsApp phone_number_id: ${phone_number_id}`);
      return business;
    }
  }

  // Match Instagram by account/user ID (for direct connections) - try this first for Instagram
  if (!business && instagram_account_id) {
    business = await collection.findOne({
      $or: [
        { 'channels.instagram.page_id': instagram_account_id },           // Facebook Pages connection
        { 'channels.instagram.business_account_id': instagram_account_id }, // Webhook business account ID
        { 'channels.instagram.user_id': instagram_account_id },          // Direct connection user ID
        { 'channels.instagram.account_id': instagram_account_id }         // Direct connection account ID
      ]
    });
    if (business) {
      console.log(`📸 Found business via Instagram account ID: ${instagram_account_id}`);
      return business;
    }
  }

  // Match Instagram or Messenger by page ID (fallback)
  if (!business && page_id) {
    business = await collection.findOne({
      $or: [
        { 'channels.instagram.page_id': page_id },
        { 'channels.instagram.business_account_id': page_id },
        { 'channels.instagram.user_id': page_id },
        { 'channels.instagram.account_id': page_id },
        { 'channels.messenger.page_id': page_id }
      ]
    });
    if (business) {
      console.log(`📄 Found business via page ID: ${page_id}`);
      return business;
    }
  }

  // Match website domain
  if (!business && domain) {
    business = await collection.findOne({ 'channels.website.domain': domain });
  }

  // Match Shopify
  if (!business && shop) {
    business = await collection.findOne({ shop });
  }

  if (!business) {
    throw new Error(`getBusinessInfo: No business found for ${phone_number_id || page_id || domain || shop}`);
  }

  return {
    id: business._id.toString(),
    name: business.name,
    contact: business.contact || {},
    faqs: business.faqs || [],
    description: business.description || [],
    products: business.products || [],
    accessToken: business.accessToken || null,    // ← Shopify token
    settings: business.settings || {},
    shop: business.shop || null,
    channels: business.channels || {},
    website: business.website || null
  };
}

module.exports = { getBusinessInfo };
