const User = require('../models/User');
const Invoice = require('../models/Invoice');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const SalarySlip = require('../models/SalarySlip');
const LoginLog = require('../models/LoginLog');
const SystemSettings = require('../models/SystemSettings');

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

const getKolkataTime = () => {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
};

const runMonthlyBackupJob = async () => {
  try {
    const { sendBackupEmail } = require('./mailService');

    // 1. Check if auto backup is enabled
    const autoBackupEnabledSetting = await SystemSettings.findOne({ key: 'auto_backup_enabled' });
    const isAutoBackupEnabled = autoBackupEnabledSetting ? autoBackupEnabledSetting.value === true : true; // default true
    if (!isAutoBackupEnabled) {
      return;
    }

    // 2. Check current date in Kolkata
    const kolkataTime = getKolkataTime();
    const currentDay = kolkataTime.getDate();
    
    // Only run on the 1st of the month
    if (currentDay !== 1) {
      return;
    }

    // Current month string key, e.g. "2026-06"
    const currentMonthKey = `${kolkataTime.getFullYear()}-${String(kolkataTime.getMonth() + 1).padStart(2, '0')}`;

    // 3. Check if we already successfully ran the backup for this month
    const lastRunSetting = await SystemSettings.findOne({ key: 'last_monthly_backup_run_month' });
    if (lastRunSetting && lastRunSetting.value === currentMonthKey) {
      // Already run for this month
      return;
    }

    // 4. Retrieve recipient email and validate that they are an active administrator
    const backupEmailSetting = await SystemSettings.findOne({ key: 'backup_email' });
    let recipientEmail = backupEmailSetting ? backupEmailSetting.value : null;

    if (recipientEmail) {
      const isAdminEmail = await User.findOne({ email: recipientEmail, role: 'admin' });
      if (!isAdminEmail) {
        console.log(`[Backup Scheduler] Configured backup recipient ${recipientEmail} is no longer an administrator. Reverting.`);
        recipientEmail = null;
      }
    }

    // Fallback: If no email is configured or the configured email is no longer admin,
    // find the first active administrator's email
    if (!recipientEmail) {
      const firstAdmin = await User.findOne({ role: 'admin' });
      if (firstAdmin) {
        recipientEmail = firstAdmin.email;
        console.log(`[Backup Scheduler] Falling back to primary administrator email: ${recipientEmail}`);
      }
    }

    if (!recipientEmail) {
      console.log(`[Backup Scheduler] No backup recipient email configured and no active administrator found in database. Skipping automatic monthly backup.`);
      return;
    }

    console.log(`[Backup Scheduler] Starting automated monthly database backup for ${currentMonthKey}...`);
    
    // 5. Generate backup data
    const backupData = await generateDatabaseBackup();
    const todayStr = kolkataTime.toISOString().split('T')[0];
    const filename = `backup_monthly_sakshi_enterprises_${todayStr}.json`;

    // 6. Send the email
    await sendBackupEmail(recipientEmail, backupData, filename);

    // 7. Mark as successfully run
    await SystemSettings.findOneAndUpdate(
      { key: 'last_monthly_backup_run_month' },
      { value: currentMonthKey },
      { upsert: true, new: true }
    );

    console.log(`[Backup Scheduler] Automated monthly database backup for ${currentMonthKey} sent successfully to ${recipientEmail}.`);
  } catch (error) {
    console.error('[Backup Scheduler] Error running automated monthly database backup:', error);
  }
};

