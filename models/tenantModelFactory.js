const { getActiveTenant } = require('../config/tenantContext');
const { getConnection } = require('../config/dbManager');

// Registry of raw schemas to ensure cross-model references (populate) work on every connection
const schemaRegistry = new Map();

function registerSchema(modelName, schema) {
  schemaRegistry.set(modelName, schema);
}

function ensureModelsOnConnection(conn) {
  if (!conn) return;
  for (const [name, schema] of schemaRegistry.entries()) {
    if (!conn.models[name]) {
      conn.model(name, schema);
    }
  }
}

/**
 * Creates a dynamic Model Proxy.
 * Whenever any property or method (e.g. find, create, save, new) is accessed on this Model,
 * the Proxy checks the active tenant ('earnbuddy' vs 'thecashly') via AsyncLocalStorage
 * and forwards the call to the corresponding database connection's model.
 */
function createTenantModel(modelName, schema) {
  registerSchema(modelName, schema);

  // Helper to retrieve the active model from the connection for the current tenant
  const getActiveModel = () => {
    const tenant = getActiveTenant();
    const conn = getConnection(tenant);
    // Ensure all registered models exist on this connection so populate works seamlessly
    ensureModelsOnConnection(conn);
    if (!conn.models[modelName]) {
      return conn.model(modelName, schema);
    }
    return conn.models[modelName];
  };

  // We construct a Dummy function that proxies both method calls and new / instantiate calls
  function ModelProxy(...args) {
    const ActualModel = getActiveModel();
    return new ActualModel(...args);
  }

  // Set prototype and schema for mongoose inspections
  ModelProxy.schema = schema;
  ModelProxy.modelName = modelName;

  const handler = {
    get(target, prop, receiver) {
      if (prop === 'schema') return schema;
      if (prop === 'modelName') return modelName;

      const ActiveModel = getActiveModel();
      const val = Reflect.get(ActiveModel, prop);
      if (typeof val === 'function') {
        return val.bind(ActiveModel);
      }
      return val;
    },
    set(target, prop, value, receiver) {
      const ActiveModel = getActiveModel();
      return Reflect.set(ActiveModel, prop, value);
    },
    construct(target, args) {
      const ActiveModel = getActiveModel();
      return new ActiveModel(...args);
    },
    apply(target, thisArg, args) {
      const ActiveModel = getActiveModel();
      return Reflect.apply(ActiveModel, thisArg, args);
    }
  };

  return new Proxy(ModelProxy, handler);
}

module.exports = {
  createTenantModel,
};

