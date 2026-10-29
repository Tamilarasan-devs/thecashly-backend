const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  initialPayment: { type: Number, required: true }, // In paise
  dailyAmount: { type: Number, required: true }, // In paise
  durationDays: { type: Number, required: true },
  totalScheduled: { type: Number, required: true }, // dailyAmount * durationDays
  eligibilityRules: { type: String },
  terms: { type: String },
  status: { type: String, enum: ['active', 'archived', 'draft', 'hidden'], default: 'draft' },
  planType: { type: String, enum: ['regular', 'special', 'coming_soon'], default: 'regular' },
  isSpecial: { type: Boolean, default: false },
  isComingSoon: { type: Boolean, default: false },
  badgeText: { type: String, trim: true, default: '' },
  displayOrder: { type: Number, default: 0 },
  productImage: {
    url: String,
    publicId: String
  }
}, { timestamps: true });

planSchema.index({ status: 1, displayOrder: 1, createdAt: -1 });

// Ensure isSpecial, isComingSoon, and planType stay in sync
planSchema.pre('save', function () {
  if (this.planType === 'special') {
    this.isSpecial = true;
    this.isComingSoon = false;
    if (!this.badgeText) this.badgeText = 'Special Plan';
  } else if (this.planType === 'coming_soon') {
    this.isComingSoon = true;
    this.isSpecial = false;
    if (!this.badgeText) this.badgeText = 'Coming Soon';
  } else {
    this.isSpecial = false;
    this.isComingSoon = false;
  }
});

module.exports = mongoose.model('Plan', planSchema);
