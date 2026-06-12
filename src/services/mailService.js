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

const sendBackupEmail = async (email, backupData, filename) => {
  if (!config.SMTP_USER || !config.SMTP_PASS) {
    console.log('SMTP credentials not set. Cannot send database backup email.');
    return { loggedToConsole: true };
  }

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"Sakshi Enterprises Backup" <${config.SMTP_USER}>`,
      to: email,
      subject: `Database Backup - Sakshi Enterprises`,
      text: `Please find attached the database backup for Sakshi Enterprises.\n\nGenerated on: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)`,
      attachments: [
        {
          filename: filename,
          content: JSON.stringify(backupData, null, 2),
          contentType: 'application/json'
        }
      ]
    });
    return { sent: true };
  } catch (error) {
    console.error('Failed to send backup email:', error);
    throw error;
  }
};

const sendAttendanceRequestEmail = async (email, name, date, link) => {
  if (!config.SMTP_USER || !config.SMTP_PASS) {
    console.log(`SMTP credentials not set. Cannot send attendance request. Link for ${email} (${date}): ${link}`);
    return { loggedToConsole: true };
  }

  try {
    const transporter = getTransporter();
    const formattedDate = new Date(date).toLocaleDateString('en-IN', {
      dateStyle: 'long',
      timeZone: 'Asia/Kolkata'
    });

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Attendance Logging Request</title>
        <style>
          body {
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            background-color: #f4f6f9;
            color: #333333;
            margin: 0;
            padding: 0;
          }
          .email-container {
            max-width: 600px;
            margin: 20px auto;
            background-color: #ffffff;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
            overflow: hidden;
            border: 1px solid #e1e4e8;
          }
          .email-header {
            background-color: #4f46e5;
            color: #ffffff;
            padding: 30px 20px;
            text-align: center;
          }
          .email-header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 800;
            letter-spacing: 0.5px;
          }
          .email-body {
            padding: 30px;
            line-height: 1.6;
          }
          .email-body p {
            margin-top: 0;
            margin-bottom: 20px;
            font-size: 15px;
          }
          .email-body strong {
            color: #111827;
          }
          .cta-container {
            text-align: center;
            margin: 35px 0;
          }
          .cta-button {
            background-color: #4f46e5;
            color: #ffffff !important;
            text-decoration: none;
            padding: 14px 28px;
            font-weight: 700;
            font-size: 14px;
            border-radius: 8px;
            display: inline-block;
            box-shadow: 0 4px 6px rgba(79, 70, 229, 0.15);
          }
          .email-footer {
            background-color: #f9fafb;
            padding: 20px;
            text-align: center;
            font-size: 11px;
            color: #6b7280;
            border-top: 1px solid #f3f4f6;
          }
          .warning-text {
            font-size: 12px;
            color: #b91c1c;
            background-color: #fef2f2;
            padding: 12px;
            border-radius: 6px;
            border: 1px solid #fee2e2;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="email-header">
            <h1>Attendance Logging Request</h1>
          </div>
          <div class="email-body">
            <p>Hello <strong>${name}</strong>,</p>
            <p>You have been requested to mark and log the employee attendance records for <strong>${formattedDate}</strong>.</p>
            <p>Please click the button below to access the secure supervisor attendance portal and submit the logs:</p>
            
            <div class="cta-container">
              <a href="${link}" class="cta-button" style="color: #ffffff;">Mark Attendance Now</a>
            </div>
            
            <div class="warning-text">
              <strong>Security Warning:</strong> This is a secure, temporary link and will automatically expire in <strong>24 hours</strong>. You will only be able to submit the attendance sheet <strong>once</strong>. Once submitted, editing is locked.
            </div>
          </div>
          <div class="email-footer">
            <strong>Sakshi Enterprises</strong><br>
            This is an automated system email. Please do not reply directly.<br>
            © 2026 Sakshi Enterprises. All rights reserved.
          </div>
        </div>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: `"Sakshi Enterprises" <${config.SMTP_USER}>`,
      to: email,
      subject: `Attendance Request - Sakshi Enterprises - ${formattedDate}`,
      html: htmlContent,
    });
    return { sent: true };
  } catch (error) {
    console.error('Failed to send SMTP attendance request email:', error);
    throw error;
  }
};

module.exports = {
  sendOTPEmail,
  sendBackupEmail,
  sendAttendanceRequestEmail
};

