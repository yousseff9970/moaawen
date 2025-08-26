// routes/business/index.js
const express = require('express');
const router = express.Router();

// Import all sub-modules
const crudRoutes = require('./crud');
const channelRoutes = require('./channels');

// Mount sub-routers
router.use('/', crudRoutes);
router.use('/', channelRoutes);

module.exports = router;
