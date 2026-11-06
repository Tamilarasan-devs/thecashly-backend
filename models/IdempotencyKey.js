const mongoose = require('mongoose');

const idempotencyKeySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  endpoint: { type: String, required: true },
  status: { type: String, enum: ['processing', 'completed', 'failed'], default: 'processing' },
  responseStatus: { type: Number },
  responseBody: { type: mongoose.Schema.Types.Mixed },
  lockedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 48 * 60 * 60 * 1000) } // 48h TTL
}, { timestamps: true });

idempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
idempotencyKeySchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model('IdempotencyKey', idempotencyKeySchema);

