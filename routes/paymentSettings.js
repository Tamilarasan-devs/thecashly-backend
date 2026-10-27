const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  getActivePaymentSetting,
  getAdminPaymentSetting,
  updatePaymentSetting,
  addPaymentChannel,
  updatePaymentChannel,
  deletePaymentChannel,
  setPrimaryPaymentChannel,
  togglePaymentChannel
} = require('../controllers/paymentSettingController');

// Customer: Get active payment settings (automatically shuffled & balanced)
router.get('/', getActivePaymentSetting);
router.get('/rotate', getActivePaymentSetting);

// Admin: Get current payment settings
router.get('/admin', protect, authorize('admin'), getAdminPaymentSetting);

// Admin: Update global payment settings
router.put('/admin', protect, authorize('admin'), upload.single('qrImage'), updatePaymentSetting);
router.post('/admin', protect, authorize('admin'), upload.single('qrImage'), updatePaymentSetting);

// Admin: Payment Channels management
router.post('/admin/channels', protect, authorize('admin'), upload.single('qrImage'), addPaymentChannel);
router.put('/admin/channels/:channelId', protect, authorize('admin'), upload.single('qrImage'), updatePaymentChannel);
router.delete('/admin/channels/:channelId', protect, authorize('admin'), deletePaymentChannel);
router.patch('/admin/channels/:channelId/primary', protect, authorize('admin'), setPrimaryPaymentChannel);
router.patch('/admin/channels/:channelId/toggle', protect, authorize('admin'), togglePaymentChannel);

module.exports = router;
