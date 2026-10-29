const { Withdrawal } = require('../models');
const { ApiError } = require('../middleware/errorHandler');
const { 
  requestWithdrawal, 
  saveUserBankDetails, 
  approveWithdrawal, 
  rejectWithdrawal 
} = require('../services/withdrawal');

// @desc    Update or save user bank details
// @route   PUT /api/withdrawals/bank-details
// @access  Private
const updateUserBankDetailsController = async (req, res, next) => {
  try {
    const payoutDetails = await saveUserBankDetails(req.user._id, req.body);
    res.json({
      success: true,
      message: 'Bank details saved successfully',
      data: payoutDetails
    });
  } catch (error) {
    next(new ApiError(error.message, 400));
  }
};

// @desc    Request a withdrawal
// @route   POST /api/withdrawals/request
// @access  Private
const createWithdrawalRequest = async (req, res, next) => {
  try {
    const { amount, bankDetails } = req.body;
    
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return next(new ApiError('Please enter a valid withdrawal amount', 400));
    }
    
    const withdrawal = await requestWithdrawal(req.user._id, Number(amount), bankDetails);
    res.status(201).json({ 
      success: true, 
      message: 'Withdrawal requested successfully',
      data: withdrawal 
    });
  } catch (error) {
    next(new ApiError(error.message, 400));
  }
};

// @desc    Get user's withdrawals
// @route   GET /api/withdrawals
// @access  Private
const getUserWithdrawals = async (req, res, next) => {
  try {
    const withdrawals = await Withdrawal.find({ user: req.user._id })
      .sort('-createdAt')
      .limit(100)
      .lean();
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
    const withdrawals = await Withdrawal.find({})
      .populate('user', 'name email')
      .sort('-createdAt')
      .limit(200)
      .lean();
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
    
    const withdrawal = await approveWithdrawal(req.params.id, req.user._id, paymentReference || '');
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
  updateUserBankDetailsController,
  getUserWithdrawals,
  getAllWithdrawals,
  approveWithdrawalRequest,
  rejectWithdrawalRequest
};
