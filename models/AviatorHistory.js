const mongoose = require('mongoose');

const aviatorHistorySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  points: { type: Number, required: true },
  crashPoint: { type: Number, required: true },
  cashedOut: { type: Boolean, default: false },
  cashoutMultiplier: { type: Number },
  winAmount: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'won', 'lost'], default: 'pending' }
}, { timestamps: true });

module.exports = mongoose.model('AviatorHistory', aviatorHistorySchema);
