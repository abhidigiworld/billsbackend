const nodemailer = require('nodemailer');
const config = require('../config/config');

const getTransporter = () => {
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    },
  });
};

const sendOTPEmail = async (email, otp, subject, text) => {
  console.log(`[OTP Verification] OTP for ${email}: ${otp}`);
  
  if (!config.SMTP_USER || !config.SMTP_PASS) {
    console.log(`SMTP credentials not set. Logging OTP to console: ${otp}`);
    return { loggedToConsole: true };
  }

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"Sakshi Enterprises" <${config.SMTP_USER}>`,
      to: email,
      subject: subject,
      text: text,
    });
    return { sent: true };
  } catch (error) {
    console.error('Failed to send SMTP email:', error);
    throw error;
  }
};

module.exports = {
  sendOTPEmail
};
