const express = require('express');
const router = express.Router();
const { 
  getTransactionHistory, 
  getPayoutSchedule, 
  getSupportTickets, 
  createSupportTicket,
  replyToTicket 
} = require('../controllers/serviceController');
const { protect } = require('../middleware/auth');
const { getPublicReferralSetting } = require('../controllers/referralSettingController');

router.get('/referral-settings', getPublicReferralSetting);
router.get('/history', protect, getTransactionHistory);
router.get('/schedule', protect, getPayoutSchedule);
router.get('/tickets', protect, getSupportTickets);
router.post('/tickets', protect, createSupportTicket);
router.post('/tickets/:id/reply', protect, replyToTicket);

module.exports = router;
