const mongoose = require('mongoose');

const colorRoundSchema = new mongoose.Schema({
  roundId: { type: String, required: true, unique: true },
  winningColor: { type: String, enum: ['red', 'green', 'violet'] },
  winningNumber: { type: Number, min: 0, max: 9 },
  price: { type: Number },
  status: { type: String, enum: ['active', 'locked', 'completed'], default: 'active' },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
}, { timestamps: true });

module.exports = mongoose.model('ColorRound', colorRoundSchema);
