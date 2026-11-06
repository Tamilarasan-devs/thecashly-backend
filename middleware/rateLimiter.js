const rateLimit = require('express-rate-limit');

// General API Rate Limiter: max 300 requests per minute
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests from this IP. Please try again in a minute.'
  }
});

// Authentication Limiter (login, register): max 15 attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many login or registration attempts. Please wait 15 minutes before trying again.'
  }
});

// Transaction Limiter (deposits, withdrawals, purchases): max 25 requests per minute
const transactionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Transaction rate limit exceeded. Please wait a moment before trying again.'
  }
});

module.exports = {
  apiLimiter,
  authLimiter,
  transactionLimiter
};

