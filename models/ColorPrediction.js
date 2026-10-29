const mongoose = require('mongoose');

const colorPredictionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  roundId: { type: String, required: true },
  selectType: { type: String, enum: ['color', 'number'], required: true },
  color: { type: String, enum: ['red', 'green', 'violet'] },
  number: { type: Number, min: 0, max: 9 },
  points: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'won', 'lost'], default: 'pending' },
  winAmount: { type: Number, default: 0 }
}, { timestamps: true });

colorPredictionSchema.index({ roundId: 1, status: 1 });
colorPredictionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('ColorPrediction', colorPredictionSchema);
