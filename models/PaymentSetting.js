const mongoose = require('mongoose');

const paymentChannelSchema = new mongoose.Schema({
  title: {
    type: String,
    trim: true,
    default: 'UPI QR'
  },
  upiId: {
    type: String,
    required: true,
    trim: true
  },
  upiName: {
    type: String,
    trim: true,
    default: 'The Cashly Payments'
  },
  qrCodeImage: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isPrimary: {
    type: Boolean,
    default: false
  },
  usageCount: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

const paymentSettingSchema = new mongoose.Schema({
  // Legacy primary fallback fields
  upiId: {
    type: String,
    required: true,
    trim: true,
    default: 'cashly@upi'
  },
  upiName: {
    type: String,
    trim: true,
    default: 'The Cashly Payments'
  },
  qrCodeImage: {
    type: String,
    default: ''
  },
  // Multiple QR / UPI Channels
  channels: {
    type: [paymentChannelSchema],
    default: []
  },
  // Equal round-robin rotation counter
  rotationCounter: {
    type: Number,
    default: 0
  },
  instructions: {
    type: String,
    default: '1. Scan the QR code or copy the UPI ID.\n2. Complete the payment in any UPI App (GPay, PhonePe, Paytm).\n3. Enter the 12-digit UTR / Reference number below to verify your deposit.'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  minDeposit: {
    type: Number,
    default: 10000 // In paise (₹100)
  },
  maxDeposit: {
    type: Number,
    default: 10000000 // In paise (₹1,00,000)
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

module.exports = mongoose.model('PaymentSetting', paymentSettingSchema);
