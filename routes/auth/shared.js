// routes/auth/shared.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');
const axios = require('axios');

const client = new MongoClient(process.env.MONGO_URI);
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key';

const FB_APP_ID = process.env.FB_APP_ID;
const FB_APP_SECRET = process.env.FB_APP_SECRET;
const FB_REDIRECT_URI = process.env.FB_REDIRECT_URI;

// Helper function to get clean frontend URL
const getFrontendUrl = () => {
  return (process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/dashboard$/, '');
};

module.exports = {
  express,
  bcrypt,
  jwt,
  MongoClient,
  ObjectId,
  axios,
  client,
  JWT_SECRET,
  FB_APP_ID,
  FB_APP_SECRET,
  FB_REDIRECT_URI,
  getFrontendUrl
};
