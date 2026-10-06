require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { errorHandler } = require('./middleware/errorHandler');
const cron = require('node-cron');
const { processPayouts } = require('./jobs/payoutJob');
const { startColorGameJob } = require('./jobs/colorGameJob');

const app = express();

// Middlewares
app.use(cors({
  origin: [
    'http://localhost:5173', 
    'https://thecashly-gamestore.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes placeholder
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/withdrawals', require('./routes/withdrawals'));
app.use('/api/topups', require('./routes/topUps'));
app.use('/api/services', require('./routes/services'));
app.use('/api/admin', require('./routes/adminTools'));
app.use('/api/colorgame', require('./routes/colorGame'));
app.use('/api/aviator', require('./routes/aviator'));

// Initialize Cron Jobs
// Run daily at midnight UTC
cron.schedule('0 0 * * *', () => {
  console.log('[CRON] Running daily payout processor...');
  processPayouts();
});

startColorGameJob();

// Error handling
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    let mongoUri = process.env.MONGO_URI;
    
    // For local dev without a real Mongo URI, use Memory Server
    if (!mongoUri || mongoUri === 'memory') {
      const mongod = await MongoMemoryServer.create();
      mongoUri = mongod.getUri();
      console.log(`[DB] Using MongoDB Memory Server: ${mongoUri}`);
    }

    await mongoose.connect(mongoUri);
    console.log('[DB] Connected to MongoDB');

    // Run payout processor immediately on startup to catch up on any missed cron jobs
    console.log('[Startup] Catching up on missed payouts...');
    await processPayouts();

    const http = require('http');
    const server = http.createServer(app);
    
    // Initialize Aviator WebSocket Engine
    const { initAviatorSocket } = require('./services/aviatorEngine');
    initAviatorSocket(server);

    server.listen(PORT, () => {
      console.log(`[Server] Running on port ${PORT}`);
    });
  } catch (error) {
    console.error('[Startup Error]', error);
    process.exit(1);
  }
}

startServer();
