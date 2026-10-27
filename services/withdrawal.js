const mongoose = require('mongoose');
const { Withdrawal, User } = require('../models');
const { recordLedgerEntry } = require('./ledger');

function validateBankDetails(bankDetails) {
  const { accountHolderName, bankName, accountNumber, ifscCode, branchName, upiId } = bankDetails || {};
  if (!accountHolderName || !accountHolderName.trim()) {
    throw new Error('Account holder name is required');
  }
  if (!bankName || !bankName.trim()) {
    throw new Error('Bank name is required');
  }
  if (!accountNumber || !accountNumber.toString().trim()) {
    throw new Error('Bank account number is required');
  }
  const cleanAcc = accountNumber.toString().trim();
  if (!/^\d{8,20}$/.test(cleanAcc)) {
    throw new Error('Please enter a valid bank account number (8 to 20 digits)');
  }
  if (!ifscCode || !ifscCode.trim()) {
    throw new Error('IFSC code is required');
  }
  const cleanIfsc = ifscCode.trim().toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc)) {
    throw new Error('Please enter a valid 11-character IFSC code (e.g. SBIN0001234)');
  }
  if (!branchName || !branchName.trim()) {
    throw new Error('Branch name is required');
  }

  return {
    accountHolderName: accountHolderName.trim(),
    bankName: bankName.trim(),
    accountNumber: cleanAcc,
    ifscCode: cleanIfsc,
    branchName: branchName.trim(),
    upiId: upiId ? upiId.trim() : '',
    updatedAt: new Date()
  };
}

async function saveUserBankDetails(userId, bankDetails) {
  const validated = validateBankDetails(bankDetails);
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  user.payoutDetails = validated;
  await user.save();
  return user.payoutDetails;
}

async function requestWithdrawal(userId, amount, bankDetails = null) {
  if (!amount || isNaN(amount) || amount <= 0) {
    throw new Error('Please enter a valid withdrawal amount');
  }

  if (amount < 10000) {
    throw new Error('Minimum withdrawal amount is ₹100');
  }

  const session = await mongoose.startSession();
  let withdrawal;

  try {
    await session.withTransaction(async () => {
      const user = await User.findById(userId).session(session);
      if (!user) throw new Error('User not found');

      // If bank details were provided with the request, validate and persist them
      if (bankDetails) {
        const validated = validateBankDetails(bankDetails);
        user.payoutDetails = validated;
        await user.save({ session });
      }

      // Check if user has complete payout details
      const payout = user.payoutDetails;
      if (
        !payout ||
        !payout.accountNumber ||
        !payout.accountHolderName ||
        !payout.bankName ||
        !payout.ifscCode ||
        !payout.branchName
      ) {
        throw new Error('Please provide complete bank details (Account Holder Name, Bank Name, Account Number, IFSC Code, and Branch Name) before requesting a withdrawal.');
      }

      if ((user.earningBalance || 0) < amount) {
        throw new Error('Insufficient earning balance for withdrawal');
      }

      // Snapshot the payout details
      withdrawal = new Withdrawal({
        user: userId,
        amount,
        status: 'requested',
        payoutDetailsSnapshot: {
          accountHolderName: payout.accountHolderName,
          bankName: payout.bankName,
          accountNumber: payout.accountNumber,
          ifscCode: payout.ifscCode,
          branchName: payout.branchName,
          upiId: payout.upiId || ''
        }
      });
      await withdrawal.save({ session });

      // Debit the user's earning wallet
      await recordLedgerEntry(
        userId,
        -amount,
        'withdrawal_request',
        `Withdrawal request for ₹${(amount / 100).toFixed(2)} to ${payout.bankName} (A/C: ${payout.accountNumber})`,
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

async function approveWithdrawal(withdrawalId, adminId, paymentReference = '') {
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
      withdrawal.paymentReference = paymentReference || '';
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
        new mongoose.Types.ObjectId(),
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
  saveUserBankDetails,
  approveWithdrawal,
  rejectWithdrawal
};
