// routes/business/index.js
const express = require('express');
const router = express.Router();

// Import all sub-modules
const crudRoutes = require('./crud');
const channelRoutes = require('./channels');
const shopifyRoutes = require('./shopify');

// Mount sub-routers
router.use('/', crudRoutes);
router.use('/', channelRoutes);
router.use('/', shopifyRoutes);

// Mount products routes
const productsRouter = require('../products');
router.use('/:businessId/products', productsRouter);

module.exports = router;
