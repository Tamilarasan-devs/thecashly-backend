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
  },
  walletBalance: { type: Number, default: 0 }, // In paise
  earningBalance: { type: Number, default: 0 }, // In paise
  demoBalance: { type: Number, default: 10000 }, // In demo points for games
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
