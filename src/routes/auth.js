const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect, restrictTo } = require('../middleware/auth');

// Public Auth routes
router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/verify-otp', authController.verifyOtp);
router.post('/resend-otp', authController.resendOtp);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Protected Auth / User management routes
router.post('/logout', protect, authController.logout);
router.get('/api/users', protect, restrictTo('admin'), authController.getAllUsers);
router.put('/api/users/:id', protect, restrictTo('admin'), authController.updateUser);
router.put('/api/users/profile/:id', protect, authController.updateUser);
router.delete('/api/users/:id', protect, restrictTo('admin'), authController.deleteUser);

// Admin-only logs and backups
router.get('/api/admin/login-logs', protect, restrictTo('admin'), authController.getLoginLogs);
router.get('/api/admin/backup', protect, restrictTo('admin'), authController.getDatabaseBackup);
router.get('/api/admin/backup-settings', protect, restrictTo('admin'), authController.getBackupSettings);
router.post('/api/admin/backup-settings', protect, restrictTo('admin'), authController.updateBackupSettings);
router.post('/api/admin/email-backup', protect, restrictTo('admin'), authController.sendBackupEmailNow);

module.exports = router;

