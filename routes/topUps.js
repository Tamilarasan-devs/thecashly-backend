const express = require('express');
const router = express.Router();
const { initTopUp, verifySandboxTopUp, getUserTopUps, submitManualTopUp } = require('../controllers/topUpController');
const { protect } = require('../middleware/auth');

router.post('/init', protect, initTopUp);
router.post('/submit-manual', protect, submitManualTopUp);
router.post('/verify-sandbox', verifySandboxTopUp);
router.get('/', protect, getUserTopUps);

module.exports = router;
