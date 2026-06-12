const mongoose = require('mongoose');

const attendanceRequestSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true
  },
  date: {
    type: String, // YYYY-MM-DD
    required: true
  },
  supervisorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  email: {
    type: String,
    required: true
  },
  triggerType: {
    type: String,
    enum: ['automatic', 'manual'],
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  isSubmitted: {
    type: Boolean,
    default: false
  },
  submittedAt: {
    type: Date
  }
}, { timestamps: true });

module.exports = mongoose.model('AttendanceRequest', attendanceRequestSchema);
