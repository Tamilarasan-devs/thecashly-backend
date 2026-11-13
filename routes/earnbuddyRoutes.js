const express = require('express');
const router = express.Router();
const { connections } = require('../config/dbManager');

// Mount all feature sub-routers for EarnBuddy
router.get('/health', (req, res) => res.json({ 
  status: 'ok', 
  service: 'EarnBuddy API', 
  tenant: req.tenant,
  hasEarnBuddyDb: !!connections.earnbuddy,
  earnbuddyDbName: connections.earnbuddy?.name,
  timestamp: new Date() 
}));
router.use('/auth', require('./auth'));
router.use('/plans', require('./plans'));
router.use('/payments', require('./payments'));
router.use('/withdrawals', require('./withdrawals'));
router.use('/topups', require('./topUps'));
router.use('/services', require('./services'));
router.use('/payment-settings', require('./paymentSettings'));
router.use('/admin', require('./adminTools'));
router.use('/notifications', require('./notifications'));
router.use('/colorgame', require('./colorGame'));
router.use('/aviator', require('./aviator'));

module.exports = router;
