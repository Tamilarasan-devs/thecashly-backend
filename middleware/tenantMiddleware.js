const { tenantStorage } = require('../config/tenantContext');

/**
 * Middleware to detect tenant from request headers, URL prefix, or origin.
 * Sets the active tenant in AsyncLocalStorage so all database operations, models,
 * and background tasks automatically use that tenant's dedicated database.
 * 
 * Also supports explicitly overriding tenant via overrideTenant argument
 * (e.g., app.use('/api/earnbuddy', tenantMiddleware('earnbuddy'), router))
 */
const tenantMiddleware = (forcedTenant = null) => {
  return (req, res, next) => {
    let tenant = forcedTenant;

    if (!tenant) {
      // 1. Check if route prefix indicates earnbuddy
      const originalUrl = req.originalUrl || req.url || '';
      const baseUrl = req.baseUrl || '';
      if (baseUrl.includes('/earnbuddy') || originalUrl.includes('/api/earnbuddy')) {
        tenant = 'earnbuddy';
      }

      // 2. Check custom header sent by frontend
      if (!tenant) {
        const appHeader = (req.headers['x-app-source'] || req.headers['x-app-name'] || '').toString().toLowerCase();
        if (appHeader.includes('earnbuddy') || appHeader.includes('moneymind')) {
          tenant = 'earnbuddy';
        }
      }

      // 3. Check Origin / Referer (e.g. earnbuddy frontend or dev port)
      if (!tenant) {
        const origin = (req.headers.origin || req.headers.referer || '').toString().toLowerCase();
        if (origin.includes('earnbuddy') || origin.includes('moneymind')) {
          tenant = 'earnbuddy';
        }
      }

      // Default fallback
      if (!tenant) {
        tenant = 'thecashly';
      }
    }

    req.tenant = tenant;
    res.setHeader('X-Active-Tenant', tenant);

    tenantStorage.run({ tenant }, () => {
      next();
    });
  };
};

module.exports = {
  tenantMiddleware,
};

