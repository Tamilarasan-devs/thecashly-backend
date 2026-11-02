const { ReferralReward, User, WalletLedgerEntry } = require('../models');
const { ApiError } = require('../middleware/errorHandler');

/**
 * Checks if the deposited user was referred by someone.
 * If yes, creates or updates a ReferralReward request pending manual admin review.
 */
async function triggerReferralCheckOnDeposit(topUpDoc) {
  try {
    const depositedUser = await User.findById(topUpDoc.user);
    if (!depositedUser || !depositedUser.referredBy) {
      return null;
    }

    const referrer = await User.findById(depositedUser.referredBy);
    if (!referrer) {
      return null;
    }

    // Check if a referral reward already exists for this topUp
    let existingReward = await ReferralReward.findOne({ topUp: topUpDoc._id });
    if (!existingReward) {
      existingReward = await ReferralReward.create({
        referrer: referrer._id,
        referredUser: depositedUser._id,
        topUp: topUpDoc._id,
        depositAmount: topUpDoc.amount,
        status: 'pending_admin'
      });
      console.log(`[Referral Audit] Created pending referral reward review for deposit of ₹${(topUpDoc.amount / 100).toFixed(2)} by ${depositedUser.name} (Referred by ${referrer.name})`);
    }

    return existingReward;
  } catch (err) {
    console.error('[Referral Audit] Error in triggerReferralCheckOnDeposit:', err);
    return null;
  }
}

// @desc    Get all referral reward requests for admin
// @route   GET /api/admin/referrals
// @access  Private/Admin
const getAdminReferralRewards = async (req, res, next) => {
  try {
    const rewards = await ReferralReward.find({})
      .populate('referrer', 'name email referralCode walletBalance')
      .populate('referredUser', 'name email referralCode walletBalance')
      .populate('topUp', 'amount utr paymentMethod createdAt status')
      .populate('reviewedBy', 'name email')
      .sort('-createdAt')
      .lean();

    res.json({
      success: true,
      data: rewards
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin manually sends referral reward to Referrer
// @route   POST /api/admin/referrals/:id/send-referrer
// @access  Private/Admin
const sendReferrerReward = async (req, res, next) => {
  try {
    const { amount, note } = req.body;
    const numAmount = Number(amount);
    if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
      return next(new ApiError('Please enter a valid reward amount in rupees', 400));
    }

    const reward = await ReferralReward.findById(req.params.id)
      .populate('referrer', 'name email')
      .populate('referredUser', 'name email');

    if (!reward) {
      return next(new ApiError('Referral reward record not found', 404));
    }

    if (reward.referrerRewardAmount > 0) {
      return next(new ApiError('Referrer has already been credited for this referral deposit', 400));
    }

    const amountInPaise = Math.round(numAmount * 100);

    // Credit referrer's wallet
    const referrer = await User.findById(reward.referrer._id);
    if (!referrer) {
      return next(new ApiError('Referrer user not found', 404));
    }

    referrer.walletBalance = (referrer.walletBalance || 0) + amountInPaise;
    referrer.referralEarnings = (referrer.referralEarnings || 0) + amountInPaise;
    await referrer.save();

    // Create ledger entry
    await WalletLedgerEntry.create({
      user: referrer._id,
      amount: amountInPaise,
      type: 'credit',
      description: note?.trim() || `Manual referral bonus for referral ${reward.referredUser.name}'s deposit`,
      referenceId: reward._id,
      referenceModel: 'Referral',
      balanceType: 'wallet'
    });

    reward.referrerRewardAmount = amountInPaise;
    reward.referrerNote = note?.trim() || 'Referral reward sent by Admin';
    reward.referrerPaidAt = new Date();
    reward.reviewedBy = req.user._id;

    if (reward.referredUserRewardAmount > 0) {
      reward.status = 'both_paid';
    } else {
      reward.status = 'referrer_paid';
    }

    await reward.save();

    res.json({
      success: true,
      message: `Successfully sent referral reward of ₹${numAmount} to referrer ${referrer.name}`,
      data: reward
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin manually sends referral reward to Referred User
// @route   POST /api/admin/referrals/:id/send-referred-user
// @access  Private/Admin
const sendReferredUserReward = async (req, res, next) => {
  try {
    const { amount, note } = req.body;
    const numAmount = Number(amount);
    if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
      return next(new ApiError('Please enter a valid reward amount in rupees', 400));
    }

    const reward = await ReferralReward.findById(req.params.id)
      .populate('referrer', 'name email')
      .populate('referredUser', 'name email');

    if (!reward) {
      return next(new ApiError('Referral reward record not found', 404));
    }

    if (reward.referredUserRewardAmount > 0) {
      return next(new ApiError('Referred user has already received the reward for this deposit', 400));
    }

    const amountInPaise = Math.round(numAmount * 100);

    // Credit referred user's wallet
    const referredUser = await User.findById(reward.referredUser._id);
    if (!referredUser) {
      return next(new ApiError('Referred user not found', 404));
    }

    referredUser.walletBalance = (referredUser.walletBalance || 0) + amountInPaise;
    await referredUser.save();

    // Create ledger entry
    await WalletLedgerEntry.create({
      user: referredUser._id,
      amount: amountInPaise,
      type: 'credit',
      description: note?.trim() || `Welcome deposit reward via referral code from ${reward.referrer.name}`,
      referenceId: reward._id,
      referenceModel: 'Referral',
      balanceType: 'wallet'
    });

    reward.referredUserRewardAmount = amountInPaise;
    reward.referredUserNote = note?.trim() || 'Referred user bonus sent by Admin';
    reward.referredUserPaidAt = new Date();
    reward.reviewedBy = req.user._id;

    if (reward.referrerRewardAmount > 0) {
      reward.status = 'both_paid';
    }

    await reward.save();

    res.json({
      success: true,
      message: `Successfully sent referral bonus of ₹${numAmount} to referred user ${referredUser.name}`,
      data: reward
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin rejects referral reward
// @route   POST /api/admin/referrals/:id/reject
// @access  Private/Admin
const rejectReferralReward = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const reward = await ReferralReward.findById(req.params.id);
    if (!reward) {
      return next(new ApiError('Referral reward record not found', 404));
    }

    reward.status = 'rejected';
    reward.rejectedReason = reason?.trim() || 'Deposit did not qualify for referral reward';
    reward.reviewedBy = req.user._id;
    await reward.save();

    res.json({
      success: true,
      message: 'Referral reward rejected',
      data: reward
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  triggerReferralCheckOnDeposit,
  getAdminReferralRewards,
  sendReferrerReward,
  sendReferredUserReward,
  rejectReferralReward
};

