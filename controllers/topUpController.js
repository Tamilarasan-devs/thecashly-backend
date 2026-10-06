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

// @desc    Get user's top-ups
// @route   GET /api/topups
// @access  Private
const getUserTopUps = async (req, res, next) => {
  try {
    const topUps = await TopUp.find({ user: req.user._id }).sort('-createdAt');
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
    const topUps = await TopUp.find({}).populate('user', 'name email').sort('-createdAt');
    res.json({ success: true, data: topUps });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  initTopUp,
  verifySandboxTopUp,
  getUserTopUps,
  getAllTopUps
};
