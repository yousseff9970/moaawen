// routes/auth/user.js
const { express, bcrypt, jwt, ObjectId, client, JWT_SECRET } = require('./shared');

const router = express.Router();

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

    // Generate JWT token for auto-login
    const token = jwt.sign(
      { userId: result.insertedId, email: email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      message: 'Registration successful!',
      token,
      user: {
        id: result.insertedId,
        email: email,
        phone: phone,
        businesses: []
      }
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

// -------------------- GET PROFILE --------------------
router.get('/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = require('jsonwebtoken').verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');

    const user = await usersCol.findOne({ _id: new ObjectId(decoded.userId) });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Return user info (without password)
    const userInfo = {
      id: user._id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      facebookId: user.facebookId,
      facebookEmail: user.facebookEmail,
      profilePicture: user.profilePicture,
      facebookAccessToken: user.facebookAccessToken,
      hasPassword: !!user.password, // Indicate if user has a password set
      businesses: user.businesses || [], // Include user's businesses
      notifications: user.notifications || {
        email: true,
        push: true,
        marketing: false,
      },
      privacy: user.privacy || {
        showEmail: false,
        showPhone: false,
        profileVisible: true,
      }
    };

    return res.json({
      success: true,
      user: userInfo
    });

  } catch (err) {
    console.error('Get profile error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// -------------------- UPDATE PROFILE --------------------
router.put('/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = require('jsonwebtoken').verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    const { name, phone, currentPassword, newPassword, notifications, privacy } = req.body;

    if (!name && !phone && !newPassword && !notifications && !privacy) {
      return res.status(400).json({ success: false, message: 'At least one field must be provided for update.' });
    }

    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');

    const user = await usersCol.findOne({ _id: new ObjectId(decoded.userId) });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const updateFields = {};

    // Update name if provided
    if (name) {
      updateFields.name = name;
    }

    // Update phone if provided
    if (phone) {
      updateFields.phone = phone;
    }

    // Update notifications if provided
    if (notifications) {
      updateFields.notifications = notifications;
    }

    // Update privacy settings if provided
    if (privacy) {
      updateFields.privacy = privacy;
    }

    // Handle password change
    if (newPassword) {
      if (!currentPassword && user.password) {
        return res.status(400).json({ success: false, message: 'Current password is required to change password.' });
      }

      // Verify current password (only for users with passwords - not Facebook users)
      if (user.password && currentPassword) {
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isCurrentPasswordValid) {
          return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
        }
      }

      // Hash new password
      const hashedNewPassword = await bcrypt.hash(newPassword, 10);
      updateFields.password = hashedNewPassword;
    }

    // Add updated timestamp
    updateFields.updatedAt = new Date();

    // Update user in database
    await usersCol.updateOne(
      { _id: user._id },
      { $set: updateFields }
    );

    // Return updated user info (without password)
    const updatedUser = {
      id: user._id,
      email: user.email,
      name: updateFields.name || user.name,
      phone: updateFields.phone || user.phone,
      facebookId: user.facebookId,
      profilePicture: user.profilePicture,
      hasPassword: !!updateFields.password || !!user.password,
      notifications: updateFields.notifications || user.notifications,
      privacy: updateFields.privacy || user.privacy
    };

    return res.json({
      success: true,
      message: 'Profile updated successfully!',
      user: updatedUser
    });

  } catch (err) {
    console.error('Update profile error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
