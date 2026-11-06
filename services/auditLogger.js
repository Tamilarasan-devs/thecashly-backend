const { AuditLog } = require('../models');

/**
 * Persists an immutable audit log entry for critical administrative and financial operations.
 */
async function logAuditEvent({
  adminUser = null,
  action,
  targetModel,
  targetId,
  changes = null,
  reason = '',
  ipAddress = '',
  req = null
}) {
  try {
    const ip = ipAddress || (req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '') : '');
    const admin = adminUser || (req?.user?.role === 'admin' ? req.user._id : null);

    const log = await AuditLog.create({
      adminUser: admin,
      action,
      targetModel,
      targetId,
      changes,
      reason,
      ipAddress: String(ip).slice(0, 45)
    });
    return log;
  } catch (err) {
    console.error('[AuditLog Warning] Failed to persist audit log entry:', err.message);
    return null;
  }
}

module.exports = {
  logAuditEvent
};

