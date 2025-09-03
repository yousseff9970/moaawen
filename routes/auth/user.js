// routes/auth/user.js
const { express, bcrypt, jwt, getDb, ObjectId, JWT_SECRET } = require('./shared');
const { generateOTP, sendVerificationEmail, sendPasswordResetEmail } = require('../../utils/mailer');
const crypto = require('crypto');

const router = express.Router();

// -------------------- REGISTER --------------------
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body;

    if (!fullName || !email || !phone || !password) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    const db = await getDb();
    const usersCol = db.collection('users');

    const existingUser = await usersCol.findOne({ email });
    if (existingUser) {
      if (existingUser.isEmailVerified) {
        return res.status(400).json({ message: 'Email already exists and is verified.' });
      } else {
        // User exists but not verified, generate new OTP and resend
        const otp = generateOTP();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await usersCol.updateOne(
          { email },
          { 
            $set: { 
              emailVerificationOTP: otp,
              otpExpiry: otpExpiry,
              phone,
              password: await bcrypt.hash(password, 10)
            }
          }
        );

        // Send verification email
        const emailResult = await sendVerificationEmail(email, otp, fullName);
        if (!emailResult.success) {
          return res.status(500).json({ message: 'Failed to send verification email. Please try again.' });
        }

        return res.json({
          message: 'Verification email sent! Please check your email and verify your account.',
          requiresVerification: true,
          email: email
        });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const userDoc = {
      email,
      phone,
      password: hashedPassword,
      fullName,
      businesses: [],
      isEmailVerified: false,
      emailVerificationOTP: otp,
      otpExpiry: otpExpiry,
      createdAt: new Date()
    };

    const result = await usersCol.insertOne(userDoc);

    // Send verification email
    const emailResult = await sendVerificationEmail(email, otp, fullName);
    if (!emailResult.success) {
      // Remove the user if email sending failed
      await usersCol.deleteOne({ _id: result.insertedId });
      return res.status(500).json({ message: 'Failed to send verification email. Please try again.' });
    }

    return res.json({
      message: 'Registration successful! Please check your email and verify your account.',
      requiresVerification: true,
      email: email
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

    const db = await getDb();
    const usersCol = db.collection('users');

    const user = await usersCol.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password.' });
    }

    // Check if user registered normally (has password) and email is not verified
    if (user.password && !user.isEmailVerified) {
      // Generate new OTP and send verification email automatically
      const otp = generateOTP();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Update user with new OTP
      await usersCol.updateOne(
        { email },
        { 
          $set: { 
            emailVerificationOTP: otp,
            otpExpiry: otpExpiry
          }
        }
      );

      // Send verification email
      const emailResult = await sendVerificationEmail(email, otp, user.fullName || '');

      return res.status(403).json({
        message: emailResult.success
          ? 'Please verify your email address. We\'ve sent a new verification code to your email.'
          : 'Please verify your email address before logging in.',
        requiresVerification: true,
        email: email,
        emailSent: emailResult.success
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid email or password.' });
    }

    // Generate JWT token (expires in 7 days)
    const token = jwt.sign(
      { 
        userId: user._id, 
        email: user.email,
        verified: user.isEmailVerified || false
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      message: 'Login successful!',
      token,
      user: {
        id: user._id,
        name: user.name,
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

// -------------------- VERIFY EMAIL OTP --------------------
router.post('/verify-email', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required.' });
    }

    const db = await getDb();
    const usersCol = db.collection('users');

    const user = await usersCol.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ message: 'Email is already verified.' });
    }

    // Check if OTP has expired
    if (!user.otpExpiry || new Date() > user.otpExpiry) {
      return res.status(400).json({ 
        message: 'OTP has expired. Please request a new verification code.',
        otpExpired: true
      });
    }

    // Verify OTP
    if (user.emailVerificationOTP !== otp) {
      return res.status(400).json({ message: 'Invalid OTP. Please try again.' });
    }

    // Mark email as verified and remove OTP fields
    await usersCol.updateOne(
      { email },
      { 
        $set: { isEmailVerified: true },
        $unset: { emailVerificationOTP: "", otpExpiry: "" }
      }
    );

    // Generate JWT token for auto-login after verification
    const token = jwt.sign(
      { 
        userId: user._id, 
        email: user.email,
        verified: true // User just verified their email
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      message: 'Email verified successfully! You are now logged in.',
      token,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        businesses: user.businesses || []
      }
    });
  } catch (err) {
    console.error('Email verification error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// -------------------- RESEND VERIFICATION OTP --------------------
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    const db = await getDb();
    const usersCol = db.collection('users');

    const user = await usersCol.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ message: 'Email is already verified.' });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Update user with new OTP
    await usersCol.updateOne(
      { email },
      { 
        $set: { 
          emailVerificationOTP: otp,
          otpExpiry: otpExpiry
        }
      }
    );

    // Send verification email
    const emailResult = await sendVerificationEmail(email, otp, user.fullName || '');
    if (!emailResult.success) {
      return res.status(500).json({ message: 'Failed to send verification email. Please try again.' });
    }

    return res.json({
      message: 'Verification email sent! Please check your email.',
      email: email
    });
  } catch (err) {
    console.error('Resend verification error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// -------------------- FORGOT PASSWORD --------------------
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    const db = await getDb();
    const usersCol = db.collection('users');

    const user = await usersCol.findOne({ email });
    if (!user) {
      // Don't reveal whether email exists for security
      return res.json({
        message: 'If an account with this email exists, you will receive a password reset link.',
        email: email
      });
    }

    // Check if user has a password (not a social login only account)
    if (!user.password) {
      return res.status(400).json({ 
        message: 'This account was created with social login. Please use Google or Facebook to sign in.' 
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Update user with reset token
    await usersCol.updateOne(
      { email },
      { 
        $set: { 
          passwordResetToken: resetToken,
          passwordResetExpiry: resetTokenExpiry
        }
      }
    );

    // Send password reset email
    const emailResult = await sendPasswordResetEmail(email, resetToken, user.fullName || user.name || '');
    if (!emailResult.success) {
      return res.status(500).json({ message: 'Failed to send password reset email. Please try again.' });
    }

    return res.json({
      message: 'If an account with this email exists, you will receive a password reset link.',
      email: email
    });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// -------------------- RESET PASSWORD --------------------
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Reset token and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
    }

    const db = await getDb();
    const usersCol = db.collection('users');

    const user = await usersCol.findOne({ 
      passwordResetToken: token,
      passwordResetExpiry: { $gt: new Date() } // Token not expired
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token.' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password and remove reset token
    await usersCol.updateOne(
      { _id: user._id },
      { 
        $set: { 
          password: hashedPassword,
          updatedAt: new Date()
        },
        $unset: { 
          passwordResetToken: "", 
          passwordResetExpiry: "" 
        }
      }
    );

    return res.json({
      message: 'Password reset successfully! You can now login with your new password.',
      email: user.email
    });
  } catch (err) {
    console.error('Reset password error:', err.message);
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

    const db = await getDb();
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

    const db = await getDb();
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
