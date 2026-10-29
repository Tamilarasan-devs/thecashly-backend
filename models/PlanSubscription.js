const mongoose = require('mongoose');

const planSubscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true },
  
  // Snapshot of plan details to prevent silent changes
  planSnapshot: {
    name: String,
    initialPayment: Number,
    dailyAmount: Number,
    durationDays: Number,
    totalScheduled: Number,
    terms: String,
  },
  
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active' },
}, { timestamps: true });

planSubscriptionSchema.index({ user: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('PlanSubscription', planSubscriptionSchema);
