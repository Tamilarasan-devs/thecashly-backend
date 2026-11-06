const { TopUp, Notification } = require('../models');
const { ApiError } = require('../middleware/errorHandler');
const { recordLedgerEntry } = require('../services/ledger');
const { logAuditEvent } = require('../services/auditLogger');
const { triggerReferralCheckOnDeposit } = require('./referralAdminController');

// @desc    Initialize a top-up
// @route   POST /api/topups/init
// @access  Private
const initTopUp = async (req, res, next) => {
  try {
    const { amount } = req.body;
    
    // Amount should be in paise
    if (!amount || amount < 10000) { // Min 100 INR
      return next(new ApiError('Minimum top-up amount is ₹100', 400));
    }
    if (amount > 10000000) { // Max 1,00,000 INR
      return next(new ApiError('Maximum top-up amount is ₹100,000', 400));
    }

    const topUp = await TopUp.create({
      user: req.user._id,
      amount,
      status: 'pending',
      paymentMethod: 'sandbox_gateway'
    });
    
    res.status(201).json({
      success: true,
      data: {
        topUpId: topUp._id,
        amount: topUp.amount,
        message: 'Top-up initiated.'
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Submit manual UPI top-up with UTR
// @route   POST /api/topups/submit-manual
// @access  Private
const submitManualTopUp = async (req, res, next) => {
  try {
    const { amount, utr, paymentMethod } = req.body;

    if (!amount || Number(amount) < 10000) {
      return next(new ApiError('Minimum deposit is ₹100', 400));
    }
    if (Number(amount) > 10000000) {
      return next(new ApiError('Maximum deposit is ₹100,000', 400));
    }

    const cleanUtr = String(utr || '').replace(/[\s-]/g, '').trim().toUpperCase();
    if (!cleanUtr || cleanUtr.length < 6 || cleanUtr.length > 30) {
      return next(new ApiError('Please enter a valid 12-digit UTR / Reference number', 400));
    }

    // Check if this UTR has already been submitted in any state
    const existing = await TopUp.findOne({
      $or: [
        { utr: cleanUtr },
        { gatewayReference: cleanUtr }
      ]
    });

    if (existing) {
      return next(new ApiError('This UTR / Reference number has already been submitted.', 400));
    }

    const topUp = await TopUp.create({
      user: req.user._id,
      amount: Number(amount),
      utr: cleanUtr,
      gatewayReference: cleanUtr,
      status: 'pending',
      paymentMethod: paymentMethod || 'manual_upi'
    });

    res.status(201).json({
      success: true,
      message: 'Deposit request submitted successfully. It will be verified shortly.',
      data: topUp
    });
  } catch (error) {
    if (error.code === 11000 || error.message?.includes('duplicate key') || error.message?.includes('E11000')) {
      return next(new ApiError('This UTR / Reference number has already been submitted.', 400));
    }
    next(error);
  }
};

// @desc    Get user's top-ups
// @route   GET /api/topups
// @access  Private
const getUserTopUps = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = { user: req.user._id };
    if (req.query.status) filter.status = req.query.status;

    const total = await TopUp.countDocuments(filter);
    const topUps = await TopUp.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      success: true,
      data: topUps,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all top-ups (Admin)
// @route   GET /api/admin/topups
// @access  Private/Admin
const getAllTopUps = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.search) {
      const searchRegex = new RegExp(String(req.query.search).trim(), 'i');
      filter.$or = [
        { utr: searchRegex },
        { gatewayReference: searchRegex }
      ];
    }

    const total = await TopUp.countDocuments(filter);
    const topUps = await TopUp.find(filter)
      .populate('user', 'name email phone')
      .populate('reviewedBy', 'name email')
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      success: true,
      data: topUps,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Approve top-up (Admin)
// @route   POST /api/admin/topups/:id/approve
// @access  Private/Admin
const approveTopUp = async (req, res, next) => {
  try {
    const topUp = await TopUp.findById(req.params.id);
    if (!topUp) {
      return next(new ApiError('Top-up request not found', 404));
    }

    if (topUp.status === 'verified') {
      return res.json({ success: true, message: 'Top-up is already approved', data: topUp });
    }

    topUp.status = 'verified';
    topUp.reviewedBy = req.user._id;
    topUp.reviewedAt = new Date();
    topUp.verifiedAt = new Date();
    await topUp.save();

    // Credit wallet using ledger
    await recordLedgerEntry(
      topUp.user,
      topUp.amount,
      'credit',
      `Wallet deposit approved (UTR: ${topUp.utr || topUp.gatewayReference || topUp._id})`,
      topUp._id,
      'TopUp'
    );

    // Audit and trigger referral review if user was referred
    try {
      await triggerReferralCheckOnDeposit(topUp);
    } catch (refErr) {
      console.error('[TopUp] Error checking referral reward:', refErr);
    }

    // Send user notification for approved deposit
    try {
      await Notification.create({
        user: topUp.user,
        title: 'Deposit Approved! 💰',
        message: `Your wallet deposit of ₹${(topUp.amount / 100).toFixed(2)} has been verified and added to your balance.`,
        type: 'deposit_approved',
        amount: topUp.amount,
        metadata: { topUpId: topUp._id, utr: topUp.utr }
      });
    } catch (notifErr) {
      console.error('[Notification] Failed to create deposit notification:', notifErr.message);
    }

    // Audit log
    await logAuditEvent({
      adminUser: req.user._id,
      action: 'TOPUP_APPROVED',
      targetModel: 'TopUp',
      targetId: topUp._id,
      changes: { status: 'verified', amount: topUp.amount, utr: topUp.utr },
      reason: 'Admin verified deposit',
      req
    });

    res.json({
      success: true,
      message: 'Top-up approved and user wallet credited successfully.',
      data: topUp
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reject top-up (Admin)
// @route   POST /api/admin/topups/:id/reject
// @access  Private/Admin
const rejectTopUp = async (req, res, next) => {
  try {
    const topUp = await TopUp.findById(req.params.id);
    if (!topUp) {
      return next(new ApiError('Top-up request not found', 404));
    }

    if (topUp.status === 'verified') {
      return next(new ApiError('Cannot reject an already approved top-up', 400));
    }

    topUp.status = 'failed';
    topUp.rejectionReason = req.body.reason || 'Payment not received / Invalid UTR';
    topUp.reviewedBy = req.user._id;
    topUp.reviewedAt = new Date();
    await topUp.save();

    // Audit log
    await logAuditEvent({
      adminUser: req.user._id,
      action: 'TOPUP_REJECTED',
      targetModel: 'TopUp',
      targetId: topUp._id,
      changes: { status: 'failed', rejectionReason: topUp.rejectionReason },
      reason: topUp.rejectionReason,
      req
    });

    res.json({
      success: true,
      message: 'Top-up request rejected.',
      data: topUp
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  initTopUp,
  submitManualTopUp,
  getUserTopUps,
  getAllTopUps,
  approveTopUp,
  rejectTopUp
};
