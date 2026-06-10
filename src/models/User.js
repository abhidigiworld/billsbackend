const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    default: 'user',
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  otp: String,
  otpExpires: Date,
  resetOtp: String,
  resetOtpExpires: Date,
  activeSessionToken: {
    type: String,
    default: null
  },
  sessionLastActive: {
    type: Date,
    default: null
  },
  previousSessionToken: {
    type: String,
    default: null
  },
  lastTokenRotation: {
    type: Date,
    default: null
  }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

module.exports = User;
