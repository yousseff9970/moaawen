// routes/auth/google.js
const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { getDb, ObjectId } = require('./shared');
const jwt = require('jsonwebtoken');

const router = express.Router();

// Configure Google OAuth Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const db = await getDb();
    const usersCol = db.collection('users');

    // Extract user info from Google profile
    const googleId = profile.id;
    const email = profile.emails?.[0]?.value;
    const name = profile.displayName;
    const firstName = profile.name?.givenName;
    const lastName = profile.name?.familyName;
    const profilePicture = profile.photos?.[0]?.value;

    if (!email) {
      return done(new Error('No email provided by Google'), null);
    }

    // Check if user already exists with this Google ID
    let user = await usersCol.findOne({ googleId });

    if (user) {
      // Update existing Google user with latest info
      await usersCol.updateOne(
        { _id: user._id },
        {
          $set: {
            name: name || user.name,
            profilePicture: profilePicture || user.profilePicture,
            googleAccessToken: accessToken,
            lastLogin: new Date(),
            updatedAt: new Date()
          }
        }
      );
      
      // Fetch updated user
      user = await usersCol.findOne({ _id: user._id });
    } else {
      // Check if user exists with same email (regular registration)
      const existingUser = await usersCol.findOne({ email });
      
      if (existingUser) {
        // Link Google account to existing user
        await usersCol.updateOne(
          { _id: existingUser._id },
          {
            $set: {
              googleId,
              name: name || existingUser.name || existingUser.fullName,
              profilePicture: profilePicture || existingUser.profilePicture,
              googleAccessToken: accessToken,
              isEmailVerified: true, // Google emails are verified
              lastLogin: new Date(),
              updatedAt: new Date()
            }
          }
        );
        
        user = await usersCol.findOne({ _id: existingUser._id });
      } else {
        // Create new user with Google account
        const newUser = {
          googleId,
          email,
          name,
          fullName: name,
          firstName,
          lastName,
          profilePicture,
          googleAccessToken: accessToken,
          isEmailVerified: true, // Google emails are verified
          businesses: [],
          createdAt: new Date(),
          lastLogin: new Date(),
          // Note: No password for Google-only users
          notifications: {
            email: true,
            push: true,
            marketing: false,
          },
          privacy: {
            showEmail: false,
            showPhone: false,
            profileVisible: true,
          }
        };

        const result = await usersCol.insertOne(newUser);
        user = await usersCol.findOne({ _id: result.insertedId });
      }
    }

    return done(null, user);
  } catch (error) {
    console.error('Google OAuth error:', error);
    return done(error, null);
  }
}));

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user._id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const db = await getDb();
    const usersCol = db.collection('users');
    const user = await usersCol.findOne({ _id: new ObjectId(id) });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// -------------------- GOOGLE AUTH ROUTES --------------------

// Initiate Google OAuth
router.get('/', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

// Google OAuth callback
router.get('/callback', 
  passport.authenticate('google', { 
    failureRedirect: '/auth/error?provider=google',
    session: false // We'll use JWT instead of sessions
  }),
  async (req, res) => {
    try {
      const user = req.user;
      
      if (!user) {
        return res.redirect('/auth/error?provider=google&error=no_user');
      }

      // Generate JWT token
      const token = jwt.sign(
        { 
          userId: user._id, 
          email: user.email,
          verified: user.isEmailVerified || true,
          provider: 'google'
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      // Redirect to frontend with token
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(`${frontendUrl}/auth/success?token=${token}&provider=google`);

    } catch (error) {
      console.error('Google callback error:', error);
      res.redirect('/auth/error?provider=google&error=callback_error');
    }
  }
);

// Get user info from Google token (for frontend validation)
router.get('/user', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    if (decoded.provider !== 'google') {
      return res.status(400).json({ success: false, message: 'Not a Google authentication token.' });
    }

    const db = await getDb();
    const usersCol = db.collection('users');
    const user = await usersCol.findOne({ _id: new ObjectId(decoded.userId) });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Return user info (without sensitive data)
    const userInfo = {
      id: user._id,
      email: user.email,
      name: user.name,
      fullName: user.fullName,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePicture: user.profilePicture,
      googleId: user.googleId,
      isEmailVerified: user.isEmailVerified,
      businesses: user.businesses || [],
      provider: 'google'
    };

    return res.json({
      success: true,
      user: userInfo
    });

  } catch (err) {
    console.error('Get Google user error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
