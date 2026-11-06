const { User, WalletLedgerEntry, TopUp, Withdrawal } = require('../models');
const { logAuditEvent } = require('./auditLogger');

/**
 * Reconciles an individual user's wallet and earning balances against their immutable ledger entries.
 */
async function reconcileUser(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Aggregate ledger entries by balanceType and type (credit/debit)
  const ledgerTotals = await WalletLedgerEntry.aggregate([
    { $match: { user: user._id } },
    {
      $group: {
        _id: { balanceType: '$balanceType', type: '$type' },
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    }
  ]);

  let expectedWalletBalance = 0;
  let expectedEarningBalance = 0;

  for (const item of ledgerTotals) {
    const { balanceType } = item._id;
    if (balanceType === 'earning') {
      expectedEarningBalance += item.totalAmount;
    } else {
      expectedWalletBalance += item.totalAmount;
    }
  }

  const actualWalletBalance = user.walletBalance || 0;
  const actualEarningBalance = user.earningBalance || 0;

  const walletDiscrepancy = actualWalletBalance - expectedWalletBalance;
  const earningDiscrepancy = actualEarningBalance - expectedEarningBalance;

  // Reconcile top-ups
  const verifiedTopUps = await TopUp.find({ user: user._id, status: 'verified' }).select('_id amount utr gatewayReference');
  const topUpLedgerEntries = await WalletLedgerEntry.find({
    user: user._id,
    referenceModel: 'TopUp'
  }).select('referenceId amount');

  const topUpLedgerIds = new Set(topUpLedgerEntries.map(e => e.referenceId?.toString()));
  const missingTopUpCredits = verifiedTopUps.filter(t => !topUpLedgerIds.has(t._id.toString()));

  // Reconcile withdrawals
  const paidWithdrawals = await Withdrawal.find({ user: user._id, status: { $in: ['paid', 'requested', 'processing'] } }).select('_id amount status');
  const withdrawalLedgerEntries = await WalletLedgerEntry.find({
    user: user._id,
    referenceModel: 'Withdrawal'
  }).select('referenceId amount type');

  const isBalanced = walletDiscrepancy === 0 && earningDiscrepancy === 0 && missingTopUpCredits.length === 0;

  return {
    userId: user._id,
    name: user.name,
    phone: user.phone,
    balances: {
      wallet: {
        actual: actualWalletBalance,
        expected: expectedWalletBalance,
        discrepancy: walletDiscrepancy,
        isCorrect: walletDiscrepancy === 0
      },
      earning: {
        actual: actualEarningBalance,
        expected: expectedEarningBalance,
        discrepancy: earningDiscrepancy,
        isCorrect: earningDiscrepancy === 0
      }
    },
    topUps: {
      verifiedCount: verifiedTopUps.length,
      ledgerCount: topUpLedgerEntries.length,
      missingFromLedger: missingTopUpCredits
    },
    withdrawals: {
      totalCount: paidWithdrawals.length,
      ledgerCount: withdrawalLedgerEntries.length
    },
    isBalanced
  };
}

/**
 * Platform-wide financial reconciliation summary.
 */
async function getReconciliationSummary() {
  const [depositStats, withdrawalStats, ledgerStats] = await Promise.all([
    TopUp.aggregate([
      { $match: { status: 'verified' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    Withdrawal.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    WalletLedgerEntry.aggregate([
      {
        $group: {
          _id: '$type',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ])
  ]);

  const totalVerifiedDeposits = depositStats[0]?.total || 0;
  const totalPaidWithdrawals = withdrawalStats[0]?.total || 0;

  return {
    platformTotals: {
      totalVerifiedDeposits,
      totalPaidWithdrawals,
      ledgerBreakdown: ledgerStats
    },
    generatedAt: new Date()
  };
}

/**
 * Re-aligns a drifted balance back to the immutable ledger sum.
 */
async function realignUserBalance(userId, adminId, reason = 'Administrative ledger reconciliation') {
  const audit = await reconcileUser(userId);
  if (audit.isBalanced) {
    return { success: true, message: 'User balance is already balanced with ledger.', audit };
  }

  const user = await User.findById(userId);
  const oldBalances = { walletBalance: user.walletBalance, earningBalance: user.earningBalance };

  user.walletBalance = audit.balances.wallet.expected;
  user.earningBalance = audit.balances.earning.expected;
  await user.save();

  await logAuditEvent({
    adminUser: adminId,
    action: 'BALANCE_RECONCILED',
    targetModel: 'User',
    targetId: user._id,
    changes: {
      walletBalance: { old: oldBalances.walletBalance, new: user.walletBalance },
      earningBalance: { old: oldBalances.earningBalance, new: user.earningBalance }
    },
    reason
  });

  return {
    success: true,
    message: 'User balance successfully realigned with ledger.',
    previousBalances: oldBalances,
    updatedBalances: { walletBalance: user.walletBalance, earningBalance: user.earningBalance }
  };
}

module.exports = {
  reconcileUser,
  getReconciliationSummary,
  realignUserBalance
};

