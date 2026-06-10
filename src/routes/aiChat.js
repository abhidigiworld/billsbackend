const express = require('express');
const router = express.Router();
const aiChatController = require('../controllers/aiChatController');
const aiRateLimiter = require('../middleware/rateLimiter');
const { protect } = require('../middleware/auth');

// Protect AI chat to prevent API billing abuse
router.post('/api/ai/chat', protect, aiRateLimiter, aiChatController.aiChat);

module.exports = router;
