const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  adminUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true },
  targetModel: { type: String, required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  changes: { type: mongoose.Schema.Types.Mixed }, // e.g., { status: { old: 'active', new: 'suspended' } }
  reason: { type: String },
  ipAddress: { type: String },
}, { timestamps: true });

auditLogSchema.index({ targetModel: 1, targetId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ adminUser: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
