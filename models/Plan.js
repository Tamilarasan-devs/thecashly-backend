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
  status: { type: String, enum: ['active', 'archived', 'draft'], default: 'draft' },
  displayOrder: { type: Number, default: 0 },
  productImage: {
    url: String,
    publicId: String
  }
}, { timestamps: true });

module.exports = mongoose.model('Plan', planSchema);
