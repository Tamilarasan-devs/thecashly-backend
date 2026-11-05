const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Registry of database connections
const connections = {
  thecashly: null,
  earnbuddy: null,
};

let memServerTheCashly = null;
let memServerEarnBuddy = null;

const createConnectionWithPool = async (uri, name) => {
  return mongoose.createConnection(uri, {
    maxPoolSize: 15,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 45000,
  }).asPromise();
};

const initDatabases = async () => {
  try {
    let thecashlyUri = process.env.MONGO_URI;
    let earnbuddyUri = process.env.EARNBUDDY_MONGO_URI;

    // Fallback for memory testing if specified or missing
    if (!thecashlyUri || thecashlyUri === 'memory') {
      memServerTheCashly = await MongoMemoryServer.create();
      thecashlyUri = memServerTheCashly.getUri();
      console.log(`[DB:TheCashly] Using in-memory Mongo: ${thecashlyUri}`);
    }

    if (!earnbuddyUri || earnbuddyUri === 'memory') {
      memServerEarnBuddy = await MongoMemoryServer.create();
      earnbuddyUri = memServerEarnBuddy.getUri();
      console.log(`[DB:EarnBuddy] Using in-memory Mongo: ${earnbuddyUri}`);
    }

    // Connect primary (TheCashly)
    console.log('[DB] Connecting to TheCashly database...');
    connections.thecashly = await createConnectionWithPool(thecashlyUri, 'thecashly');
    console.log(`[DB] Connected to TheCashly database (${connections.thecashly.name || 'default'})`);

    // Connect secondary (EarnBuddy)
    console.log('[DB] Connecting to EarnBuddy database...');
    try {
      connections.earnbuddy = await createConnectionWithPool(earnbuddyUri, 'earnbuddy');
      console.log(`[DB] Connected to EarnBuddy database (${connections.earnbuddy.name || 'earnbuddy'})`);
    } catch (err) {
      console.error('[DB] Failed to connect to EarnBuddy remote MongoDB. Falling back to local in-memory DB:', err.message);
      memServerEarnBuddy = await MongoMemoryServer.create();
      const fallbackUri = memServerEarnBuddy.getUri();
      connections.earnbuddy = await createConnectionWithPool(fallbackUri, 'earnbuddy');
      console.log(`[DB] Connected to EarnBuddy fallback in-memory database.`);
    }

    // Also connect mongoose default connection to TheCashly for backwards compatibility with any direct mongoose calls
    if (mongoose.connection.readyState === 0) {
      try {
        await mongoose.connect(thecashlyUri, {
          maxPoolSize: 5,
          serverSelectionTimeoutMS: 5000,
        });
      } catch (e) {
        // Safe to ignore if secondary connection exists
      }
    }

    return connections;
  } catch (error) {
    console.error('[DB Init Error]', error);
    throw error;
  }
};

const getConnection = (tenant = 'thecashly') => {
  if (tenant === 'earnbuddy' && connections.earnbuddy) {
    return connections.earnbuddy;
  }
  return connections.thecashly || mongoose.connection;
};

/**
 * Starts a session on the active tenant's connection.
 * If transactions or sessions fail on standalone/unsupported Mongo,
 * returns null so callers can proceed with safe atomic fallback.
 */
const startTenantSession = async (tenant = 'thecashly') => {
  const conn = getConnection(tenant);
  if (!conn || typeof conn.startSession !== 'function') {
    return null;
  }
  try {
    return await conn.startSession();
  } catch (err) {
    console.warn(`[DB:${tenant}] Session not available, continuing without transaction:`, err.message);
    return null;
  }
};

module.exports = {
  initDatabases,
  getConnection,
  startTenantSession,
  connections,
};

