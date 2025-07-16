const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '../logs/conversations.json');

const logConversation = async ({ platform, userId, userName, message, aiReply, source }) => {
  const entry = {
    timestamp: new Date().toISOString(),
    platform,
    user_id: userId,
    user_name: userName || 'Unknown',
    message,
    ai_reply: aiReply,
    source
  };

  try {
    let data = [];

    if (fs.existsSync(logFile)) {
      const raw = fs.readFileSync(logFile, 'utf-8');
      data = JSON.parse(raw);
    }

    data.push(entry);

    fs.writeFileSync(logFile, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('❌ Failed to log conversation:', err.message);
  }
};

module.exports = { logConversation };
