const AviatorHistory = require('../models/AviatorHistory');
const User = require('../models/User');

const playAviator = async (req, res, next) => {
  try {
    const { points } = req.body;
    
    if (!points || points <= 0 || !Number.isInteger(points)) {
      return res.status(400).json({ success: false, message: 'Invalid points.' });
    }

    const user = await User.findById(req.user.id);
    if (user.demoBalance < points) {
      return res.status(400).json({ success: false, message: 'Insufficient demo points.' });
    }

    // Deduct points
    user.demoBalance -= points;
    await user.save();

    // Generate crash point (house edge ~ 1-5%)
    // 99 / Math.random() gives a good exponential distribution
    let e = 100; 
    let random = Math.random();
    // 1% chance of instant crash at 1.00
    let crashPoint = 1.00;
    if (random > 0.01) {
      crashPoint = Math.max(1.00, Math.floor(e / (e - random * e)) / 100);
    }
    
    // Cap max multiplier for sanity (e.g. 1000x)
    if (crashPoint > 1000) crashPoint = 1000;
    
    // Format to 2 decimal places
    crashPoint = parseFloat(crashPoint.toFixed(2));

    const bet = await AviatorHistory.create({
      user: user._id,
      points,
      crashPoint,
      status: 'pending'
    });

    res.json({ 
      success: true, 
      data: {
        betId: bet._id,
        crashPoint: crashPoint,
        demoBalance: user.demoBalance
      }
    });

  } catch (error) {
    next(error);
  }
};

const cashoutAviator = async (req, res, next) => {
  try {
    const { betId, cashoutMultiplier } = req.body;
    
    const bet = await AviatorHistory.findById(betId);
    if (!bet || bet.user.toString() !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Bet not found.' });
    }

    if (bet.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Bet is already settled.' });
    }

    const user = await User.findById(req.user.id);

    // Verify if cashout was valid (cashoutMultiplier <= crashPoint)
    if (cashoutMultiplier <= bet.crashPoint && cashoutMultiplier >= 1.00) {
      const winAmount = Math.floor(bet.points * cashoutMultiplier);
      
      bet.status = 'won';
      bet.cashedOut = true;
      bet.cashoutMultiplier = cashoutMultiplier;
      bet.winAmount = winAmount;
      
      user.demoBalance += winAmount;
      await user.save();
      await bet.save();

      return res.json({ 
        success: true, 
        message: 'Cashed out successfully!',
        data: {
          winAmount,
          demoBalance: user.demoBalance
        }
      });
    } else {
      // They crashed (should technically be handled by frontend telling us it crashed, or by checking)
      bet.status = 'lost';
      await bet.save();
      
      return res.status(400).json({ success: false, message: 'Plane crashed before cashout.' });
    }

  } catch (error) {
    next(error);
  }
};

const aviatorCrash = async (req, res, next) => {
  try {
    const { betId } = req.body;
    const bet = await AviatorHistory.findById(betId);
    
    if (bet && bet.status === 'pending') {
      bet.status = 'lost';
      await bet.save();
    }
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

const getHistory = async (req, res, next) => {
  try {
    const userHistory = await AviatorHistory.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50);

    // Get recent global crash points
    const recentCrashes = await AviatorHistory.find({ status: { $ne: 'pending' } })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('crashPoint -_id');

    res.json({
      success: true,
      data: {
        userHistory,
        recentCrashes: recentCrashes.map(r => r.crashPoint)
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  playAviator,
  cashoutAviator,
  aviatorCrash,
  getHistory
};
