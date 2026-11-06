const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { processPayouts } = require('../jobs/payoutJob');
const { User, SupportTicket, PlanSubscription, Withdrawal, TopUp, ReferralReward } = require('../models');

// Global Guard: All routes in adminTools require authentication and admin role
router.use(protect, authorize('admin'));

// Admin: Get Dashboard Stats
router.get('/stats', protect, authorize('admin'), async (req, res, next) => {
  try {
    const totalUsers = await User.countDocuments({ role: 'customer' });
    const activePlans = await PlanSubscription.countDocuments({ status: 'active' });
    const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'requested' });
    const pendingReferrals = await ReferralReward.countDocuments({ 
      status: { $in: ['pending_admin', 'referrer_paid'] } 
    });
    
    const topUps = await TopUp.aggregate([
      { $match: { status: 'verified' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalDeposits = topUps.length > 0 ? topUps[0].total : 0;
    
    res.json({
      success: true,
      data: {
        totalUsers,
        activePlans,
        pendingWithdrawals,
        pendingReferrals,
        totalDeposits
      }
    });
  } catch (err) {
    next(err);
  }
});

// Admin endpoint to manually trigger cron
router.post('/trigger-payouts', protect, authorize('admin'), async (req, res, next) => {
  try {
    const result = await processPayouts();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Admin: Get all users (with search, filtering, and pagination)
router.get('/users', protect, authorize('admin'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.search) {
      const searchRegex = new RegExp(String(req.query.search).trim(), 'i');
      filter.$or = [
        { name: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
        { referralCode: searchRegex }
      ];
    }
    if (req.query.role) filter.role = req.query.role;
    if (req.query.status) filter.status = req.query.status;

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select('-passwordHash')
      .populate('referredBy', 'name phone email referralCode')
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      success: true,
      data: users,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (err) {
    next(err);
  }
});

// Admin: Get all tickets
router.get('/tickets', protect, authorize('admin'), async (req, res, next) => {
  try {
    const tickets = await SupportTicket.find({}).populate('user', 'name phone email').sort('-createdAt');
    res.json({ success: true, data: tickets });
  } catch (err) {
    next(err);
  }
});

// Admin: Update ticket status
router.put('/tickets/:id', protect, authorize('admin'), async (req, res, next) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    
    if (req.body.status) ticket.status = req.body.status;
    
    // Add admin response if provided
    if (req.body.responseMessage) {
      ticket.responses.push({
        sender: 'admin',
        message: req.body.responseMessage
      });
    }
    
    await ticket.save();
    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
});

const { getAllTopUps, approveTopUp, rejectTopUp } = require('../controllers/topUpController');
const upload = require('../middleware/upload');
const {
  getAdminPaymentSetting,
  updatePaymentSetting,
  addPaymentChannel,
  updatePaymentChannel,
  deletePaymentChannel,
  setPrimaryPaymentChannel,
  togglePaymentChannel
} = require('../controllers/paymentSettingController');
const {
  getAdminReferralRewards,
  sendReferrerReward,
  sendReferredUserReward,
  approveBothReferralRewards,
  rejectReferralReward
} = require('../controllers/referralAdminController');
const {
  getAdminReferralSetting,
  updateAdminReferralSetting,
  getPublicReferralSetting
} = require('../controllers/referralSettingController');

// Admin: Referral Amount Configuration & Rewards Management
router.get('/referral-settings', protect, authorize('admin'), getAdminReferralSetting);
router.put('/referral-settings', protect, authorize('admin'), updateAdminReferralSetting);
router.post('/referral-settings', protect, authorize('admin'), updateAdminReferralSetting);
router.get('/referrals', protect, authorize('admin'), getAdminReferralRewards);
router.post('/referrals/:id/send-referrer', protect, authorize('admin'), sendReferrerReward);
router.post('/referrals/:id/send-referred-user', protect, authorize('admin'), sendReferredUserReward);
router.post('/referrals/:id/approve-both', protect, authorize('admin'), approveBothReferralRewards);
router.post('/referrals/:id/reject', protect, authorize('admin'), rejectReferralReward);

// Admin: Get all top ups
router.get('/topups', protect, authorize('admin'), getAllTopUps);
router.post('/topups/:id/approve', protect, authorize('admin'), approveTopUp);
router.post('/topups/:id/reject', protect, authorize('admin'), rejectTopUp);

// Admin: Payment Settings (QR Code, UPI ID, Min/Max Limits)
router.get('/payment-settings', protect, authorize('admin'), getAdminPaymentSetting);
router.put('/payment-settings', protect, authorize('admin'), upload.single('qrImage'), updatePaymentSetting);
router.post('/payment-settings', protect, authorize('admin'), upload.single('qrImage'), updatePaymentSetting);

// Admin: Payment Channels Management
router.post('/payment-settings/channels', protect, authorize('admin'), upload.single('qrImage'), addPaymentChannel);
router.put('/payment-settings/channels/:channelId', protect, authorize('admin'), upload.single('qrImage'), updatePaymentChannel);
router.delete('/payment-settings/channels/:channelId', protect, authorize('admin'), deletePaymentChannel);
router.patch('/payment-settings/channels/:channelId/primary', protect, authorize('admin'), setPrimaryPaymentChannel);
router.patch('/payment-settings/channels/:channelId/toggle', protect, authorize('admin'), togglePaymentChannel);

// Admin: Financial Reconciliation & Ledger Auditing
const { reconcileUser, getReconciliationSummary, realignUserBalance } = require('../services/reconciliation');
const { AuditLog: AdminAuditLog } = require('../models');

router.get('/reconciliation/summary', async (req, res, next) => {
  try {
    const summary = await getReconciliationSummary();
    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
});

router.get('/reconciliation/user/:userId', async (req, res, next) => {
  try {
    const report = await reconcileUser(req.params.userId);
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

router.post('/reconciliation/fix-drift/:userId', async (req, res, next) => {
  try {
    const result = await realignUserBalance(req.params.userId, req.user._id, req.body.reason);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Admin: Audit Logs List (Paginated & Filterable)
router.get('/audit-logs', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.action) filter.action = req.query.action;
    if (req.query.targetModel) filter.targetModel = req.query.targetModel;
    if (req.query.adminUser) filter.adminUser = req.query.adminUser;

    const total = await AdminAuditLog.countDocuments(filter);
    const logs = await AdminAuditLog.find(filter)
      .populate('adminUser', 'name email phone')
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

