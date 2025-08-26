// routes/auth/business.js
const { express, ObjectId, axios, client } = require('./shared');

const router = express.Router();

// Get Facebook pages for business channel connections
router.get('/pages/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessCol = db.collection('businesses');

    const business = await businessCol.findOne({ _id: new ObjectId(businessId) });
    if (!business || !business.channels?.facebook?.access_token) {
      return res.status(400).json({ error: 'Facebook account not connected' });
    }

    const access_token = business.channels.facebook.access_token;

    // Get user's Facebook pages
    const pagesResponse = await axios.get('https://graph.facebook.com/v23.0/me/accounts', {
      params: {
        access_token: access_token,
        fields: 'id,name,access_token,instagram_business_account'
      }
    });

    const pages = pagesResponse.data.data || [];

    res.json({
      success: true,
      pages: pages
    });

  } catch (error) {
    console.error('Error fetching Facebook pages:', error);
    res.status(500).json({ error: 'Failed to fetch Facebook pages' });
  }
});

// Get connected Instagram accounts for a business
router.get('/instagram-accounts/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const businessCol = db.collection('businesses');

    const business = await businessCol.findOne({ _id: new ObjectId(businessId) });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Get Instagram accounts from facebook_business channel
    const facebookBusiness = business.channels?.facebook_business;
    const instagramAccounts = facebookBusiness?.instagram_accounts || {};

    // Also get direct Instagram channel references
    const directChannels = {};
    Object.keys(business.channels || {}).forEach(channelKey => {
      if (channelKey.startsWith('instagram_')) {
        const igId = channelKey.replace('instagram_', '');
        directChannels[igId] = business.channels[channelKey];
      }
    });

    // Format Instagram accounts for display
    const formattedAccounts = Object.keys(instagramAccounts).map(igId => {
      const account = instagramAccounts[igId];
      return {
        instagram_id: account.instagram_business_account_id, // Using regular ID
        username: account.username,
        page_name: account.page_name,
        facebook_page_id: account.facebook_page_id,
        connected_at: account.connected_at
      };
    });

    res.json({
      success: true,
      facebook_connection: {
        connected: !!facebookBusiness?.connected,
        master_token_exists: !!facebookBusiness?.master_access_token,
        pages_count: Object.keys(facebookBusiness?.pages || {}).length,
        instagram_accounts_count: Object.keys(instagramAccounts).length
      },
      instagram_accounts: formattedAccounts,
      direct_channel_references: directChannels,
      total_instagram_connections: Object.keys(instagramAccounts).length
    });

  } catch (error) {
    console.error('Error fetching Instagram accounts:', error);
    res.status(500).json({ error: 'Failed to fetch Instagram accounts' });
  }
});

module.exports = router;
