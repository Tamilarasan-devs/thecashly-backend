const mongoose = require('mongoose');

const referralSettingSchema = new mongoose.Schema({
  // Amount in rupees or paise (we will store in rupees for simple admin UI + paise for wallet ledger)
  referrerBonusRupees: {
    type: Number,
    required: true,
    default: 100
  },
  refereeBonusRupees: {
    type: Number,
    required: true,
    default: 100
  },
  description: {
    type: String,
    default: 'Invite friends with your referral link or code to earn cash bonuses!'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

module.exports = mongoose.model('ReferralSetting', referralSettingSchema);
