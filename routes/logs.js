// routes/logs.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

router.get('/api/logs', (req, res) => {
  const logPath = path.join(__dirname, '../services/logs.json');
  try {
    const logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    res.json(logs.reverse()); // latest first
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse logs.' });
  }
});

module.exports = router;
