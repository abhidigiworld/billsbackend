const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  checkIn: { type: Date },
  checkOut: { type: Date },
  nightCheckIn: { type: Date },
  nightCheckOut: { type: Date },
  status: { type: String, enum: ['Present', 'Absent', 'Leave', 'Holiday'], default: 'Absent' },
  overtimeHours: { type: Number, default: 0 },
  isNightShift: { type: Boolean, default: false },
  nightShiftHours: { type: Number, default: 0 }
}, { timestamps: true });

const Attendance = mongoose.model('Attendance', attendanceSchema);

module.exports = Attendance;
