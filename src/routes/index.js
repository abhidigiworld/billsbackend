const express = require('express');
const router = express.Router();

const authRoutes = require('./auth');
const invoiceRoutes = require('./invoices');
const employeeRoutes = require('./employees');
const attendanceRoutes = require('./attendance');
const salarySlipRoutes = require('./salarySlips');
const aiChatRoutes = require('./aiChat');

// Register feature routes
router.use(authRoutes);
router.use(invoiceRoutes);
router.use(employeeRoutes);
router.use(attendanceRoutes);
router.use(salarySlipRoutes);
router.use(aiChatRoutes);

module.exports = router;
