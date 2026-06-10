const express = require('express');
const router = express.Router();
const employeeController = require('../controllers/employeeController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

router.get('/api/employees', employeeController.getAllEmployees);
router.get('/api/employees/active', employeeController.getActiveEmployees);
router.get('/api/employees/my-profile', employeeController.getMyProfile);

// Admin-only management endpoints
router.post('/api/employees', restrictTo('admin'), employeeController.createEmployee);
router.put('/api/employees/:id', restrictTo('admin'), employeeController.updateEmployee);
router.delete('/api/employees/:id', restrictTo('admin'), employeeController.deleteEmployee);

module.exports = router;
