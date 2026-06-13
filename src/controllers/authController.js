const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const LoginLog = require('../models/LoginLog');
const SystemSettings = require('../models/SystemSettings');
const { sendOTPEmail, sendBackupEmail } = require('../services/mailService');
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

    let isSmtpConfigured = !!(config.SMTP_USER && config.SMTP_PASS);
    if (isSmtpConfigured) {
      try {
        await sendOTPEmail(
          email,
          otp,
          'Verify your account - Sakshi Enterprises',
          'verification'
        );
      } catch (mailError) {
        console.error('SMTP Error during signup OTP dispatch, logged OTP to console.');
        isSmtpConfigured = false;
      }
    }

    res.status(201).json({
      success: true,
      message: isSmtpConfigured 
        ? 'Verification OTP sent to your email.' 
        : 'Registration successful! (SMTP not configured or failed to send email. OTP printed to console).',
      email,
      otp: (!isSmtpConfigured || config.NODE_ENV === 'development') ? otp : undefined
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
      return res.status(400).json({ success: false, message: 'Please verify your email address first', email: user.email });
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

    let isSmtpConfigured = !!(config.SMTP_USER && config.SMTP_PASS);
    if (isSmtpConfigured) {
      try {
        await sendOTPEmail(
          email,
          otp,
          'Verify your account - Sakshi Enterprises',
          'verification'
        );
      } catch (mailError) {
        isSmtpConfigured = false;
      }
    }

    res.status(200).json({
      success: true,
      message: isSmtpConfigured 
        ? 'New verification OTP sent to your email.' 
        : 'New OTP generated (SMTP not configured or failed to send email. OTP printed to console).',
      otp: (!isSmtpConfigured || config.NODE_ENV === 'development') ? otp : undefined
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

    let isSmtpConfigured = !!(config.SMTP_USER && config.SMTP_PASS);
    if (isSmtpConfigured) {
      try {
        await sendOTPEmail(
          email,
          resetOtp,
          'Reset your password - Sakshi Enterprises',
          'reset'
        );
      } catch (mailError) {
        isSmtpConfigured = false;
      }
    }

    res.status(200).json({
      success: true,
      message: isSmtpConfigured 
        ? 'Password reset OTP sent to your email.' 
        : 'Password reset code generated (SMTP not configured or failed to send email. OTP printed to console).',
      otp: (!isSmtpConfigured || config.NODE_ENV === 'development') ? resetOtp : undefined
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
    const search = req.query.search || '';
    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (req.query.page) {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      const totalLogs = await LoginLog.countDocuments(query);
      const logs = await LoginLog.find(query)
        .sort({ loginTime: -1 })
        .skip(skip)
        .limit(limit);

      return res.json({
        success: true,
        logs,
        totalPages: Math.ceil(totalLogs / limit),
        currentPage: page,
        totalLogs
      });
    }

    // Fallback for backward compatibility
    const logs = await LoginLog.find(query).sort({ loginTime: -1 });
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

// Get Backup Settings (Admin Only)
exports.getBackupSettings = async (req, res, next) => {
  try {
    const backupEmailSetting = await SystemSettings.findOne({ key: 'backup_email' });
    const autoBackupEnabledSetting = await SystemSettings.findOne({ key: 'auto_backup_enabled' });
    const attendanceTriggerTimeSetting = await SystemSettings.findOne({ key: 'attendance_trigger_time' });
    const attendanceTriggerRecipientsSetting = await SystemSettings.findOne({ key: 'attendance_trigger_recipients' });
    
    const backupEmail = backupEmailSetting ? backupEmailSetting.value : (process.env.SMTP_USER || req.user.email);
    const autoBackupEnabled = autoBackupEnabledSetting ? autoBackupEnabledSetting.value : true;
    const attendanceTriggerTime = attendanceTriggerTimeSetting ? attendanceTriggerTimeSetting.value : '18:00';
    const attendanceTriggerRecipients = attendanceTriggerRecipientsSetting ? attendanceTriggerRecipientsSetting.value : [];

    // Fetch database storage size from MongoDB
    let storageSize = 0;
    try {
      if (mongoose.connection && mongoose.connection.db) {
        const dbStats = await mongoose.connection.db.stats();
        storageSize = dbStats.storageSize || dbStats.dataSize || 0;
      }
    } catch (dbError) {
      console.error('Error fetching database stats:', dbError);
    }

    res.status(200).json({
      success: true,
      data: {
        backup_email: backupEmail,
        auto_backup_enabled: autoBackupEnabled,
        attendance_trigger_time: attendanceTriggerTime,
        attendance_trigger_recipients: attendanceTriggerRecipients,
        storageSize,
        storageLimit: 512 * 1024 * 1024 // 512 MB in bytes
      }
    });
  } catch (error) {
    next(error);
  }
};
// Update Backup Settings (Admin Only)
exports.updateBackupSettings = async (req, res, next) => {
  try {
    const { backup_email, auto_backup_enabled, attendance_trigger_time, attendance_trigger_recipients } = req.body;

    if (backup_email !== undefined) {
      // Check if backup_email belongs to a registered user with 'admin' role
      const isAdminEmail = await User.findOne({ email: backup_email, role: 'admin' });
      if (!isAdminEmail) {
        return res.status(400).json({
          success: false,
          message: 'The backup recipient email must belong to a registered administrator.'
        });
      }
      await SystemSettings.findOneAndUpdate(
        { key: 'backup_email' },
        { value: backup_email },
        { upsert: true, new: true }
      );
    }

    if (auto_backup_enabled !== undefined) {
      await SystemSettings.findOneAndUpdate(
        { key: 'auto_backup_enabled' },
        { value: auto_backup_enabled === true },
        { upsert: true, new: true }
      );
    }

    if (attendance_trigger_time !== undefined) {
      // Validate time format HH:MM using 24 hour regex
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(attendance_trigger_time)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid time format. Expected HH:MM (24-hour style).'
        });
      }
      await SystemSettings.findOneAndUpdate(
        { key: 'attendance_trigger_time' },
        { value: attendance_trigger_time },
        { upsert: true, new: true }
      );
    }

    if (attendance_trigger_recipients !== undefined) {
      if (!Array.isArray(attendance_trigger_recipients)) {
        return res.status(400).json({
          success: false,
          message: 'Recipients must be an array of user IDs.'
        });
      }
      await SystemSettings.findOneAndUpdate(
        { key: 'attendance_trigger_recipients' },
        { value: attendance_trigger_recipients },
        { upsert: true, new: true }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Settings updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Send Backup Email Immediately (Admin Only)
exports.sendBackupEmailNow = async (req, res, next) => {
  try {
    const { email } = req.body;
    const recipient = email || (await SystemSettings.findOne({ key: 'backup_email' }))?.value || process.env.SMTP_USER || req.user.email;

    if (!recipient) {
      return res.status(400).json({
        success: false,
        message: 'No recipient email configured or provided.'
      });
    }

    // Validate if the custom recipient email is an admin
    const isAdminEmail = await User.findOne({ email: recipient, role: 'admin' });
    if (!isAdminEmail) {
      return res.status(400).json({
        success: false,
        message: 'The backup recipient email must belong to a registered administrator.'
      });
    }

    const backupData = await generateDatabaseBackup();
    const today = new Date().toISOString().split('T')[0];
    const filename = `backup_manual_sakshi_enterprises_${today}.json`;

    await sendBackupEmail(recipient, backupData, filename);

    res.status(200).json({
      success: true,
      message: `Database backup compiled and successfully sent to ${recipient}`
    });
  } catch (error) {
    next(error);
  }
};

// Fetch all system settings merged with defaults
exports.getSystemSettings = async (req, res, next) => {
  try {
    // Passive background check for supervisor attendance email trigger
    try {
      const { runDailySupervisorRequestJob } = require('../services/backupService');
      // Fire asynchronously to avoid blocking user settings retrieval request
      runDailySupervisorRequestJob();
    } catch (triggerErr) {
      console.error('Failed to trigger daily supervisor email check passively:', triggerErr);
    }

    const settings = await SystemSettings.find({});
    const settingsMap = {};
    settings.forEach(s => {
      settingsMap[s.key] = s.value;
    });

    const merged = {
      company_name: settingsMap.company_name || 'Sakshi Enterprises',
      company_subtitle: settingsMap.company_subtitle || 'Enterprise management and payroll portal',
      company_gstin: settingsMap.company_gstin || '07OURPS6573P1ZY',
      company_phone: settingsMap.company_phone || '9650650297',
      company_email: settingsMap.company_email || 'manojsharma.2016m@gmail.com',
      company_address: settingsMap.company_address || 'D-435, Gali No.-59,Mahavir Enclave,Part-3,West Delhi-110059',
      company_logo: settingsMap.company_logo || '',
      company_signature: settingsMap.company_signature || '',
      company_stamp: settingsMap.company_stamp || '',
      shift_hours: settingsMap.shift_hours !== undefined ? Number(settingsMap.shift_hours) : 8
    };

    res.status(200).json({
      success: true,
      data: merged
    });
  } catch (error) {
    next(error);
  }
};

// Update specific system settings (Admin Only)
exports.updateSystemSettings = async (req, res, next) => {
  try {
    const updates = req.body;
    const allowedKeys = [
      'company_name',
      'company_subtitle',
      'company_gstin',
      'company_phone',
      'company_email',
      'company_address',
      'company_logo',
      'company_signature',
      'company_stamp',
      'shift_hours'
    ];

    for (const key of Object.keys(updates)) {
      if (allowedKeys.includes(key)) {
        let val = updates[key];
        if (key === 'shift_hours') {
          val = Number(val) || 8;
        }
        await SystemSettings.findOneAndUpdate(
          { key },
          { value: val },
          { upsert: true, new: true }
        );
      }
    }

    res.status(200).json({
      success: true,
      message: 'System branding settings updated successfully.'
    });
  } catch (error) {
    next(error);
  }
};
