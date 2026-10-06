const mongoose = require('mongoose');
const { Plan, PlanSubscription, PayoutSchedule } = require('../models');
const { ApiError } = require('../middleware/errorHandler');
const { purchasePlanFromWallet } = require('../services/payment');
const { recordLedgerEntry } = require('../services/ledger');

// @desc    Purchase a plan using wallet balance
// @route   POST /api/payments/purchase
// @access  Private
const purchasePlan = async (req, res, next) => {
  try {
    const { planId } = req.body;
    
    if (!planId) {
      return next(new ApiError('Plan ID is required', 400));
    }
    
    // Attempt purchase (will throw error if insufficient balance)
    const subscription = await purchasePlanFromWallet(req.user._id, planId);
    
    res.status(201).json({
      success: true,
      message: 'Plan purchased successfully',
      data: subscription
    });
  } catch (error) {
    next(new ApiError(error.message, 400));
  }
};

// @desc    Get user's subscriptions (My Products)
// @route   GET /api/payments/subscriptions
// @access  Private
const getSubscriptions = async (req, res, next) => {
  try {
    const subscriptions = await PlanSubscription.find({ user: req.user._id })
      .populate('plan', 'name productImage')
      .sort('-createdAt')
      .lean();
      
    // Fetch all payouts for this user
    const allPayouts = await PayoutSchedule.find({
      user: req.user._id
    }).lean();

    // Attach eligible, collected, and pending amounts to each subscription
    const subsWithAmounts = subscriptions.map(sub => {
      const subPayouts = allPayouts.filter(p => p.planSubscription.toString() === sub._id.toString());
      
      const eligiblePayouts = subPayouts.filter(p => p.status === 'eligible');
      const paidPayouts = subPayouts.filter(p => p.status === 'paid');
      const scheduledPayouts = subPayouts.filter(p => p.status === 'scheduled');

      const eligibleAmount = eligiblePayouts.reduce((sum, p) => sum + p.amount, 0);
      const collectedAmount = paidPayouts.reduce((sum, p) => sum + p.amount, 0);
      const pendingAmount = scheduledPayouts.reduce((sum, p) => sum + p.amount, 0);

      const collectedDays = paidPayouts.length;
      const totalDays = sub.planSnapshot.durationDays;
      
      // Find the next scheduled payout date
      scheduledPayouts.sort((a, b) => new Date(a.eligibilityDate) - new Date(b.eligibilityDate));
      const nextCollectionDate = scheduledPayouts.length > 0 ? scheduledPayouts[0].eligibilityDate : null;

      return { 
        ...sub, 
        eligibleAmount, 
        collectedAmount, 
        pendingAmount,
        collectedDays,
        totalDays,
        nextCollectionDate
      };
    });

    res.json({ success: true, data: subsWithAmounts });
  } catch (error) {
    next(error);
  }
};

// @desc    Collect daily earnings for a subscription
// @route   POST /api/payments/subscriptions/:id/collect
// @access  Private
const collectEarnings = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    let result = { success: false, amount: 0 };
    await session.withTransaction(async () => {
      const subId = req.params.id;
      
      const eligiblePayouts = await PayoutSchedule.find({
        user: req.user._id,
        planSubscription: subId,
        status: 'eligible'
      }).session(session);

      if (eligiblePayouts.length === 0) {
        throw new ApiError('No earnings to collect at this time', 400);
      }

      const totalAmount = eligiblePayouts.reduce((sum, p) => sum + p.amount, 0);

      // Update statuses to paid
      const payoutIds = eligiblePayouts.map(p => p._id);
      await PayoutSchedule.updateMany(
        { _id: { $in: payoutIds } },
        { $set: { status: 'paid', processedAt: new Date() } },
        { session }
      );

      const subscription = await PlanSubscription.findById(subId).session(session);
      
      // Credit wallet for each eligible payout schedule
      for (const payout of eligiblePayouts) {
        await recordLedgerEntry(
          req.user._id,
          payout.amount,
          'credit',
          `Collected daily earning for ${subscription.planSnapshot.name}`,
          payout._id,
          'PayoutSchedule',
          session,
          'earning'
        );
      }

      result = { success: true, amount: totalAmount };
    });

    res.json(result);
  } catch (error) {
    next(new ApiError(error.message, 400));
  } finally {
    session.endSession();
  }
};

module.exports = {
  purchasePlan,
  getSubscriptions,
  collectEarnings
};
