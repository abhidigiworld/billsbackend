const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const LoginLog = require('../models/LoginLog');
const { sendOTPEmail } = require('../services/mailService');
const { generateDatabaseBackup } = require('../services/backupService');
const config = require('../config/config');

// Helper to sign JWT
const signToken = (id) => {
  return jwt.sign({ id }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN
  });
};

// Sign Up
exports.signup = async (req, res, next) => {
  const { name, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      isVerified: false,
      otp,
      otpExpires
    });
    await newUser.save();

    let isSmtpConfigured = true;
    try {
      await sendOTPEmail(
        email,
        otp,
        'Verify your account - Sakshi Enterprises',
        `Your verification code is: ${otp}. It is valid for 10 minutes.`
      );
    } catch (mailError) {
      console.error('SMTP Error during signup OTP dispatch, logged OTP to console.');
      isSmtpConfigured = false;
    }

    res.status(201).json({
      success: true,
      message: isSmtpConfigured 
        ? 'Verification OTP sent to your email.' 
        : 'Registration successful! (SMTP not configured, OTP printed to console).',
      email,
      otp: (!config.SMTP_USER || !config.SMTP_PASS) ? otp : undefined
    });
  } catch (error) {
    next(error);
  }
};

// Login
exports.login = async (req, res, next) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({
      $or: [
        { email: username },
        { name: username }
      ]
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.isVerified) {
      return res.status(400).json({ success: false, message: 'Please verify your email address first' });
    }

    // Generate token
    const token = signToken(user._id);

    // Log login log
    try {
      await new LoginLog({
        userId: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        ipAddress: req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent']
      }).save();
    } catch (logErr) {
      console.error('Failed to save user login log:', logErr);
    }

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
};

// Logout
exports.logout = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, message: 'Logged out successfully.' });
  } catch (error) {
    next(error);
  }
};

// Verify OTP
exports.verifyOtp = async (req, res, next) => {
  const { email, otp } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: 'Account is already verified' });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid verification code' });
    }

    if (new Date() > user.otpExpires) {
      return res.status(400).json({ success: false, message: 'Verification code has expired' });
    }

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.status(200).json({ success: true, message: 'Account verified successfully!' });
  } catch (error) {
    next(error);
  }
};

// Resend OTP
exports.resendOtp = async (req, res, next) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: 'Account is already verified' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    let isSmtpConfigured = true;
    try {
      await sendOTPEmail(
        email,
        otp,
        'Verify your account - Sakshi Enterprises',
        `Your verification code is: ${otp}. It is valid for 10 minutes.`
      );
    } catch (mailError) {
      isSmtpConfigured = false;
    }

    res.status(200).json({
      success: true,
      message: isSmtpConfigured 
        ? 'New verification OTP sent to your email.' 
        : 'New OTP generated (SMTP not configured, OTP printed to console).',
      otp: (!config.SMTP_USER || !config.SMTP_PASS) ? otp : undefined
    });
  } catch (error) {
    next(error);
  }
};

// Forgot Password
exports.forgotPassword = async (req, res, next) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const resetOtp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetOtp = resetOtp;
    user.resetOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    let isSmtpConfigured = true;
    try {
      await sendOTPEmail(
        email,
        resetOtp,
        'Reset your password - Sakshi Enterprises',
        `Your password reset code is: ${resetOtp}. It is valid for 10 minutes.`
      );
    } catch (mailError) {
      isSmtpConfigured = false;
    }

    res.status(200).json({
      success: true,
      message: isSmtpConfigured 
        ? 'Password reset OTP sent to your email.' 
        : 'Password reset code generated (SMTP not configured, OTP printed to console).',
      otp: (!config.SMTP_USER || !config.SMTP_PASS) ? resetOtp : undefined
    });
  } catch (error) {
    next(error);
  }
};

// Reset Password
exports.resetPassword = async (req, res, next) => {
  const { email, otp, newPassword } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.resetOtp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid password reset code' });
    }

    if (new Date() > user.resetOtpExpires) {
      return res.status(400).json({ success: false, message: 'Password reset code has expired' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.resetOtp = undefined;
    user.resetOtpExpires = undefined;
    user.activeSessionToken = null; // force relogin on all devices
    user.sessionLastActive = null;
    await user.save();

    res.status(200).json({ success: true, message: 'Password reset successful! You can now log in.' });
  } catch (error) {
    next(error);
  }
};

// Get All Users (Admin Only)
exports.getAllUsers = async (req, res, next) => {
  try {
    const users = await User.find({}, '-password');
    res.json(users);
  } catch (error) {
    next(error);
  }
};

// Get Login Logs (Admin Only)
exports.getLoginLogs = async (req, res, next) => {
  try {
    const logs = await LoginLog.find().sort({ loginTime: -1 });
    res.json(logs);
  } catch (error) {
    next(error);
  }
};

// Update User (Admin or Self depending on context, originally put('/user/:id') or put('/api/users/:id') or put('/api/users/profile/:id'))
exports.updateUser = async (req, res, next) => {
  const { id } = req.params;
  const { name, email, role, isVerified } = req.body;
  try {
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if requester is updating their own profile or is an admin
    if (req.user.role !== 'admin' && req.user.id.toString() !== id) {
      return res.status(403).json({ success: false, message: 'You are not authorized to update this profile.' });
    }

    const updateData = { name };

    // Only allow admin to update email, role, or isVerified
    if (req.user.role === 'admin') {
      if (email) updateData.email = email;
      if (role) updateData.role = role;
      if (isVerified !== undefined) updateData.isVerified = isVerified;
    } else {
      // If regular user attempts to change email, role, or isVerified, reject with 403 Forbidden
      if (email && email !== user.email) {
        return res.status(403).json({ success: false, message: 'Only administrators can modify email addresses.' });
      }
      if (role && role !== user.role) {
        return res.status(403).json({ success: false, message: 'Only administrators can modify user roles.' });
      }
      if (isVerified !== undefined && isVerified !== user.isVerified) {
        return res.status(403).json({ success: false, message: 'Only administrators can modify verification status.' });
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    res.status(200).json({ success: true, message: 'User updated successfully', user: updatedUser });
  } catch (error) {
    next(error);
  }
};

// Delete User
exports.deleteUser = async (req, res, next) => {
  const { id } = req.params;
  try {
    const deletedUser = await User.findByIdAndDelete(id);
    if (!deletedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// Trigger Database Backup (Admin Only)
exports.getDatabaseBackup = async (req, res, next) => {
  try {
    const backup = await generateDatabaseBackup();
    const today = new Date().toISOString().split('T')[0];
    
    // Set headers for download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=backup_sakshi_enterprises_${today}.json`);
    
    return res.status(200).send(JSON.stringify(backup, null, 2));
  } catch (error) {
    next(error);
  }
};
