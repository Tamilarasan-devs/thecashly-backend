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

    // Fail immediately if MONGO_URI is missing - ephemeral in-memory databases are disabled to protect user data
    if (!thecashlyUri || thecashlyUri === 'memory') {
      if (process.env.NODE_ENV === 'test' && process.env.ALLOW_IN_MEMORY_DB === 'true') {
        memServerTheCashly = await MongoMemoryServer.create();
        thecashlyUri = memServerTheCashly.getUri();
        console.log(`[DB:TheCashly] Using in-memory Mongo (test mode only): ${thecashlyUri}`);
      } else {
        throw new Error('FATAL: MONGO_URI environment variable is missing or set to "memory". In-memory database fallback is disabled to prevent catastrophic data loss.');
      }
    }

    // Connect primary (TheCashly)
    console.log('[DB] Connecting to TheCashly database...');
    connections.thecashly = await createConnectionWithPool(thecashlyUri, 'thecashly');
    console.log(`[DB] Connected to TheCashly database (${connections.thecashly.name || 'default'})`);

    // Connect secondary (EarnBuddy)
    if (earnbuddyUri && earnbuddyUri !== 'memory') {
      console.log('[DB] Connecting to EarnBuddy database...');
      try {
        connections.earnbuddy = await createConnectionWithPool(earnbuddyUri, 'earnbuddy');
        console.log(`[DB] Connected to EarnBuddy database (${connections.earnbuddy.name || 'earnbuddy'})`);
      } catch (err) {
        console.error('[DB] Failed to connect to EarnBuddy remote MongoDB:', err.message);
        throw new Error(`FATAL: Failed to connect to EarnBuddy remote database: ${err.message}`);
      }
    } else {
      console.log('[DB] EARNBUDDY_MONGO_URI not configured. EarnBuddy requests will use primary database connection.');
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

