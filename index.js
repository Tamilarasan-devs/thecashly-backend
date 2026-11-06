require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { errorHandler } = require('./middleware/errorHandler');
const cron = require('node-cron');
const { processPayouts } = require('./jobs/payoutJob');
const { startColorGameJob } = require('./jobs/colorGameJob');

const path = require('path');
const zlib = require('zlib');
const helmet = require('helmet');
const { apiLimiter, authLimiter, transactionLimiter } = require('./middleware/rateLimiter');

const { tenantMiddleware } = require('./middleware/tenantMiddleware');
const { initDatabases } = require('./config/dbManager');
const { runWithTenant } = require('./config/tenantContext');

const app = express();

// Secure HTTP response headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Allowed Origins for CORS
const allowedOrigins = [
  'https://thecashly-gamestore.vercel.app',
  'https://thecashly.in',
  'https://www.thecashly.in',
  'https://earnbuddy.in',
  'https://www.earnbuddy.in',
  'https://earnbuddy-frontend-taupe.vercel.app',
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/
];

if (process.env.CLIENT_URL) {
  allowedOrigins.push(process.env.CLIENT_URL);
}

// Built-in Lightweight Gzip Compression Middleware (zero external dependency)
app.use((req, res, next) => {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding.includes('gzip')) {
    return next();
  }

  const originalSend = res.send;
  res.send = function (body) {
    if (res.headersSent || req.method === 'HEAD' || (res.statusCode >= 300 && res.statusCode < 400)) {
      return originalSend.call(this, body);
    }

    if (!body) {
      return originalSend.call(this, body);
    }

    const isString = typeof body === 'string';
    const isBuffer = Buffer.isBuffer(body);

    if (!isString && !isBuffer) {
      return originalSend.call(this, body);
    }

    const buffer = isBuffer ? body : Buffer.from(body);
    // Only compress responses over 1KB
    if (buffer.length < 1024) {
      return originalSend.call(this, body);
    }

    zlib.gzip(buffer, (err, compressed) => {
      if (err) {
        return originalSend.call(this, body);
      }
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', compressed.length);
      res.removeHeader('ETag');
      originalSend.call(this, compressed);
    });
  };
  next();
});

// Middlewares
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '7d', etag: true }));

// Rate Limiting
app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/earnbuddy/auth/login', authLimiter);
app.use('/api/earnbuddy/auth/register', authLimiter);
app.use('/api/topups', transactionLimiter);
app.use('/api/withdrawals', transactionLimiter);
app.use('/api/payments/purchase', transactionLimiter);
app.use('/api/earnbuddy/topups', transactionLimiter);
app.use('/api/earnbuddy/withdrawals', transactionLimiter);
app.use('/api/earnbuddy/payments/purchase', transactionLimiter);

// Routes placeholder
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// Dedicated Separate EarnBuddy API Routes
app.use('/api/earnbuddy', tenantMiddleware('earnbuddy'), require('./routes/earnbuddyRoutes'));

// Default / TheCashly API Routes (with automatic tenant detection based on header/origin/URL)
app.use('/api', tenantMiddleware());
app.use('/api/auth', require('./routes/auth'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/withdrawals', require('./routes/withdrawals'));
app.use('/api/topups', require('./routes/topUps'));
app.use('/api/services', require('./routes/services'));
app.use('/api/payment-settings', require('./routes/paymentSettings'));
app.use('/api/admin', require('./routes/adminTools'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/colorgame', require('./routes/colorGame'));
app.use('/api/aviator', require('./routes/aviator'));

// Initialize Cron Jobs for both databases
// Run daily at midnight UTC
cron.schedule('0 0 * * *', async () => {
  console.log('[CRON] Running daily payout processor for TheCashly...');
  await runWithTenant('thecashly', () => processPayouts());
  console.log('[CRON] Running daily payout processor for EarnBuddy...');
  await runWithTenant('earnbuddy', () => processPayouts());
});

startColorGameJob();

// Error handling
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Validate critical environment secrets
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'fallback_secret_for_dev') {
      console.error('[FATAL] JWT_SECRET environment variable is missing or insecure. Aborting server startup.');
      process.exit(1);
    }

    // Initialize both database connections (TheCashly + EarnBuddy)
    await initDatabases();
    console.log('[DB] Multi-tenant databases ready (TheCashly & EarnBuddy)');

    // Ensure all existing users have unique referral codes for both tenants (non-blocking)
    const { User } = require('./models');
    const backfillReferralsForTenant = async (tenantName) => {
      await runWithTenant(tenantName, async () => {
        try {
          const usersWithoutRef = await User.find({
            $or: [
              { referralCode: { $exists: false } },
              { referralCode: null },
              { referralCode: '' }
            ]
          }).select('_id');

          if (usersWithoutRef.length > 0) {
            const { generateUniqueReferralCode } = require('./utils/referral');
            for (const u of usersWithoutRef) {
              const userDoc = await User.findById(u._id);
              if (userDoc && !userDoc.referralCode) {
                userDoc.referralCode = await generateUniqueReferralCode(User);
                await userDoc.save();
              }
            }
            console.log(`[Referral:${tenantName}] Backfilled referral codes for ${usersWithoutRef.length} existing user(s).`);
          }
        } catch (refErr) {
          console.error(`[Referral Backfill Warning:${tenantName}]`, refErr.message);
        }
      });
    };

    backfillReferralsForTenant('thecashly');
    backfillReferralsForTenant('earnbuddy');

    const http = require('http');
    const server = http.createServer(app);
    
    // Initialize Aviator WebSocket Engine
    const { initAviatorSocket } = require('./services/aviatorEngine');
    initAviatorSocket(server);

    server.listen(PORT, () => {
      console.log(`[Server] Running on port ${PORT}`);
      // Run payout processor in background on startup to catch up on any missed cron jobs
      runWithTenant('thecashly', () => processPayouts()).catch(err => console.error('[Startup Payout Error:thecashly]', err));
      runWithTenant('earnbuddy', () => processPayouts()).catch(err => console.error('[Startup Payout Error:earnbuddy]', err));
    });
  } catch (error) {
    console.error('[Startup Error]', error);
    process.exit(1);
  }
}

startServer();
