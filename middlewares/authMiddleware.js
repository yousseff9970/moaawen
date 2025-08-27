// middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');

// Ensure JWT_SECRET is set - fail fast if not configured
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set');
  process.exit(1);
}

// Validate JWT token format
function isValidJWTFormat(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every(part => part.length > 0);
}

// Enhanced authentication middleware with security improvements
function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    // Check for authorization header
    if (!authHeader) {
      return res.status(401).json({ 
        success: false,
        message: 'Access denied. Authentication required.' 
      });
    }

    // Validate Bearer token format
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false,
        message: 'Access denied. Invalid authentication format.' 
      });
    }

    const token = authHeader.split(' ')[1];

    // Validate token is present and has correct format
    if (!token || !isValidJWTFormat(token)) {
      return res.status(401).json({ 
        success: false,
        message: 'Access denied. Invalid token format.' 
      });
    }

    // Verify and decode the JWT token
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'], // Explicitly specify allowed algorithms
      maxAge: '7d', // Maximum token age
      clockTolerance: 30 // 30 seconds tolerance for clock skew
    });

    // Validate required fields in token payload
    if (!decoded.userId || !decoded.email) {
      return res.status(401).json({ 
        success: false,
        message: 'Access denied. Invalid token payload.' 
      });
    }

    // Validate token expiration with buffer
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < now) {
      return res.status(401).json({ 
        success: false,
        message: 'Access denied. Token has expired.' 
      });
    }

    // Set user information on request object
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      verified: decoded.verified || false,
      iat: decoded.iat,
      exp: decoded.exp
    };

    // Log successful authentication (optional - can be disabled in production)
    if (process.env.NODE_ENV !== 'production') {
      
    }

    next();

  } catch (err) {
    // Handle different types of JWT errors with appropriate responses
    let message = 'Access denied. Authentication failed.';
    let statusCode = 401;

    if (err.name === 'TokenExpiredError') {
      message = 'Access denied. Token has expired.';
    } else if (err.name === 'JsonWebTokenError') {
      message = 'Access denied. Invalid token.';
    } else if (err.name === 'NotBeforeError') {
      message = 'Access denied. Token not active yet.';
    } else {
      // Log unexpected errors for monitoring (but don't expose to client)
      console.error('Auth middleware error:', err.message);
      message = 'Access denied. Authentication failed.';
    }

    return res.status(statusCode).json({ 
      success: false,
      message 
    });
  }
}

// Optional middleware for checking if user is verified
// This does a database lookup to ensure verification status is current
async function requireVerified(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ 
      success: false,
      message: 'Authentication required.' 
    });
  }

  try {
    // For extra security, verify the email verification status from the database
    const { MongoClient, ObjectId } = require('mongodb');
    const client = new MongoClient(process.env.MONGO_URI);
    
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');
    
    const user = await usersCol.findOne({ _id: new ObjectId(req.user.userId) });
    
    if (!user) {
      return res.status(401).json({ 
        success: false,
        message: 'User not found.' 
      });
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({ 
        success: false,
        message: 'Email verification required.',
        requiresVerification: true,
        email: user.email
      });
    }

    // Update the req.user.verified to reflect current database state
    req.user.verified = true;
    next();

  } catch (error) {
    console.error('Error checking verification status:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Internal server error.' 
    });
  }
}

// Middleware for admin-only routes (if needed)
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ 
      success: false,
      message: 'Authentication required.' 
    });
  }

  // Check if user has admin role (implement based on your user model)
  if (!req.user.isAdmin && !req.user.role?.includes('admin')) {
    return res.status(403).json({ 
      success: false,
      message: 'Admin access required.' 
    });
  }

  next();
}

module.exports = {
  authMiddleware,
  requireVerified,
  requireAdmin
};
