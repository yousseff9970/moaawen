const axios = require('axios');

const sendMessengerMessage = async (recipientId, messageText, token) => {
  try {
    console.log(`💬 Sending Messenger message to ${recipientId}`);
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
    console.log(`✅ Messenger message sent successfully to ${recipientId}`);
  } catch (err) {
    console.error(`❌ Messenger send error to ${recipientId}:`, err.response?.data || err.message);
    throw err; // Re-throw to allow calling code to handle
  }
};

const sendInstagramMessage = async (recipientId, messageText, token) => {
  try {
    console.log(`📱 Sending Instagram message to ${recipientId}`);
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
    console.log(`✅ Instagram message sent successfully to ${recipientId}`);
  } catch (err) {
    console.error(`❌ Instagram send error to ${recipientId}:`, err.response?.data || err.message);
    throw err; // Re-throw to allow calling code to handle
  }
};

module.exports = { sendMessengerMessage, sendInstagramMessage };
