// routes/auth/index.js
const express = require('express');
const router = express.Router();

// Import sub-routers
const facebookRouter = require('./facebook');
const userRouter = require('./user');
const businessRouter = require('./business');

// Mount Facebook routes
router.use('/facebook', facebookRouter);

// Mount user authentication routes directly on auth root
router.use('/', userRouter);

// Mount business routes with /facebook prefix for consistency with original structure
router.use('/facebook', businessRouter);

module.exports = router;
