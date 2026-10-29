const mongoose = require('mongoose');

const topUpSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true }, // In paise
  status: { type: String, enum: ['pending', 'verified', 'failed'], default: 'pending' },
  gatewayReference: { type: String, unique: true, sparse: true },
  utr: { type: String, trim: true, sparse: true },
  screenshotUrl: { type: String },
  rejectionReason: { type: String },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  paymentMethod: { type: String, default: 'manual_upi' },
  verifiedAt: { type: Date },
}, { timestamps: true });

topUpSchema.index({ user: 1, createdAt: -1 });
topUpSchema.index({ status: 1, createdAt: -1 });
topUpSchema.index({ utr: 1 });

module.exports = mongoose.model('TopUp', topUpSchema);
