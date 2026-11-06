const express = require('express');
const router = express.Router();
const {
  purchasePlan,
  getSubscriptions,
  collectEarnings,
  handleWebhook,
  verifyPayment
} = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');
const { idempotencyMiddleware } = require('../services/idempotency');

// Gateway Webhook (HMAC timing-safe signature checked in service)
router.post('/webhook', handleWebhook);

// Client-side payment verification (Idempotency protected)
router.post('/verify-payment', protect, idempotencyMiddleware(), verifyPayment);

// Core financial routes with idempotency
router.post('/purchase', protect, idempotencyMiddleware(), purchasePlan);
router.get('/subscriptions', protect, getSubscriptions);
router.post('/subscriptions/:id/collect', protect, idempotencyMiddleware(), collectEarnings);

module.exports = router;
