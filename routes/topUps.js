const express = require('express');
const router = express.Router();
const { initTopUp, getUserTopUps, submitManualTopUp } = require('../controllers/topUpController');
const { protect } = require('../middleware/auth');
const { idempotencyMiddleware } = require('../services/idempotency');

router.post('/init', protect, idempotencyMiddleware(), initTopUp);
router.post('/submit-manual', protect, idempotencyMiddleware(), submitManualTopUp);
router.get('/', protect, getUserTopUps);

module.exports = router;
