// routes/business/shared.js
const express = require('express');
const getDb = require('../../db');
const { ObjectId } = require('bson');
const { authMiddleware, requireVerified, requireAdmin } = require('../../middlewares/authMiddleware');
const planSettings = require('../../utils/PlanSettings');



module.exports = {
  express,
  getDb,
  ObjectId,
  authMiddleware,
  requireVerified,
  requireAdmin,
  planSettings,
  
};
