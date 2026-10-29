const mongoose = require('mongoose');

const walletLedgerEntrySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true }, // Positive for credit, negative for debit (in paise)
  type: { type: String, enum: ['credit', 'debit', 'withdrawal_request', 'withdrawal_refund'], required: true },
  description: { type: String },
  referenceId: { type: mongoose.Schema.Types.ObjectId },
  referenceModel: { type: String, enum: ['PayoutSchedule', 'Withdrawal', 'TopUp', 'PlanSubscription', 'User', 'Referral'] },
  balanceType: { type: String, enum: ['wallet', 'earning'], default: 'wallet' }
}, { timestamps: true });

walletLedgerEntrySchema.index({ referenceId: 1, referenceModel: 1, type: 1 }, { unique: true, sparse: true });
walletLedgerEntrySchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('WalletLedgerEntry', walletLedgerEntrySchema);
