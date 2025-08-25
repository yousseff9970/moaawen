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
  }

  // Match Instagram by account/user ID (for direct connections)
  if (!business && instagram_account_id) {
    business = await collection.findOne({
      $or: [
        { 'channels.instagram.user_id': instagram_account_id },
        { 'channels.instagram.account_id': instagram_account_id },
        { 'channels.instagram.business_account_id': instagram_account_id },
        { 'channels.instagram.page_id': instagram_account_id }
      ]
    });
  }

  // Match Instagram or Messenger by page ID
  if (!business && page_id) {
    business = await collection.findOne({
      $or: [
        { 'channels.instagram.page_id': page_id },
        { 'channels.instagram.user_id': page_id },
        { 'channels.instagram.account_id': page_id },
        { 'channels.instagram.business_account_id': page_id },
        { 'channels.messenger.page_id': page_id }
      ]
    });
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
