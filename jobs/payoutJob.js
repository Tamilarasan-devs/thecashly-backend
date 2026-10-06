const mongoose = require('mongoose');
const { PayoutSchedule, User } = require('../models');
const { recordLedgerEntry } = require('../services/ledger');

/**
 * Processes all eligible payout schedules that haven't been paid yet.
 * In a real app, this runs every day at 00:01 UTC.
 */
const processPayouts = async () => {
  console.log('[JOB] Starting payout processing...');
  const now = new Date();
  
  // Find all scheduled payouts where eligibilityDate is in the past
  const eligibleSchedules = await PayoutSchedule.find({
    status: 'scheduled',
    eligibilityDate: { $lte: now }
  }).populate('planSubscription');

  if (eligibleSchedules.length === 0) {
    console.log('[JOB] No eligible payouts to process.');
    return { success: true, processedCount: 0 };
  }

  let processedCount = 0;

  for (const schedule of eligibleSchedules) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Double check status inside transaction
        const schedToUpdate = await PayoutSchedule.findById(schedule._id).session(session);
        if (schedToUpdate.status !== 'scheduled') {
          return; // Already processed
        }

        // 1. Mark as eligible
        schedToUpdate.status = 'eligible';
        await schedToUpdate.save({ session });

        processedCount++;
      });
    } catch (err) {
      console.error(`[JOB Error] Failed to process schedule ${schedule._id}:`, err);
    } finally {
      session.endSession();
    }
  }

  console.log(`[JOB] Finished processing ${processedCount} payouts.`);
  return { success: true, processedCount };
};

module.exports = {
  processPayouts
};
