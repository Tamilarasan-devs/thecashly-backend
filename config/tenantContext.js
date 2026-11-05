const { AsyncLocalStorage } = require('async_hooks');

const tenantStorage = new AsyncLocalStorage();

/**
 * Returns the currently active tenant key: 'earnbuddy' or 'thecashly'
 */
const getActiveTenant = () => {
  const store = tenantStorage.getStore();
  return store && store.tenant ? store.tenant : 'thecashly';
};

/**
 * Executes a function within the specified tenant context.
 */
const runWithTenant = (tenant, callback) => {
  return tenantStorage.run({ tenant: tenant === 'earnbuddy' ? 'earnbuddy' : 'thecashly' }, callback);
};

module.exports = {
  tenantStorage,
  getActiveTenant,
  runWithTenant,
};

