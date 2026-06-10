require('dotenv').config();

const requiredEnvs = ['MONGODB_URI'];
const missingEnvs = requiredEnvs.filter(env => !process.env[env]);

if (missingEnvs.length > 0) {
  console.error(`🚨 Fatal Configuration Error: Missing required environment variables: ${missingEnvs.join(', ')}`);
  process.exit(1);
}

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 3000,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET || 'sakshi-enterprises-secure-jwt-key-2026',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  GROQ_API_KEY: process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'your_groq_api_key_here' ? process.env.GROQ_API_KEY : null,
  SESSION_LOCK_TIMEOUT_MS: parseInt(process.env.SESSION_LOCK_TIMEOUT || '900000', 10) // default is 15 minutes (900000 ms)
};
