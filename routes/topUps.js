const express = require('express');
const router = express.Router();
const { initTopUp, verifySandboxTopUp, getUserTopUps } = require('../controllers/topUpController');
const { protect } = require('../middleware/auth');

router.post('/init', protect, initTopUp);
router.post('/verify-sandbox', verifySandboxTopUp);
router.get('/', protect, getUserTopUps);

module.exports = router;
