const mongoose = require('mongoose');
const { User, WalletLedgerEntry } = require('../models');
const { getConnection } = require('../config/dbManager');
const { getActiveTenant } = require('../config/tenantContext');
const { invalidateAuthCache } = require('../middleware/auth');

/**
 * Creates a ledger entry and updates user balance transactionally.
 */
async function recordLedgerEntry(userId, amount, type, description, referenceId, referenceModel, session = null, balanceType = 'wallet') {
  const execute = async (dbSession) => {
    // Lock the user document for update
    const query = User.findById(userId);
    if (dbSession) {
      query.session(dbSession);
    }
    const user = await query;
    if (!user) {
      throw new Error('User not found');
    }

    // Amount can be negative for debits (withdrawals)
    let newBalance;
    if (balanceType === 'earning') {
      newBalance = (user.earningBalance || 0) + amount;
      if (newBalance < 0) {
        throw new Error('Insufficient earning balance');
      }
    } else {
      newBalance = (user.walletBalance || 0) + amount;
      if (newBalance < 0) {
        throw new Error('Insufficient wallet balance');
      }
    }

    const entry = new WalletLedgerEntry({
      user: userId,
      amount,
      type,
      description,
      referenceId,
      referenceModel,
      balanceType
    });

    if (dbSession) {
      await entry.save({ session: dbSession });
    } else {
      await entry.save();
    }

    if (balanceType === 'earning') {
      user.earningBalance = newBalance;
    } else {
      user.walletBalance = newBalance;
    }

    if (dbSession) {
      await user.save({ session: dbSession });
    } else {
      await user.save();
    }

    // Invalidate cached auth user so subsequent /auth/me or API calls get the fresh wallet balance immediately
    invalidateAuthCache(userId);

    return { user, entry };
  };

  // If a session was passed, use it directly
  if (session) {
    return await execute(session);
  }

  // Obtain the connection corresponding to the current tenant
  const tenant = getActiveTenant();
  const conn = getConnection(tenant) || mongoose.connection;

  let newSession = null;
  try {
    newSession = await conn.startSession();
    let result;
    await newSession.withTransaction(async () => {
      result = await execute(newSession);
    });
    return result;
  } catch (err) {
    // If transactions are not supported or session fails (e.g. standalone Mongo, replica set mismatch), execute directly
    console.warn(`[Ledger] Transaction session fallback for tenant ${tenant}:`, err.message);
    return await execute(null);
  } finally {
    if (newSession) {
      try {
        await newSession.endSession();
      } catch (e) {
        // Ignore endSession error
      }
    }
  }
}

module.exports = {
  recordLedgerEntry
};
