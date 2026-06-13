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

const sendOTPEmail = async (email, otp, subject, type = 'verification') => {
  console.log(`[OTP Verification] OTP for ${email}: ${otp}`);
  
  if (!config.SMTP_USER || !config.SMTP_PASS) {
    console.log(`SMTP credentials not set. Logging OTP to console: ${otp}`);
    return { loggedToConsole: true };
  }

  const isReset = type === 'reset';
  const actionText = isReset ? 'password reset' : 'account verification';
  const actionLabel = isReset ? 'Password Reset Code' : 'Verification Code';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${subject}</title>
      <style>
        body {
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          background-color: #f4f6f9;
          color: #333333;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }
        .email-container {
          max-width: 500px;
          margin: 30px auto;
          background-color: #ffffff;
          border-radius: 12px;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05);
          overflow: hidden;
          border: 1px solid #e1e4e8;
        }
        .email-header {
          background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
          color: #ffffff;
          padding: 24px 20px;
          text-align: center;
        }
        .email-header h1 {
          margin: 0;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 0.5px;
        }
        .email-body {
          padding: 30px 24px;
          line-height: 1.6;
        }
        .email-body p {
          margin-top: 0;
          margin-bottom: 20px;
          font-size: 15px;
          color: #4b5563;
        }
        .otp-container {
          text-align: center;
          margin: 25px 0;
          padding: 18px;
          background-color: #f3f4f6;
          border-radius: 8px;
          border: 1px dashed #d1d5db;
        }
        .otp-code {
          font-family: 'Courier New', Courier, monospace;
          font-size: 32px;
          font-weight: 850;
          letter-spacing: 6px;
          color: #111827;
        }
        .email-footer {
          background-color: #f9fafb;
          padding: 20px;
          text-align: center;
          font-size: 11px;
          color: #6b7280;
          border-top: 1px solid #f3f4f6;
        }
        .warning-box {
          font-size: 12px;
          color: #b91c1c;
          background-color: #fef2f2;
          padding: 12px 16px;
          border-radius: 8px;
          border: 1px solid #fee2e2;
          margin-top: 25px;
          line-height: 1.5;
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="email-header">
          <h1>Sakshi Enterprises Portal</h1>
        </div>
        <div class="email-body">
          <p>Hello,</p>
          <p>You requested a one-time passcode (OTP) for <strong>${actionText}</strong> on the Sakshi Enterprises management system.</p>
          <p>Please enter the following ${actionLabel} to complete the request:</p>
          
          <div class="otp-container">
            <span class="otp-code">${otp}</span>
          </div>
          
          <p style="font-size: 13px; color: #6b7280; text-align: center; margin-bottom: 0;">This code is valid for <strong>10 minutes</strong>. If you did not request this, please ignore this email.</p>
          
          <div class="warning-box">
            <strong>⚠️ Security Notice:</strong> For your security, never share this code with anyone. Sakshi Enterprises team members will never ask for your OTP or password.
          </div>
        </div>
        <div class="email-footer">
          <strong>Sakshi Enterprises Management System</strong><br>
          This is an automated system notification. Please do not reply.<br>
          © 2026 Sakshi Enterprises. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"Sakshi Enterprises" <${config.SMTP_USER}>`,
      to: email,
      subject: subject,
      html: htmlContent,
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

