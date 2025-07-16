const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

router.get('/', (req, res) => {
  const filePath = path.join(__dirname, '../logs/conversations.json');
  let conversations = [];

  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    conversations = JSON.parse(data); // 🚨 Since it's a full array, no need for line-splitting
  } catch (e) {
    console.error('❌ Failed to read conversations:', e.message);
  }

  // Sort by timestamp (newest first)
  conversations.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Group by user ID
  const grouped = {};
  for (const convo of conversations) {
    const id = convo.user_id || convo.userId;
    if (!grouped[id]) grouped[id] = [];
    grouped[id].push(convo);
  }

  res.render('dashboard', { grouped });
});

module.exports = router;
