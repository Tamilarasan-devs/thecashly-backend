const mongoose = require('mongoose');
const { User, WalletLedgerEntry } = require('../models');

/**
 * Creates a ledger entry and updates user balance transactionally.
 */
async function recordLedgerEntry(userId, amount, type, description, referenceId, referenceModel, session = null, balanceType = 'wallet') {
  const execute = async (dbSession) => {
    // Lock the user document for update
    const user = await User.findById(userId).session(dbSession);
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

    await entry.save({ session: dbSession });

    if (balanceType === 'earning') {
      user.earningBalance = newBalance;
    } else {
      user.walletBalance = newBalance;
    }
    await user.save({ session: dbSession });

    return { user, entry };
  };

  // If a session was passed, use it, else create a new transaction
  if (session) {
    return await execute(session);
  } else {
    const newSession = await mongoose.startSession();
    let result;
    await newSession.withTransaction(async () => {
      result = await execute(newSession);
    });
    newSession.endSession();
    return result;
  }
}

module.exports = {
  recordLedgerEntry
};
