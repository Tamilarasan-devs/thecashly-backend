const mongoose = require('mongoose');
const { PlanSubscription, PayoutSchedule, Plan, User } = require('../models');
const { recordLedgerEntry } = require('./ledger');
const { getActiveTenant } = require('../config/tenantContext');
const { startTenantSession } = require('../config/dbManager');

/**
 * Purchases a plan using the user's wallet balance
 */
async function purchasePlanFromWallet(userId, planId) {
  const tenant = getActiveTenant();
  const session = await startTenantSession(tenant);
  let result;

  const executePurchase = async (activeSession) => {
    const userQuery = User.findById(userId);
    const planQuery = Plan.findById(planId);
    if (activeSession) {
      userQuery.session(activeSession);
      planQuery.session(activeSession);
    }
    const user = await userQuery;
    const plan = await planQuery;
    
    if (!user) throw new Error('User not found');
    if (!plan || plan.status !== 'active') throw new Error('Plan is not available');
    if (plan.isComingSoon || plan.planType === 'coming_soon') {
      throw new Error('This plan is coming soon and cannot be purchased yet.');
    }
    
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
    const subscription = new PlanSubscription({
      user: user._id,
      plan: plan._id,
      payment: new mongoose.Types.ObjectId(),
      planSnapshot: snapshot,
      startDate,
      endDate,
      status: 'active'
    });
    
    if (activeSession) {
      await subscription.save({ session: activeSession });
    } else {
      await subscription.save();
    }
    
    // 4. Debit the wallet securely
    await recordLedgerEntry(
      user._id,
      -plan.initialPayment,
      'debit',
      `Purchased Plan: ${plan.name}`,
      subscription._id,
      'PlanSubscription',
      activeSession
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
    
    if (activeSession) {
      await PayoutSchedule.insertMany(schedules, { session: activeSession });
    } else {
      await PayoutSchedule.insertMany(schedules);
    }
    
    result = subscription;
  };
  
  try {
    if (session) {
      try {
        await session.withTransaction(async () => {
          await executePurchase(session);
        });
      } catch (txnErr) {
        console.warn(`[PurchasePlan] Transaction error on ${tenant}, attempting safe direct update:`, txnErr.message);
        await executePurchase(null);
      }
    } else {
      await executePurchase(null);
    }
  } finally {
    if (session) {
      try {
        await session.endSession();
      } catch (e) {
        // Safe to ignore
      }
    }
  }
  
  return result;
}

module.exports = {
  purchasePlanFromWallet
};
