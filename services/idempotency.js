const { IdempotencyKey } = require('../models');

/**
 * Express middleware to ensure critical endpoints (payments, orders, top-ups)
 * are strictly idempotent when supplied with an Idempotency-Key header.
 */
const idempotencyMiddleware = (options = {}) => {
  return async (req, res, next) => {
    const rawKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
    if (!rawKey) {
      return next();
    }

    const key = String(rawKey).trim();
    if (key.length < 8 || key.length > 128) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Idempotency-Key header. Must be between 8 and 128 characters.'
      });
    }

    try {
      const existing = await IdempotencyKey.findOne({ key });
      if (existing) {
        if (existing.status === 'completed') {
          return res.status(existing.responseStatus || 200).json(existing.responseBody);
        }

        // If currently processing and was locked in the last 30 seconds, reject concurrent double execution
        const isRecent = existing.lockedAt && (Date.now() - new Date(existing.lockedAt).getTime() < 30000);
        if (existing.status === 'processing' && isRecent) {
          return res.status(409).json({
            success: false,
            error: 'A request with this Idempotency-Key is currently being processed. Please wait.'
          });
        }
      }

      // Atomically create or acquire lock
      await IdempotencyKey.findOneAndUpdate(
        { key },
        {
          key,
          user: req.user?._id || null,
          endpoint: req.originalUrl || req.url,
          status: 'processing',
          lockedAt: new Date()
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // Intercept response to store result
      const originalJson = res.json;
      res.json = function (body) {
        const statusCode = res.statusCode;
        if (statusCode >= 200 && statusCode < 300) {
          IdempotencyKey.findOneAndUpdate(
            { key },
            {
              status: 'completed',
              responseStatus: statusCode,
              responseBody: body
            }
          ).catch(err => console.error('[Idempotency] Failed to save completion record:', err.message));
        } else {
          IdempotencyKey.deleteOne({ key, status: 'processing' })
            .catch(() => {});
        }
        return originalJson.call(this, body);
      };

      next();
    } catch (err) {
      console.error('[Idempotency Error]', err.message);
      next();
    }
  };
};

module.exports = {
  idempotencyMiddleware
};

