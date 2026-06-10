const express = require('express');
const router = express.Router();
const salarySlipController = require('../controllers/salarySlipController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

router.get('/api/salary-slips/my-slips', salarySlipController.getMySalarySlips);

// Admin-only slips management
router.get('/api/salary-slips', restrictTo('admin'), salarySlipController.getAllSalarySlips);
router.post('/api/salary-slips', restrictTo('admin'), salarySlipController.createSalarySlip);
router.put('/api/salary-slips/:id', restrictTo('admin'), salarySlipController.updateSalarySlip);
router.delete('/api/salary-slips/:id', restrictTo('admin'), salarySlipController.deleteSalarySlip);

module.exports = router;
