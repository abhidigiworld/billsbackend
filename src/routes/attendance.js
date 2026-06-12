const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');
const attendanceApprovalController = require('../controllers/attendanceApprovalController');
const { protect, restrictTo } = require('../middleware/auth');

// Public route to check token status before logging in
router.get('/api/attendance/supervisor-check-token', attendanceApprovalController.checkToken);

router.use(protect);

router.post('/api/attendance/check-in', attendanceController.checkIn);
router.post('/api/attendance/check-out', attendanceController.checkOut);
router.get('/api/attendance/my-records', attendanceController.getMyAttendance);

// Supervisor submissions
router.post('/api/attendance/supervisor-submit', restrictTo('supervisor', 'admin'), attendanceApprovalController.submitAttendance);

// Admin-only markings
router.get('/api/attendance', restrictTo('admin'), attendanceController.getAllAttendance);
router.post('/api/attendance/admin-mark', restrictTo('admin'), attendanceController.adminMarkAttendance);
router.post('/api/attendance/bulk-mark', restrictTo('admin'), attendanceController.bulkMarkAttendance);
router.post('/api/attendance/blanket-mark', restrictTo('admin'), attendanceController.blanketMarkAttendance);

// Admin Approval queue management & Request logs
router.get('/api/attendance/pending-approvals', restrictTo('admin'), attendanceApprovalController.getPendingApprovals);
router.get('/api/attendance/request-logs', restrictTo('admin'), attendanceApprovalController.getRequestLogs);
router.post('/api/attendance/send-request', restrictTo('admin'), attendanceApprovalController.sendManualRequest);
router.post('/api/attendance/approve', restrictTo('admin'), attendanceApprovalController.approveAttendance);
router.post('/api/attendance/reject', restrictTo('admin'), attendanceApprovalController.rejectAttendance);

module.exports = router;
