const { PayoutSchedule, User } = require('../models');
const { recordLedgerEntry } = require('../services/ledger');
const { getActiveTenant } = require('../config/tenantContext');
const { startTenantSession } = require('../config/dbManager');

/**
 * Processes all eligible payout schedules that haven't been paid yet.
 * In a real app, this runs every day at 00:01 UTC.
 */
const processPayouts = async () => {
  const tenant = getActiveTenant();
  console.log(`[JOB:${tenant}] Starting payout processing...`);
  const now = new Date();
  
  // Find all scheduled payouts where eligibilityDate is in the past
  const eligibleSchedules = await PayoutSchedule.find({
    status: 'scheduled',
    eligibilityDate: { $lte: now }
  }).populate('planSubscription');

  if (eligibleSchedules.length === 0) {
    console.log(`[JOB:${tenant}] No eligible payouts to process.`);
    return { success: true, processedCount: 0 };
  }

  let processedCount = 0;

  for (const schedule of eligibleSchedules) {
    const session = await startTenantSession(tenant);

    const executeSched = async (activeSession) => {
      const q = PayoutSchedule.findById(schedule._id);
      if (activeSession) q.session(activeSession);
      const schedToUpdate = await q;
      if (!schedToUpdate || schedToUpdate.status !== 'scheduled') {
        return;
      }
      schedToUpdate.status = 'eligible';
      if (activeSession) {
        await schedToUpdate.save({ session: activeSession });
      } else {
        await schedToUpdate.save();
      }
      processedCount++;
    };

    try {
      if (session) {
        try {
          await session.withTransaction(async () => {
            await executeSched(session);
          });
        } catch (txnErr) {
          await executeSched(null);
        }
      } else {
        await executeSched(null);
      }
    } catch (err) {
      console.error(`[JOB Error:${tenant}] Failed to process schedule ${schedule._id}:`, err);
    } finally {
      if (session) {
        try {
          await session.endSession();
        } catch (e) {
          // Safe to ignore
        }
      }
    }
  }

  console.log(`[JOB:${tenant}] Finished processing ${processedCount} payouts.`);
  return { success: true, processedCount };
};

module.exports = {
  processPayouts
};
