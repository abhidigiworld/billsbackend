const jwt = require('jsonwebtoken');
const User = require('../models/User');
const config = require('../config/config');

const protect = async (req, res, next) => {
  try {
    let token;
    
    // 1. Get token from authorization headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required. Please log in.' });
    }

    // 2. Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, config.JWT_SECRET);
    } catch (jwtErr) {
      return res.status(401).json({ success: false, message: 'Invalid or expired session. Please log in again.' });
    }

    // 3. Check if user still exists
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'The user belonging to this token no longer exists.' });
    }

    // 4. Enforce Session Lock (Prevent Concurrent Logins)
    // If the token in the request header doesn't match the user's current active token in the DB, it means they logged in elsewhere or logged out.
    if (user.activeSessionToken !== token) {
      return res.status(401).json({ 
        success: false, 
        message: 'This session has been terminated because your account was logged in from another device or you logged out.' 
      });
    }

    // 5. Update session activity timestamp and rotate token to prevent timeout lockout
    const newToken = jwt.sign({ id: user._id }, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN
    });
    user.activeSessionToken = newToken;
    user.sessionLastActive = new Date();
    await user.save();

    // Expose the rotated token in the response headers
    res.setHeader('x-refresh-token', newToken);
    res.setHeader('Access-Control-Expose-Headers', 'x-refresh-token');

    // 6. Grant access
    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication Middleware Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error during authentication.' });
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: 'You do not have permission to perform this action.' 
      });
    }
    next();
  };
};

module.exports = {
  protect,
  restrictTo
};
