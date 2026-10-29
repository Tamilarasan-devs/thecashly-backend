const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  suspendReason: { type: String },
  payoutDetails: {
    bankName: String,
    accountNumber: String,
    ifscCode: String,
    accountHolderName: String,
    branchName: String,
    upiId: String,
    updatedAt: Date,
  },
  walletBalance: { type: Number, default: 0 }, // In paise
  earningBalance: { type: Number, default: 0 }, // In paise
  demoBalance: { type: Number, default: 10000 }, // In demo points for games
  referralCode: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  referralEarnings: { type: Number, default: 0 }, // In paise
}, { timestamps: true });

userSchema.index({ referredBy: 1 });
userSchema.index({ role: 1, createdAt: -1 });

userSchema.pre('save', async function() {
  if (!this.referralCode) {
    const { generateUniqueReferralCode } = require('../utils/referral');
    this.referralCode = await generateUniqueReferralCode(this.constructor);
  }
});

module.exports = mongoose.model('User', userSchema);
