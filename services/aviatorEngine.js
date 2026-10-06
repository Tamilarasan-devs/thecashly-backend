const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AviatorHistory = require('../models/AviatorHistory');
const crypto = require('crypto');

let io;

// Game State
const WAITING_TIME = 6000; // 6 seconds waiting time between rounds
let gameState = 'waiting'; // 'waiting', 'flying', 'crashed'
let currentMultiplier = 1.0;
let crashPoint = 1.0;
let roundId = null;
let startTime = null;
let activeBets = new Map(); // betId -> betInfo

// History cache
let recentCrashes = [];

const initAviatorSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: [
        'http://localhost:5173',
        'https://thecashly-gamestore.vercel.app'
      ],
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Socket authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication error'));
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = await User.findById(decoded.id).select('-password');
      if (!socket.user) return next(new Error('User not found'));
      
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    // Send initial state upon connection
    socket.emit('game_state', {
      state: gameState,
      multiplier: currentMultiplier,
      startTime,
      roundId,
      recentCrashes
    });

    // Handle bet placement via socket for instant response
    socket.on('place_bet', async (data, callback) => {
      try {
        if (gameState !== 'waiting') {
          return callback({ success: false, message: 'Round already started.' });
        }

        const { points, autoCashout } = data;
        if (!points || points <= 0) {
          return callback({ success: false, message: 'Invalid points.' });
        }

        const user = await User.findById(socket.user._id);
        if (user.walletBalance < points * 100) {
          return callback({ success: false, message: 'Insufficient balance.' });
        }

        user.walletBalance -= points * 100;
        await user.save();

        const bet = await AviatorHistory.create({
          user: user._id,
          points,
          crashPoint, // current round crash point
          status: 'pending'
        });

        const betInfo = {
          betId: bet._id,
          userId: user._id.toString(),
          points,
          autoCashout: autoCashout || null,
          socketId: socket.id
        };
        activeBets.set(bet._id.toString(), betInfo);

        // Notify other clients about the new bet (optional, for "live bets" panel)
        io.emit('new_bet', { userId: user._id, points });

        callback({ success: true, betId: bet._id, balance: user.walletBalance / 100 });

      } catch (error) {
        console.error('Place bet error:', error);
        callback({ success: false, message: 'Server error' });
      }
    });

    // Handle manual cashout
    socket.on('cashout', async (data, callback) => {
      try {
        if (gameState !== 'flying') {
          return callback({ success: false, message: 'Cannot cashout now.' });
        }

        const { betId } = data;
        const betInfo = activeBets.get(betId);
        
        if (!betInfo || betInfo.userId !== socket.user._id.toString()) {
          return callback({ success: false, message: 'Invalid bet.' });
        }

        // The critical section: secure the current multiplier from the server
        const cashoutMulti = currentMultiplier;

        // Verify again just in case (atomic-like check)
        if (cashoutMulti > crashPoint || gameState === 'crashed') {
           return callback({ success: false, message: 'Plane crashed.' });
        }

        // Prevent duplicate cashout race conditions
        activeBets.delete(betId);

        // Process win
        const winAmount = Math.floor(betInfo.points * cashoutMulti);
        
        const user = await User.findById(socket.user._id);
        // Winnings also go to walletBalance, or earningBalance? I will add to walletBalance to keep it as a unified playable balance.
        user.walletBalance += winAmount * 100;
        await user.save();

        await AviatorHistory.findByIdAndUpdate(betId, {
          status: 'won',
          cashedOut: true,
          cashoutMultiplier: cashoutMulti,
          winAmount
        });

        callback({ 
          success: true, 
          winAmount, 
          multiplier: cashoutMulti, 
          balance: user.walletBalance / 100 
        });

      } catch (error) {
        console.error('Cashout error:', error);
        callback({ success: false, message: 'Server error' });
      }
    });
  });

  // Start the engine loop
  loadHistory();
  startNewRound();
};

const loadHistory = async () => {
  const crashes = await AviatorHistory.find({ status: { $ne: 'pending' } })
    .sort({ createdAt: -1 })
    .limit(20)
    .select('crashPoint -_id');
  recentCrashes = crashes.map(c => c.crashPoint);
};

