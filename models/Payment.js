const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  amount: { type: Number, required: true }, // In paise
  status: { type: String, enum: ['pending', 'verified', 'failed'], default: 'pending' },
  gatewayReference: { type: String, unique: true, sparse: true }, // Unique reference from mock/real provider
  paymentMethod: { type: String },
  verifiedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
