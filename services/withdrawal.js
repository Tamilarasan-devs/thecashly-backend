const mongoose = require('mongoose');
const { Withdrawal, User } = require('../models');
const { recordLedgerEntry } = require('./ledger');

async function requestWithdrawal(userId, amount) {
  const session = await mongoose.startSession();
  let withdrawal;

  try {
    await session.withTransaction(async () => {
      const user = await User.findById(userId).session(session);
      if (!user) throw new Error('User not found');

      if (!user.payoutDetails || !user.payoutDetails.accountNumber) {
        throw new Error('Payout details not configured');
      }

      if ((user.earningBalance || 0) < amount) {
        throw new Error('Insufficient earning balance for withdrawal');
      }

      // Snapshot the payout details
      withdrawal = new Withdrawal({
        user: userId,
        amount,
        status: 'requested',
        payoutDetailsSnapshot: { ...user.payoutDetails.toObject() }
      });
      await withdrawal.save({ session });

      // Debit the user's wallet
      await recordLedgerEntry(
        userId,
        -amount,
        'withdrawal_request',
        `Withdrawal request for ${amount / 100} INR`,
        withdrawal._id,
        'Withdrawal',
        session,
        'earning'
      );
    });
  } finally {
    session.endSession();
  }

  return withdrawal;
}

async function approveWithdrawal(withdrawalId, adminId, paymentReference) {
  const session = await mongoose.startSession();
  let withdrawal;

  try {
    await session.withTransaction(async () => {
      withdrawal = await Withdrawal.findById(withdrawalId).session(session);
      if (!withdrawal) throw new Error('Withdrawal not found');
      if (withdrawal.status !== 'requested' && withdrawal.status !== 'processing') {
        throw new Error('Withdrawal is not in a valid state for approval');
      }

      withdrawal.status = 'paid';
      withdrawal.paymentReference = paymentReference;
      withdrawal.processedAt = new Date();
      // Audit log should ideally be inserted here too
      
      await withdrawal.save({ session });
    });
  } finally {
    session.endSession();
  }

  return withdrawal;
}

async function rejectWithdrawal(withdrawalId, adminId, reason) {
  const session = await mongoose.startSession();
  let withdrawal;

  try {
    await session.withTransaction(async () => {
      withdrawal = await Withdrawal.findById(withdrawalId).session(session);
      if (!withdrawal) throw new Error('Withdrawal not found');
      if (withdrawal.status !== 'requested') {
        throw new Error('Withdrawal already processed');
      }

      withdrawal.status = 'rejected';
      withdrawal.adminReason = reason;
      withdrawal.processedAt = new Date();
      await withdrawal.save({ session });

      // Refund the wallet
      await recordLedgerEntry(
        withdrawal.user,
        withdrawal.amount, // Credit back
        'withdrawal_refund',
        `Refund for rejected withdrawal: ${reason}`,
        withdrawal._id,
        'Withdrawal',
        session,
        'earning'
      );
    });
  } finally {
    session.endSession();
  }

  return withdrawal;
}

module.exports = {
  requestWithdrawal,
  approveWithdrawal,
  rejectWithdrawal
};
