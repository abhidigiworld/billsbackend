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

    // 4. Retrieve recipient email
    const backupEmailSetting = await SystemSettings.findOne({ key: 'backup_email' });
    const recipientEmail = backupEmailSetting ? backupEmailSetting.value : null;

    if (!recipientEmail) {
      console.log(`[Backup Scheduler] No backup recipient email configured. Skipping automatic monthly backup.`);
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

const startBackupScheduler = () => {
  console.log('[Backup Scheduler] Initialized monthly database backup daemon...');
  // Run check every 10 minutes (600,000 ms)
  setInterval(runMonthlyBackupJob, 600000);
  
  // Also run an initial check 5 seconds after startup
  setTimeout(runMonthlyBackupJob, 5000);
};

module.exports = {
  generateDatabaseBackup,
  startBackupScheduler
};