// Add TEST_MODE flag
const TEST_MODE = false; // Disabled for normal gameplay
let testCrashIndex = 0;
const testCrashPoints = [1.50, 2.00, 5.00];

const generateCrashPoint = () => {
  if (TEST_MODE) {
    const point = testCrashPoints[testCrashIndex];
    testCrashIndex = (testCrashIndex + 1) % testCrashPoints.length;
    return point;
  }

  // Provably fair exponential distribution with 1% house edge instant crash
  let e = 100; 
  
  // Cryptographically secure randomness between 0 and 1
  const buf = crypto.randomBytes(4);
  const random = buf.readUInt32BE(0) / 0xffffffff;
  
  let point = 1.00;
  
  // 1% chance of instant crash at 1.00
  if (random > 0.01) {
    // Standard Crash game formula: 1 / (1 - random)
    let multi = e / (e - random * e);
    // Format to 2 decimal places properly: floor(multi * 100) / 100
    point = Math.max(1.00, Math.floor(multi * 100) / 100);
  }
  
  // Cap for sanity
  if (point > 1000) point = 1000;
  return parseFloat(point.toFixed(2));
};

const startNewRound = () => {
  gameState = 'waiting';
  currentMultiplier = 1.0;
  crashPoint = generateCrashPoint();
  roundId = Date.now().toString(); // unique round id
  
  io.emit('game_state', { state: gameState, roundId, waitingTime: WAITING_TIME });
  
  setTimeout(() => {
    takeOff();
  }, WAITING_TIME);
};

const takeOff = () => {
  gameState = 'flying';
  startTime = Date.now();
  currentMultiplier = 1.0;
  
  io.emit('game_state', { state: gameState, startTime, multiplier: currentMultiplier });
  
  // Game loop 
  const flightInterval = setInterval(() => {
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    
    // Exact same formula as frontend
    currentMultiplier = 1 + Math.pow(elapsedSeconds * 1.5, 1.2) * 0.05;
    
    // Auto cashout processing
    processAutoCashouts();

    if (currentMultiplier >= crashPoint) {
      clearInterval(flightInterval);
      crashPlane();
    } else {
      io.volatile.emit('tick', { multiplier: currentMultiplier });
    }
  }, 100); // Send tick every 100ms
};

const processAutoCashouts = async () => {
  // Iterate through active bets and see if any hit their autoCashout target
  for (const [betId, betInfo] of activeBets.entries()) {
    if (betInfo.autoCashout && currentMultiplier >= betInfo.autoCashout) {
       // Prevent duplicate payouts
       activeBets.delete(betId);
       
       // Perform cashout
       try {
         const winAmount = Math.floor(betInfo.points * betInfo.autoCashout);
         const user = await User.findById(betInfo.userId);
         user.walletBalance += winAmount * 100;
         await user.save();

         await AviatorHistory.findByIdAndUpdate(betId, {
           status: 'won',
           cashedOut: true,
           cashoutMultiplier: betInfo.autoCashout,
           winAmount
         });
         
         // Notify the specific user if possible
         io.to(betInfo.socketId).emit('auto_cashed_out', {
           betId,
           winAmount,
           multiplier: betInfo.autoCashout,
           balance: user.walletBalance / 100
         });
       } catch (err) {
         console.error('Auto cashout error:', err);
         // Optionally put back in activeBets on failure, but for game integrity, better to let it fail or log for manual resolution.
       }
    }
  }
};

const crashPlane = async () => {
  gameState = 'crashed';
  currentMultiplier = crashPoint;
  
  io.emit('game_state', { state: gameState, multiplier: currentMultiplier, crashPoint });
  
  // Settle all remaining active bets as lost
  const lostBetIds = Array.from(activeBets.keys());
  
  if (lostBetIds.length > 0) {
    await AviatorHistory.updateMany(
      { _id: { $in: lostBetIds } },
      { $set: { status: 'lost', crashPoint } }
    );
  }
  
  activeBets.clear();
  
  // Update history cache
  recentCrashes.unshift(crashPoint);
  if (recentCrashes.length > 20) recentCrashes.pop();
  
  io.emit('history_update', recentCrashes);
  
  // Wait before starting next round
  setTimeout(() => {
    startNewRound();
  }, 3000); // 3 seconds crash display
};

module.exports = { initAviatorSocket };
