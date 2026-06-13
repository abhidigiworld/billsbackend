const config = require('./src/config/config');
const connectDB = require('./src/config/db');
const app = require('./src/app');

// Connect Database
connectDB();

// Listen locally
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(config.PORT, () => {
    console.log(`🚀 Server is running in ${config.NODE_ENV} mode on port ${config.PORT}`);
  });
}

// Export Express app for Vercel Serverless Functions
module.exports = app;
