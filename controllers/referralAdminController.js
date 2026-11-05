const { ReferralReward, User, TopUp, WalletLedgerEntry, ReferralSetting, Notification } = require('../models');
const { ApiError } = require('../middleware/errorHandler');
const { recordLedgerEntry } = require('../services/ledger');
const { invalidateAuthCache } = require('../middleware/auth');

/**
 * Checks if the deposited user was referred by someone.
 * Eligibility Rule:
 * The referrer MUST have made at least one approved deposit ('verified' top-up) themselves.
 * If the referrer has never deposited, they are NOT eligible for referral earnings.
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

    // Check if Referrer is eligible (must have deposited at least once with 'verified' status)
    const referrerDepositCount = await TopUp.countDocuments({
      user: referrer._id,
      status: 'verified'
    });
    const isReferrerEligible = referrerDepositCount > 0;

    // Check if a referral reward already exists for this topUp
    let reward = await ReferralReward.findOne({ topUp: topUpDoc._id });
    if (!reward) {
      reward = await ReferralReward.create({
        referrer: referrer._id,
        referredUser: depositedUser._id,
        topUp: topUpDoc._id,
        depositAmount: topUpDoc.amount,
        status: 'pending_admin',
        referrerEligible: isReferrerEligible,
        referrerIneligibleReason: isReferrerEligible ? '' : 'Referrer has not made any deposit yet. Deposit required to qualify.'
      });
      console.log(`[Referral] Created referral reward review. Referrer: ${referrer.name} (Eligible: ${isReferrerEligible ? 'YES' : 'NO - No deposit made'})`);
    } else {
      // Update eligibility in case referrer deposited later
      if (!reward.referrerEligible && isReferrerEligible) {
        reward.referrerEligible = true;
        reward.referrerIneligibleReason = '';
        await reward.save();
      }
    }

    return reward;
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

    // Check live deposit status for each referrer so the admin list always shows real-time eligibility
    const enrichedRewards = await Promise.all(rewards.map(async (r) => {
      if (!r.referrer?._id) return r;
      const count = await TopUp.countDocuments({
        user: r.referrer._id,
        status: 'verified'
      });
      const hasDeposited = count > 0;
      return {
        ...r,
        referrerEligible: hasDeposited,
        referrerIneligibleReason: hasDeposited ? '' : 'Referrer has not deposited yet. Deposit required to qualify.'
      };
    }));

    res.json({
      success: true,
      data: enrichedRewards
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
      .populate('referredUser', 'name email')
      .populate('topUp', 'amount');

    if (!reward) {
      return next(new ApiError('Referral reward record not found', 404));
    }

    if (reward.referrerRewardAmount > 0) {
      return next(new ApiError('Referrer has already been credited for this referral deposit', 400));
    }

    // Check if referrer has made at least one approved deposit
    const referrerDepositCount = await TopUp.countDocuments({
      user: reward.referrer._id,
      status: 'verified'
    });

    if (referrerDepositCount === 0) {
      return next(new ApiError(`Cannot credit referral reward: Referrer (${reward.referrer?.name}) has not made any deposit yet. Users must deposit before becoming eligible for referral earnings.`, 400));
    }

    const amountInPaise = Math.round(numAmount * 100);

    // Credit referrer's wallet safely using recordLedgerEntry
    await recordLedgerEntry(
      reward.referrer._id,
      amountInPaise,
      'credit',
      note?.trim() || `Referral bonus for referral ${reward.referredUser.name}'s deposit`,
      reward._id,
      'Referral'
    );

    // Update referralEarnings on user doc
    const referrer = await User.findById(reward.referrer._id);
    if (referrer) {
      referrer.referralEarnings = (referrer.referralEarnings || 0) + amountInPaise;
      await referrer.save();
      invalidateAuthCache(referrer._id);
    }

    reward.referrerRewardAmount = amountInPaise;
    reward.referrerNote = note?.trim() || 'Referral reward approved & sent by Admin';
    reward.referrerPaidAt = new Date();
    reward.reviewedBy = req.user._id;

    if (reward.referredUserRewardAmount > 0) {
      reward.status = 'both_paid';
    } else {
      reward.status = 'referrer_paid';
    }

    await reward.save();

    // Create user notification for Referrer
    try {
      await Notification.create({
        user: reward.referrer._id,
        title: 'Referral Bonus Credited! 🎉',
        message: `You referred ${reward.referredUser?.name || 'a friend'} successfully! Admin approved and credited ₹${numAmount} referral reward to your wallet.`,
        type: 'referral_approved',
        amount: amountInPaise,
        metadata: {
          rewardId: reward._id,
          friendName: reward.referredUser?.name
        }
      });
    } catch (notifErr) {
      console.error('[Notification] Failed to create referrer notification:', notifErr.message);
    }

    res.json({
      success: true,
      message: `Successfully approved & credited referral reward of ₹${numAmount} to referrer ${reward.referrer?.name}`,
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
      .populate('referredUser', 'name email')
      .populate('topUp', 'amount');

    if (!reward) {
      return next(new ApiError('Referral reward record not found', 404));
    }

    if (reward.referredUserRewardAmount > 0) {
      return next(new ApiError('Referred user has already received the reward for this deposit', 400));
    }

    const amountInPaise = Math.round(numAmount * 100);

    // Credit referred user's wallet safely using recordLedgerEntry
    await recordLedgerEntry(
      reward.referredUser._id,
      amountInPaise,
      'credit',
      note?.trim() || `Welcome deposit reward via referral code from ${reward.referrer.name}`,
      reward._id,
      'Referral'
    );

    invalidateAuthCache(reward.referredUser._id);

    reward.referredUserRewardAmount = amountInPaise;
    reward.referredUserNote = note?.trim() || 'Referred user bonus approved & sent by Admin';
    reward.referredUserPaidAt = new Date();
    reward.reviewedBy = req.user._id;

    if (reward.referrerRewardAmount > 0) {
      reward.status = 'both_paid';
    }

    await reward.save();

    // Create user notification for Referred User
    try {
      await Notification.create({
        user: reward.referredUser._id,
        title: 'Welcome Referral Bonus Received! 🎁',
        message: `Welcome bonus of ₹${numAmount} credited to your wallet via invite from ${reward.referrer?.name || 'your friend'}. Start earning today!`,
        type: 'bonus',
        amount: amountInPaise,
        metadata: {
          rewardId: reward._id,
          referrerName: reward.referrer?.name
        }
      });
    } catch (notifErr) {
      console.error('[Notification] Failed to create referee notification:', notifErr.message);
    }

    res.json({
      success: true,
      message: `Successfully approved & credited referral bonus of ₹${numAmount} to referred user ${reward.referredUser?.name}`,
      data: reward
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin approves both referrer and referee bonus in one click
// @route   POST /api/admin/referrals/:id/approve-both
// @access  Private/Admin
const approveBothReferralRewards = async (req, res, next) => {
  try {
    const { referrerAmount, refereeAmount, note } = req.body;

    const reward = await ReferralReward.findById(req.params.id)
      .populate('referrer', 'name email')
      .populate('referredUser', 'name email');

    if (!reward) {
      return next(new ApiError('Referral reward record not found', 404));
    }

    // Default to configured settings if not explicitly passed
    const setting = await ReferralSetting.findOne().sort('-updatedAt');
    const finalReferrerRupees = referrerAmount !== undefined && referrerAmount !== ''
      ? Number(referrerAmount)
      : (setting?.referrerBonusRupees ?? 100);
    const finalRefereeRupees = refereeAmount !== undefined && refereeAmount !== ''
      ? Number(refereeAmount)
      : (setting?.refereeBonusRupees ?? 100);

    const referrerPaise = Math.round(finalReferrerRupees * 100);
    const refereePaise = Math.round(finalRefereeRupees * 100);

    // Check if Referrer has made a verified deposit
    const referrerDepositCount = await TopUp.countDocuments({
      user: reward.referrer._id,
      status: 'verified'
    });

    if (referrerDepositCount === 0) {
      return next(new ApiError(`Referrer (${reward.referrer?.name}) has not made any deposit yet. They must deposit first to be eligible for referral earnings.`, 400));
    }

    // 1. Credit Referrer if not yet paid
    if (referrerPaise > 0 && reward.referrerRewardAmount === 0) {
      await recordLedgerEntry(
        reward.referrer._id,
        referrerPaise,
        'credit',
        note?.trim() || `Referral bonus for referral ${reward.referredUser.name}'s deposit`,
        reward._id,
        'Referral'
      );
      const referrer = await User.findById(reward.referrer._id);
      if (referrer) {
        referrer.referralEarnings = (referrer.referralEarnings || 0) + referrerPaise;
        await referrer.save();
        invalidateAuthCache(referrer._id);
      }
      reward.referrerRewardAmount = referrerPaise;
      reward.referrerNote = note?.trim() || `Approved ₹${finalReferrerRupees} by Admin`;
      reward.referrerPaidAt = new Date();
    }

    // 2. Credit Referee if not yet paid
    if (refereePaise > 0 && reward.referredUserRewardAmount === 0) {
      await recordLedgerEntry(
        reward.referredUser._id,
        refereePaise,
        'credit',
        note?.trim() || `Welcome deposit reward via referral code from ${reward.referrer.name}`,
        reward._id,
        'Referral'
      );
      invalidateAuthCache(reward.referredUser._id);
      reward.referredUserRewardAmount = refereePaise;
      reward.referredUserNote = note?.trim() || `Approved ₹${finalRefereeRupees} welcome bonus by Admin`;
      reward.referredUserPaidAt = new Date();
    }

    reward.status = 'both_paid';
    reward.reviewedBy = req.user._id;
    await reward.save();

    // Create notifications for both
    try {
      if (referrerPaise > 0) {
        await Notification.create({
          user: reward.referrer._id,
          title: 'Referral Bonus Credited! 🎉',
          message: `You referred ${reward.referredUser?.name || 'a friend'} successfully! Admin approved and credited ₹${finalReferrerRupees} referral reward to your wallet.`,
          type: 'referral_approved',
          amount: referrerPaise,
          metadata: { rewardId: reward._id, friendName: reward.referredUser?.name }
        });
      }
      if (refereePaise > 0) {
        await Notification.create({
          user: reward.referredUser._id,
          title: 'Welcome Referral Bonus Received! 🎁',
          message: `Welcome bonus of ₹${finalRefereeRupees} credited to your wallet via invite from ${reward.referrer?.name || 'your friend'}. Start earning today!`,
          type: 'bonus',
          amount: refereePaise,
          metadata: { rewardId: reward._id, referrerName: reward.referrer?.name }
        });
      }
    } catch (notifErr) {
      console.error('[Notification] Failed to create dual notifications:', notifErr.message);
    }

    res.json({
      success: true,
      message: `Successfully approved both referral bonuses (₹${finalReferrerRupees} to ${reward.referrer?.name}, ₹${finalRefereeRupees} to ${reward.referredUser?.name})`,
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
  approveBothReferralRewards,
  rejectReferralReward
};

