const { Withdrawal } = require('../models');
const { ApiError } = require('../middleware/errorHandler');
const { requestWithdrawal, approveWithdrawal, rejectWithdrawal } = require('../services/withdrawal');

// @desc    Request a withdrawal
// @route   POST /api/withdrawals/request
// @access  Private
const createWithdrawalRequest = async (req, res, next) => {
  try {
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return next(new ApiError('Invalid withdrawal amount', 400));
    }
    
    const withdrawal = await requestWithdrawal(req.user._id, amount);
    res.status(201).json({ success: true, data: withdrawal });
  } catch (error) {
    next(new ApiError(error.message, 400));
  }
};

// @desc    Get user's withdrawals
// @route   GET /api/withdrawals
// @access  Private
const getUserWithdrawals = async (req, res, next) => {
  try {
    const withdrawals = await Withdrawal.find({ user: req.user._id }).sort('-createdAt');
    res.json({ success: true, data: withdrawals });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all withdrawals (admin)
// @route   GET /api/withdrawals/admin
// @access  Private/Admin
const getAllWithdrawals = async (req, res, next) => {
  try {
    const withdrawals = await Withdrawal.find({}).populate('user', 'name email').sort('-createdAt');
    res.json({ success: true, data: withdrawals });
  } catch (error) {
    next(error);
  }
};

// @desc    Approve a withdrawal
// @route   POST /api/withdrawals/:id/approve
// @access  Private/Admin
const approveWithdrawalRequest = async (req, res, next) => {
  try {
    const { paymentReference } = req.body;
    
    if (!paymentReference) {
      return next(new ApiError('Payment reference is required to approve', 400));
    }
    
    const withdrawal = await approveWithdrawal(req.params.id, req.user._id, paymentReference);
    res.json({ success: true, data: withdrawal });
  } catch (error) {
    next(new ApiError(error.message, 400));
  }
};

// @desc    Reject a withdrawal
// @route   POST /api/withdrawals/:id/reject
// @access  Private/Admin
const rejectWithdrawalRequest = async (req, res, next) => {
  try {
    const { reason } = req.body;
    
    if (!reason) {
      return next(new ApiError('Reason is required to reject', 400));
    }
    
    const withdrawal = await rejectWithdrawal(req.params.id, req.user._id, reason);
    res.json({ success: true, data: withdrawal });
  } catch (error) {
    next(new ApiError(error.message, 400));
  }
};

module.exports = {
  createWithdrawalRequest,
  getUserWithdrawals,
  getAllWithdrawals,
  approveWithdrawalRequest,
  rejectWithdrawalRequest
};
