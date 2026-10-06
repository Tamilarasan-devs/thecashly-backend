const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { playAviator, cashoutAviator, aviatorCrash, getHistory } = require('../controllers/aviatorController');

router.use(protect);

router.post('/play', playAviator);
router.post('/cashout', cashoutAviator);
router.post('/crash', aviatorCrash);
router.get('/history', getHistory);

module.exports = router;
