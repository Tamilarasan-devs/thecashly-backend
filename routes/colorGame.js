const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getCurrentRound, submitPrediction, getHistory } = require('../controllers/colorGameController');

router.use(protect);

router.get('/current', getCurrentRound);
router.post('/predict', submitPrediction);
router.get('/history', getHistory);

module.exports = router;
