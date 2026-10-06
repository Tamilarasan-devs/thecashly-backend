const mongoose = require('mongoose');
const { PlanSubscription, PayoutSchedule, Plan, User } = require('../models');
const { recordLedgerEntry } = require('./ledger');

/**
 * Purchases a plan using the user's wallet balance
 */
async function purchasePlanFromWallet(userId, planId) {
  const session = await mongoose.startSession();
  let result;
  
  try {
    await session.withTransaction(async () => {
      const user = await User.findById(userId).session(session);
      const plan = await Plan.findById(planId).session(session);
      
      if (!user) throw new Error('User not found');
      if (!plan || plan.status !== 'active') throw new Error('Plan is not available');
      
      if (user.walletBalance < plan.initialPayment) {
        const shortage = plan.initialPayment - user.walletBalance;
        throw new Error(`Insufficient wallet balance. You need ₹${(shortage / 100).toFixed(2)} more.`);
      }

      // 1. Snapshot the plan
      const snapshot = {
        name: plan.name,
        initialPayment: plan.initialPayment,
        dailyAmount: plan.dailyAmount,
        durationDays: plan.durationDays,
        totalScheduled: plan.totalScheduled,
        terms: plan.terms
      };
      
      // 2. Consistent timezone policy (UTC midnight)
      const startDate = new Date();
      startDate.setUTCHours(0, 0, 0, 0); 
      startDate.setUTCDate(startDate.getUTCDate() + 1); 
      
      const endDate = new Date(startDate);
      endDate.setUTCDate(endDate.getUTCDate() + plan.durationDays - 1);
      
      // 3. Create Subscription
      // Using dummy payment id reference since we deprecated the Payment model for wallet purchases
      const subscription = new PlanSubscription({
        user: user._id,
        plan: plan._id,
        payment: new mongoose.Types.ObjectId(), // Fake payment ID placeholder or we can remove required
        planSnapshot: snapshot,
        startDate,
        endDate,
        status: 'active'
      });
      await subscription.save({ session });
      
      // 4. Debit the wallet securely
      await recordLedgerEntry(
        user._id,
        -plan.initialPayment,
        'debit',
        `Purchased Plan: ${plan.name}`,
        subscription._id,
        'PlanSubscription',
        session
      );
      
      // 5. Create payout schedules
      const schedules = [];
      for (let i = 0; i < plan.durationDays; i++) {
        const schedDate = new Date(startDate);
        schedDate.setUTCDate(schedDate.getUTCDate() + i);
        
        const eligDate = new Date(schedDate);
        eligDate.setUTCDate(eligDate.getUTCDate() + 1);
        
        schedules.push({
          user: user._id,
          planSubscription: subscription._id,
          scheduledDate: schedDate,
          amount: plan.dailyAmount,
          status: 'scheduled',
          eligibilityDate: eligDate
        });
      }
      
      await PayoutSchedule.insertMany(schedules, { session });
      
      result = subscription;
    });
  } finally {
    session.endSession();
  }
  
  return result;
}

module.exports = {
  purchasePlanFromWallet
};
