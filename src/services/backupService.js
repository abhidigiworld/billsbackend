const User = require('../models/User');
const Invoice = require('../models/Invoice');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const SalarySlip = require('../models/SalarySlip');
const LoginLog = require('../models/LoginLog');

const generateDatabaseBackup = async () => {
  // Query all database records (excluding sensitive password hashes from backup for safety)
  const users = await User.find({}, '-password');
  const invoices = await Invoice.find({});
  const employees = await Employee.find({});
  const attendance = await Attendance.find({});
  const salarySlips = await SalarySlip.find({});
  const loginLogs = await LoginLog.find({});

  return {
    metadata: {
      generatedAt: new Date(),
      version: '1.0.0',
      system: 'Sakshi Enterprises'
    },
    data: {
      users,
      invoices,
      employees,
      attendance,
      salarySlips,
      loginLogs
    }
  };
};

module.exports = {
  generateDatabaseBackup
};
