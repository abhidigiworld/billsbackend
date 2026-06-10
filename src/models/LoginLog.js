const mongoose = require('mongoose');

const loginLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true },
  email: { type: String, required: true },
  role: { type: String, required: true },
  loginTime: { type: Date, default: Date.now },
  ipAddress: { type: String },
  userAgent: { type: String }
});

const LoginLog = mongoose.model('LoginLog', loginLogSchema);

module.exports = LoginLog;
