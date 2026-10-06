const cron = require('node-cron');
const ColorRound = require('../models/ColorRound');
const ColorPrediction = require('../models/ColorPrediction');
const User = require('../models/User');

const settleGameRound = async () => {
  try {
    // Settle the previous minute's round
    const now = new Date();
    // Calculate the roundId for the previous minute
    const previousMinute = new Date(now.getTime() - 60000);
    const roundId = previousMinute.toISOString().slice(0, 16).replace(/[-T:]/g, '');

    // Find the round
    let round = await ColorRound.findOne({ roundId, status: 'active' });
    if (!round) {
      // It might not exist if no one opened the app during that minute, or already settled.
      return;
    }

    // Generate Price and Number
    // Price typically 5 digit random number like 35241
    const price = Math.floor(10000 + Math.random() * 90000);
    const winningNumber = price % 10;
    
    // Determine the winning color based on number
    let winningColor = 'red';
    if ([1, 3, 7, 9].includes(winningNumber)) winningColor = 'green';
    else if ([2, 4, 6, 8].includes(winningNumber)) winningColor = 'red';
    else if ([0, 5].includes(winningNumber)) winningColor = 'violet';

    round.winningColor = winningColor;
    round.winningNumber = winningNumber;
    round.price = price;
    round.status = 'completed';
    await round.save();

    // Settle predictions
    const predictions = await ColorPrediction.find({ roundId, status: 'pending' }).populate('user');
    
    for (const prediction of predictions) {
      let isWin = false;
      let multiplier = 0;

      if (prediction.selectType === 'color' && prediction.color === winningColor) {
        isWin = true;
        // Standard payouts: Green/Red = 2x (1.96x usually, but let's do 2x), Violet = 4.5x
        multiplier = winningColor === 'violet' ? 4.5 : 2;
      } else if (prediction.selectType === 'number' && prediction.number === winningNumber) {
        isWin = true;
        multiplier = 9;
      }

      if (isWin) {
        prediction.status = 'won';
        prediction.winAmount = prediction.points * multiplier;
        
        // Add points to user's demo balance
        if (prediction.user) {
          const user = await User.findById(prediction.user._id);
          if (user) {
            user.demoBalance += prediction.winAmount;
            await user.save();
          }
        }
      } else {
        // User loses
        prediction.status = 'lost';
        prediction.winAmount = 0;
      }
      await prediction.save();
    }
    
    console.log(`[ColorGame] Settled round ${roundId}. Winning color: ${winningColor}`);

  } catch (error) {
    console.error('[ColorGame Error]', error);
  }
};

const startColorGameJob = () => {
  // Run at exactly 0 seconds of every minute
  cron.schedule('* * * * *', () => {
    settleGameRound();
  });
};

module.exports = {
  startColorGameJob
};
