const mongoose = require('mongoose');

const referralRewardSchema = new mongoose.Schema({
  referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  referredUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  topUp: { type: mongoose.Schema.Types.ObjectId, ref: 'TopUp', required: true },
  depositAmount: { type: Number, required: true }, // in paise
  
  // Status of the referral reward process
  status: { 
    type: String, 
    enum: ['pending_admin', 'referrer_paid', 'both_paid', 'rejected'], 
    default: 'pending_admin' 
  },
  
  // Amounts manually sent by admin
  referrerRewardAmount: { type: Number, default: 0 }, // in paise
  referredUserRewardAmount: { type: Number, default: 0 }, // in paise
  
  // Admin notes/references
  referrerNote: { type: String },
  referredUserNote: { type: String },
  
  referrerPaidAt: { type: Date },
  referredUserPaidAt: { type: Date },
  
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectedReason: { type: String }
}, { timestamps: true });

referralRewardSchema.index({ referrer: 1, createdAt: -1 });
referralRewardSchema.index({ referredUser: 1, createdAt: -1 });
referralRewardSchema.index({ topUp: 1 }, { unique: true });
referralRewardSchema.index({ status: 1 });

module.exports = mongoose.model('ReferralReward', referralRewardSchema);

