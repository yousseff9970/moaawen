// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');

const client = new MongoClient(process.env.MONGO_URI);
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key';

// -------------------- REGISTER --------------------
router.post('/register', async (req, res) => {
  try {
    const { businessName, email, phone, password } = req.body;

    if (!businessName || !email || !phone || !password) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');

    const existingUser = await usersCol.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const userDoc = {
      email,
      phone,
      password: hashedPassword,
      businesses: [],
      createdAt: new Date()
    };

    const result = await usersCol.insertOne(userDoc);

    return res.json({
      message: 'Registration successful!',
      userId: result.insertedId
    });
  } catch (err) {
    console.error('Register error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// -------------------- LOGIN --------------------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');

    const user = await usersCol.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid email or password.' });
    }

    // Generate JWT token (expires in 7 days)
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      message: 'Login successful!',
      token,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        businesses: user.businesses
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
