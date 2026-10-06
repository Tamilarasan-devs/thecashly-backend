const express = require('express');
const router = express.Router();
const { purchasePlan, getSubscriptions, collectEarnings } = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');

router.post('/purchase', protect, purchasePlan);
router.get('/subscriptions', protect, getSubscriptions);
router.post('/subscriptions/:id/collect', protect, collectEarnings);

module.exports = router;
