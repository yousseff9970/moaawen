// routes/business/shared.js
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const { authMiddleware, requireVerified, requireAdmin } = require('../../middlewares/authMiddleware');
const planSettings = require('../../utils/PlanSettings');

const client = new MongoClient(process.env.MONGO_URI);

module.exports = {
  express,
  MongoClient,
  ObjectId,
  authMiddleware,
  requireVerified,
  requireAdmin,
  planSettings,
  client
};
