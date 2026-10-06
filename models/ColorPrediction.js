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

// We can remove the unique constraint because users can bet multiple times on different things
// colorPredictionSchema.index({ user: 1, roundId: 1 }, { unique: true });

module.exports = mongoose.model('ColorPrediction', colorPredictionSchema);
