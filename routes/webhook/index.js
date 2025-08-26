// routes/webhook/index.js
const express = require('express');
const router = express.Router();

// Import all sub-modules
const instagramRoutes = require('./instagram');
const messengerRoutes = require('./messenger');

// Mount sub-routers
router.use('/', instagramRoutes);
router.use('/', messengerRoutes);

module.exports = router;
