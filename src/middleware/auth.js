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
    // Allow the current active token, or the previous token if rotated within a 30-second grace window (to handle concurrent in-flight requests)
    const isCurrentToken = user.activeSessionToken === token;
    const isRecentPreviousToken = user.previousSessionToken === token && 
                                  user.lastTokenRotation && 
                                  (Date.now() - new Date(user.lastTokenRotation).getTime() < 30000); // 30s grace window

    if (!isCurrentToken && !isRecentPreviousToken) {
      return res.status(401).json({ 
        success: false, 
        message: 'This session has been terminated because your account was logged in from another device or you logged out.' 
      });
    }

    // 5. Update session activity timestamp and rotate token (if needed) to prevent timeout lockout
    // To prevent rapid rotation and race conditions on concurrent requests, we only rotate the token at most once every 5 minutes.
    const ROTATION_INTERVAL = 5 * 60 * 1000; // 5 minutes
    const needsRotation = !user.lastTokenRotation || 
                          (Date.now() - new Date(user.lastTokenRotation).getTime() > ROTATION_INTERVAL);

    let tokenToSend = user.activeSessionToken;

    if (needsRotation) {
      const newToken = jwt.sign({ id: user._id }, config.JWT_SECRET, {
        expiresIn: config.JWT_EXPIRES_IN
      });
      user.previousSessionToken = user.activeSessionToken;
      user.activeSessionToken = newToken;
      user.lastTokenRotation = new Date();
      tokenToSend = newToken;
    }

    user.sessionLastActive = new Date();
    await user.save();

    // Expose the active/rotated token in the response headers
    res.setHeader('x-refresh-token', tokenToSend);
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