const runDailySupervisorRequestJob = async () => {
  try {
    const User = require('../models/User');
    const AttendanceRequest = require('../models/AttendanceRequest');
    const { sendAttendanceRequestEmail } = require('./mailService');
    const crypto = require('crypto');

    // 1. Get Kolkata date/time
    const kolkataTime = getKolkataTime();
    const currentHour = kolkataTime.getHours();
    const currentMinute = kolkataTime.getMinutes();
    
    // Retrieve target trigger time
    const triggerTimeSetting = await SystemSettings.findOne({ key: 'attendance_trigger_time' });
    const triggerTime = triggerTimeSetting ? triggerTimeSetting.value : '18:00';
    
    // Convert current and target time to minutes since midnight for easy comparison
    const [targetHour, targetMinute] = triggerTime.split(':').map(Number);
    const currentMinutes = currentHour * 60 + currentMinute;
    const targetMinutes = targetHour * 60 + targetMinute;

    if (currentMinutes < targetMinutes) {
      return;
    }

    const todayStr = kolkataTime.toISOString().split('T')[0];

    // 2. Verify if it already ran today
    const lastRunSetting = await SystemSettings.findOne({ key: 'last_daily_request_run_date' });
    if (lastRunSetting && lastRunSetting.value === todayStr) {
      // Already ran today
      return;
    }

    // 3. Skip automatic triggers on days marked as a Holiday in the main register
    const Attendance = require('../models/Attendance');
    const isHoliday = await Attendance.findOne({ date: todayStr, status: 'Holiday' });
    if (isHoliday) {
      console.log(`[Supervisor Link Scheduler] Today (${todayStr}) is marked as a Holiday. Skipping daily automatic request.`);
      await SystemSettings.findOneAndUpdate(
        { key: 'last_daily_request_run_date' },
        { value: todayStr },
        { upsert: true, new: true }
      );
      return;
    }

    // 4. Find active supervisors
    const recipientsSetting = await SystemSettings.findOne({ key: 'attendance_trigger_recipients' });
    const configuredRecipients = recipientsSetting ? recipientsSetting.value : null;

    let supervisors = [];
    if (Array.isArray(configuredRecipients) && configuredRecipients.length > 0) {
      // Find configured supervisors
      supervisors = await User.find({ 
        _id: { $in: configuredRecipients },
        role: 'supervisor'
      });
    } else {
      // Default fallback: all active supervisors
      supervisors = await User.find({ role: 'supervisor' });
    }

    if (supervisors.length === 0) {
      console.log(`[Supervisor Link Scheduler] No active target supervisors found. Skipping daily request.`);
      // Mark as "run" today anyway to avoid spam checking every 10 mins
      await SystemSettings.findOneAndUpdate(
        { key: 'last_daily_request_run_date' },
        { value: todayStr },
        { upsert: true, new: true }
      );
      return;
    }

    console.log(`[Supervisor Link Scheduler] Starting daily automatic attendance requests trigger for date ${todayStr}...`);

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours link expiry
    const appUrl = 'https://sakshienterprises.netlify.app';

    for (const sup of supervisors) {
      const token = crypto.randomBytes(16).toString('hex');
      const newRequest = new AttendanceRequest({
        token,
        date: todayStr,
        supervisorId: sup._id,
        email: sup.email,
        triggerType: 'automatic',
        expiresAt
      });
      await newRequest.save();

      const link = `${appUrl}/supervisor-attendance?token=${token}`;
      await sendAttendanceRequestEmail(sup.email, sup.name, todayStr, link);
    }

    // Mark as successfully run today
    await SystemSettings.findOneAndUpdate(
      { key: 'last_daily_request_run_date' },
      { value: todayStr },
      { upsert: true, new: true }
    );

    console.log(`[Supervisor Link Scheduler] Sent daily automatic requests successfully to ${supervisors.length} supervisors.`);
  } catch (error) {
    console.error('[Supervisor Link Scheduler] Error sending daily automatic requests:', error);
  }
};

const startBackupScheduler = () => {
  console.log('[Backup Scheduler] Initialized monthly database backup and supervisor request daemons...');
  
  // Run checks every 10 minutes (600,000 ms)
  setInterval(() => {
    runMonthlyBackupJob();
    runDailySupervisorRequestJob();
  }, 600000);
  
  // Also run initial checks shortly after startup
  setTimeout(runMonthlyBackupJob, 5000);
  setTimeout(runDailySupervisorRequestJob, 10000);
};

module.exports = {
  generateDatabaseBackup,
  startBackupScheduler
};
