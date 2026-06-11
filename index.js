const config = require('./src/config/config');
const connectDB = require('./src/config/db');
const app = require('./src/app');

const { startBackupScheduler } = require('./src/services/backupService');

// Connect Database
connectDB().then(() => {
  // Start automated backup monthly daemon
  startBackupScheduler();
});

// Listen locally
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(config.PORT, () => {
    console.log(`🚀 Server is running in ${config.NODE_ENV} mode on port ${config.PORT}`);
  });
}

// Export Express app for Vercel Serverless Functions
module.exports = app;
