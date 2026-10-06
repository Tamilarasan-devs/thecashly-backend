const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true }, // In paise
  status: { type: String, enum: ['requested', 'processing', 'paid', 'rejected', 'failed'], default: 'requested' },
  payoutDetailsSnapshot: {
    bankName: String,
    accountNumber: String,
    ifscCode: String,
    accountHolderName: String,
  },
  adminReason: { type: String }, // If rejected or manually processed
  paymentReference: { type: String }, // From the payout gateway
  processedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
