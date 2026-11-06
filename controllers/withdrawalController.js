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
      .populate('user', 'name phone email')
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

// @desc    Create manual withdrawal statement (Admin only)
// @route   POST /api/withdrawals/admin/manual-statement
// @access  Private/Admin
const createManualWithdrawalStatement = async (req, res, next) => {
  try {
    const { userId, amount, date, bankDetails, note, reference } = req.body;
    const { User, WalletLedgerEntry } = require('../models');

    if (!userId) {
      return next(new ApiError('Please select a user', 400));
    }

    const numAmount = Number(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      return next(new ApiError('Please enter a valid withdrawal amount', 400));
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return next(new ApiError('User not found', 404));
    }

    const statementDate = date ? new Date(date) : new Date();
    if (isNaN(statementDate.getTime())) {
      return next(new ApiError('Invalid date provided', 400));
    }

    const amountInPaise = Math.round(numAmount * 100);

    // Use bankDetails provided in payload or fall back to user's saved payoutDetails
    const finalSnapshot = {
      accountHolderName: bankDetails?.accountHolderName || targetUser.payoutDetails?.accountHolderName || targetUser.name,
      bankName: bankDetails?.bankName || targetUser.payoutDetails?.bankName || 'Direct Payout / Manual Transfer',
      accountNumber: bankDetails?.accountNumber || targetUser.payoutDetails?.accountNumber || 'Manual',
      ifscCode: bankDetails?.ifscCode || targetUser.payoutDetails?.ifscCode || 'MANUAL001',
      branchName: bankDetails?.branchName || targetUser.payoutDetails?.branchName || 'Head Office',
      upiId: bankDetails?.upiId || targetUser.payoutDetails?.upiId || ''
    };

    const paymentRef = reference?.trim() || `MAN-WD-${Date.now()}`;
    const adminNote = note?.trim() || 'Manual Withdrawal Statement Entry by Admin';

    // Create the withdrawal record directly marked as 'paid'
    const withdrawal = new Withdrawal({
      user: targetUser._id,
      amount: amountInPaise,
      status: 'paid',
      payoutDetailsSnapshot: finalSnapshot,
      adminReason: adminNote,
      paymentReference: paymentRef,
      isManualStatement: true,
      statementDate: statementDate,
      processedAt: statementDate,
      createdAt: statementDate
    });

    await withdrawal.save();

    // Create corresponding ledger entry so user's statement / history matches
    try {
      const ledgerEntry = new WalletLedgerEntry({
        user: targetUser._id,
        amount: -amountInPaise,
        type: 'debit',
        description: `Withdrawal payout of ₹${numAmount.toFixed(2)} to ${finalSnapshot.bankName} (${finalSnapshot.accountNumber}) [Ref: ${paymentRef}]`,
        referenceId: withdrawal._id,
        referenceModel: 'Withdrawal',
        balanceType: 'earning',
        createdAt: statementDate
      });
      await ledgerEntry.save();
    } catch (ledgerErr) {
      console.warn('Ledger entry note on manual statement:', ledgerErr.message);
    }

    const populatedWithdrawal = await Withdrawal.findById(withdrawal._id).populate('user', 'name phone email');

    res.status(201).json({
      success: true,
      message: `Manual withdrawal statement of ₹${numAmount.toFixed(2)} recorded for ${targetUser.name}`,
      data: populatedWithdrawal
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all manual withdrawal statements (admin)
// @route   GET /api/withdrawals/admin/manual-statements
// @access  Private/Admin
const getManualWithdrawalStatements = async (req, res, next) => {
  try {
    const list = await Withdrawal.find({ isManualStatement: true })
      .populate('user', 'name phone email payoutDetails')
      .sort('-createdAt')
      .limit(200)
      .lean();
    res.json({ success: true, data: list });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createWithdrawalRequest,
  updateUserBankDetailsController,
  getUserWithdrawals,
  getAllWithdrawals,
  approveWithdrawalRequest,
  rejectWithdrawalRequest,
  createManualWithdrawalStatement,
  getManualWithdrawalStatements
};
