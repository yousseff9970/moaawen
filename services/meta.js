const axios = require('axios');

const sendMessengerMessage = async (recipientId, messageText, token) => {
  try {
    await axios.post(
      'https://graph.facebook.com/v19.0/me/messages',
      {
        recipient: { id: recipientId },
        message: { text: messageText },
        messaging_type: 'RESPONSE',
      },
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
  } catch (err) {
    console.error('Messenger send error:', err.response?.data || err.message);
  }
};

const sendInstagramMessage = async (recipientId, messageText, token, accountInfo = {}) => {
  try {
    // Detect token type and use appropriate API endpoint
    const isInstagramDirectToken = token.startsWith('IG');
    const isFacebookToken = token.startsWith('EAA') || !isInstagramDirectToken;
    
    console.log(`📤 Sending Instagram message:`);
    console.log(`   Recipient: ${recipientId}`);
    console.log(`   Token type: ${isInstagramDirectToken ? 'Instagram Direct (IG...)' : 'Facebook (EAA...)'}`);
    console.log(`   Account info:`, accountInfo);
    
    let apiUrl;
    let requestData;
    
    if (isInstagramDirectToken) {
      // Use Instagram Graph API for direct Instagram tokens
      apiUrl = 'https://graph.instagram.com/v18.0/me/messages';
      requestData = {
        recipient: { id: recipientId },
        message: { text: messageText },
        messaging_type: 'RESPONSE',
      };
      console.log(`� Using Instagram Direct API: ${apiUrl}`);
    } else {
      // Use Facebook Graph API for Facebook tokens
      // Need to specify the Instagram Business Account ID for Facebook tokens
      const instagramAccountId = accountInfo.instagram_business_account_id || accountInfo.page_id;
      if (!instagramAccountId) {
        throw new Error('Instagram Business Account ID required for Facebook token');
      }
      
      apiUrl = `https://graph.facebook.com/v19.0/${instagramAccountId}/messages`;
      requestData = {
        recipient: { id: recipientId },
        message: { text: messageText },
        messaging_type: 'RESPONSE',
      };
      console.log(`🔗 Using Facebook Graph API: ${apiUrl}`);
      console.log(`📱 Instagram Account ID: ${instagramAccountId}`);
    }
    
    const response = await axios.post(apiUrl, requestData, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Instagram message sent successfully via ${isInstagramDirectToken ? 'Instagram Direct API' : 'Facebook Graph API'}`);
    console.log(`📋 Response:`, response.data);
    
    return response.data;
  } catch (err) {
    console.error('Instagram send error:', err.response?.data || err.message);
    
    // If Facebook API fails and it's not an Instagram direct token, try Instagram API as fallback
    if (!token.startsWith('IG') && err.response?.status === 400) {
      console.log('🔄 Trying Instagram API as fallback...');
      try {
        await axios.post(
          'https://graph.instagram.com/v18.0/me/messages',
          {
            recipient: { id: recipientId },
            message: { text: messageText },
            messaging_type: 'RESPONSE',
          },
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        );
        console.log('✅ Instagram message sent via fallback Instagram API');
      } catch (fallbackErr) {
        console.error('Instagram fallback send error:', fallbackErr.response?.data || fallbackErr.message);
      }
    }
  }
};

module.exports = { sendMessengerMessage, sendInstagramMessage };
