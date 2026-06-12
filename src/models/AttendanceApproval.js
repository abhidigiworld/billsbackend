const mongoose = require('mongoose');

const attendanceApprovalSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  date: {
    type: String, // YYYY-MM-DD
    required: true
  },
  status: {
    type: String,
    enum: ['Present', 'Absent', 'Leave', 'Holiday'],
    required: true
  },
  workedDay: { type: Boolean, default: false },
  workedNight: { type: Boolean, default: false },
  checkIn: Date,
  checkOut: Date,
  nightCheckIn: Date,
  nightCheckOut: Date,
  overtimeHours: { type: Number, default: 0 },
  isNightShift: { type: Boolean, default: false },
  nightShiftHours: { type: Number, default: 0 },
  supervisorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approvalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  }
}, { timestamps: true });

// Prevent duplicate entries for the same employee and date
attendanceApprovalSchema.index({ employeeId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceApproval', attendanceApprovalSchema);
