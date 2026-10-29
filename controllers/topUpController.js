const { TopUp } = require('../models');
const { ApiError } = require('../middleware/errorHandler');
const { recordLedgerEntry } = require('../services/ledger');

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

// @desc    Simulate sandbox top-up verification
// @route   POST /api/topups/verify-sandbox
// @access  Public
const verifySandboxTopUp = async (req, res, next) => {
  try {
    const { topUpId, status, gatewayReference } = req.body;
    
    // NOTE: IN PRODUCTION, this endpoint must verify webhook signatures
    // or call the provider (Stripe, Razorpay) directly to confirm status!
    
    const topUp = await TopUp.findById(topUpId);
    if (!topUp) {
      return next(new ApiError('Top-up not found', 404));
    }

    if (topUp.status === 'verified') {
      return res.json({ success: true, message: 'Top-up already verified', data: topUp });
    }

    if (status === 'success') {
      topUp.status = 'verified';
      topUp.gatewayReference = gatewayReference || `MOCK_${Date.now()}`;
      topUp.verifiedAt = new Date();
      await topUp.save();

      // Credit wallet idempotently using ledger
      await recordLedgerEntry(
        topUp.user,
        topUp.amount,
        'credit',
        'Wallet top-up via Sandbox Gateway',
        topUp._id,
        'TopUp'
      );
      
      res.json({ success: true, message: 'Top-up successful', data: topUp });
    } else {
      topUp.status = 'failed';
      await topUp.save();
      res.json({ success: true, message: 'Top-up failed' });
    }
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

    const cleanUtr = String(utr || '').trim();
    if (!cleanUtr || cleanUtr.length < 6) {
      return next(new ApiError('Please enter a valid 12-digit UTR / Reference number', 400));
    }

    // Check if this UTR has already been submitted
    const existing = await TopUp.findOne({
      $or: [
        { utr: cleanUtr },
        { gatewayReference: cleanUtr }
      ],
      status: { $in: ['pending', 'verified'] }
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
    next(error);
  }
};

// @desc    Get user's top-ups
// @route   GET /api/topups
// @access  Private
const getUserTopUps = async (req, res, next) => {
  try {
    const topUps = await TopUp.find({ user: req.user._id }).sort('-createdAt').limit(100).lean();
    res.json({ success: true, data: topUps });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all top-ups (Admin)
// @route   GET /api/admin/topups
// @access  Private/Admin
const getAllTopUps = async (req, res, next) => {
  try {
    const topUps = await TopUp.find({})
      .populate('user', 'name email phone')
      .populate('reviewedBy', 'name email')
      .sort('-createdAt')
      .limit(200)
      .lean();
    res.json({ success: true, data: topUps });
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
  verifySandboxTopUp,
  submitManualTopUp,
  getUserTopUps,
  getAllTopUps,
  approveTopUp,
  rejectTopUp
};
