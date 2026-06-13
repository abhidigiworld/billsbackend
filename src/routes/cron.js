const express = require('express');
const router = express.Router();
const { runMonthlyBackupJob, runDailySupervisorRequestJob } = require('../services/backupService');

// Security Middleware to verify CRON_SECRET token
const checkCronSecret = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn(`[Cron Scheduler] Unauthorized trigger attempt from IP: ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Route 1: Trigger database backup
router.post('/api/cron/backup', checkCronSecret, async (req, res, next) => {
  try {
    console.log('[Cron Scheduler] Triggering database backup job...');
    // force = true to run nightly regardless of the day of month
    await runMonthlyBackupJob(true);
    res.status(200).json({ success: true, message: 'Backup job completed successfully.' });
  } catch (error) {
    console.error('[Cron Scheduler] Backup job failed:', error);
    next(error);
  }
});

// Route 2: Trigger daily supervisor request emails
router.post('/api/cron/attendance-email', checkCronSecret, async (req, res, next) => {
  try {
    console.log('[Cron Scheduler] Triggering daily supervisor attendance email job...');
    // force = false to respect admin-configured time settings and check already-run status
    await runDailySupervisorRequestJob(false);
    res.status(200).json({ success: true, message: 'Attendance email job completed successfully.' });
  } catch (error) {
    console.error('[Cron Scheduler] Attendance email job failed:', error);
    next(error);
  }
});

module.exports = router;
