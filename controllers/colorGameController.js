const ColorRound = require('../models/ColorRound');
const ColorPrediction = require('../models/ColorPrediction');
const User = require('../models/User');

const getCurrentRound = async (req, res, next) => {
  try {
    const now = new Date();
    // Round ID based on current minute, e.g., 202610061705
    const roundId = now.toISOString().slice(0, 16).replace(/[-T:]/g, '');
    const currentSecond = now.getSeconds();
    const remainingSeconds = 60 - currentSecond;
    
    // Make sure a round document exists for the history, though not strictly required until settlement
    let round = await ColorRound.findOne({ roundId });
    if (!round) {
      const startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);
      const endTime = new Date(startTime.getTime() + 60000);
      try {
        round = await ColorRound.create({ roundId, startTime, endTime });
      } catch (err) {
        // Handle duplicate key in case of race condition
        round = await ColorRound.findOne({ roundId });
      }
    }

    const user = await User.findById(req.user.id);

    // Also get the current user's predictions for this round
    const pendingPredictions = await ColorPrediction.find({ user: user._id, roundId, status: 'pending' });

    res.json({
      success: true,
      data: {
        roundId,
        serverTime: now.getTime(),
        remainingSeconds,
        demoBalance: user.demoBalance,
        pendingPredictions
      }
    });
  } catch (error) {
    next(error);
  }
};

const submitPrediction = async (req, res, next) => {
  try {
    const { selectType, color, number, points } = req.body;
    
    if (!['color', 'number'].includes(selectType)) {
      return res.status(400).json({ success: false, message: 'Invalid selection type.' });
    }

    if (selectType === 'color' && !['red', 'green', 'violet'].includes(color)) {
      return res.status(400).json({ success: false, message: 'Invalid color selected.' });
    }

    if (selectType === 'number' && (number < 0 || number > 9 || !Number.isInteger(number))) {
      return res.status(400).json({ success: false, message: 'Invalid number selected.' });
    }
    
    if (!points || points <= 0 || !Number.isInteger(points)) {
      return res.status(400).json({ success: false, message: 'Invalid points.' });
    }

    const now = new Date();
    const currentSecond = now.getSeconds();
    if (currentSecond >= 55) {
      return res.status(400).json({ success: false, message: 'Entries are closed for this round.' });
    }

    const roundId = now.toISOString().slice(0, 16).replace(/[-T:]/g, '');
    
    // Check user balance
    const user = await User.findById(req.user.id);
    if (user.demoBalance < points) {
      return res.status(400).json({ success: false, message: 'Insufficient demo points.' });
    }

    // Deduct points
    user.demoBalance -= points;
    await user.save();

    // Create prediction
    try {
      const prediction = await ColorPrediction.create({
        user: user._id,
        roundId,
        selectType,
        color: selectType === 'color' ? color : undefined,
        number: selectType === 'number' ? number : undefined,
        points,
        status: 'pending'
      });
      
      res.json({ success: true, message: 'Prediction submitted successfully.', data: prediction });
    } catch (err) {
      // If duplicate prediction
      if (err.code === 11000) {
        // Refund
        user.demoBalance += points;
        await user.save();
        return res.status(400).json({ success: false, message: 'You have already placed a prediction for this round.' });
      }
      throw err;
    }

  } catch (error) {
    next(error);
  }
};

const getHistory = async (req, res, next) => {
  try {
    const limit = 20;
    const latestRounds = await ColorRound.find({ status: 'completed' })
      .sort({ roundId: -1 })
      .limit(limit)
      .select('roundId winningColor winningNumber price -_id');

    const userHistory = await ColorPrediction.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      data: {
        rounds: latestRounds,
        userHistory
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCurrentRound,
  submitPrediction,
  getHistory
};
