const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

router.post('/api/attendance/check-in', attendanceController.checkIn);
router.post('/api/attendance/check-out', attendanceController.checkOut);
router.get('/api/attendance/my-records', attendanceController.getMyAttendance);

// Admin-only markings
router.get('/api/attendance', restrictTo('admin'), attendanceController.getAllAttendance);
router.post('/api/attendance/admin-mark', restrictTo('admin'), attendanceController.adminMarkAttendance);
router.post('/api/attendance/bulk-mark', restrictTo('admin'), attendanceController.bulkMarkAttendance);
router.post('/api/attendance/blanket-mark', restrictTo('admin'), attendanceController.blanketMarkAttendance);

module.exports = router;
