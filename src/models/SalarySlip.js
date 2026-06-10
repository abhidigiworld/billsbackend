const mongoose = require('mongoose');

const salarySlipSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  monthOfSalary: { type: String, required: true },
  workDays: { type: Number, required: true },
  salaryByWorkDays: { type: Number, required: true },
  overtimeHours: { type: Number, default: 0 },
  overtimeSalary: { type: Number, default: 0 },
  nightShiftHours: { type: Number, default: 0 },
  nightShiftDays: { type: Number, default: 0 },
  nightShiftRate: { type: Number, default: 0 },
  nightShiftAllowance: { type: Number, default: 0 },
  totalSalary: { type: Number, required: true },
  advance: { type: Number, default: 0 },
  esic: { type: Number, default: 0 },
  lunchDays: { type: Number, default: 0 },
  lunchRate: { type: Number, default: 0 },
  lunchDeduction: { type: Number, default: 0 },
  shiftHours: { type: Number, default: 8 },
  hra: { type: Number, default: 0 },
  inHandSalary: { type: Number, required: true }
}, { timestamps: true });

const SalarySlip = mongoose.model('SalarySlip', salarySlipSchema);

module.exports = SalarySlip;
