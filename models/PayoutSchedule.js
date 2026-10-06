const mongoose = require('mongoose');

const payoutScheduleSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  planSubscription: { type: mongoose.Schema.Types.ObjectId, ref: 'PlanSubscription', required: true },
  scheduledDate: { type: Date, required: true },
  amount: { type: Number, required: true }, // In paise
  status: { type: String, enum: ['scheduled', 'eligible', 'processing', 'paid', 'failed'], default: 'scheduled' },
  eligibilityDate: { type: Date, required: true }, // When this becomes eligible for withdrawal
  processedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('PayoutSchedule', payoutScheduleSchema);
