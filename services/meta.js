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

const sendInstagramMessage = async (recipientId, messageText, token) => {
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
    console.error('Instagram send error:', err.response?.data || err.message);
  }
};

module.exports = { sendMessengerMessage, sendInstagramMessage };
