const mongoose = require('mongoose');
const { User, WalletLedgerEntry } = require('./models');
require('dotenv').config({ path: __dirname + '/.env' });

const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/thecashly';

mongoose.connect(uri).then(async () => {
  console.log('Connected to MongoDB');
  
  const users = await User.find({});
  console.log(`Found ${users.length} users to migrate.`);

  for (const user of users) {
    let newWalletBalance = 0;
    let newEarningBalance = 0;

    const entries = await WalletLedgerEntry.find({ user: user._id });
    
    for (const entry of entries) {
      if (entry.referenceModel === 'TopUp' || entry.referenceModel === 'PlanSubscription') {
        newWalletBalance += entry.amount;
        entry.balanceType = 'wallet';
      } else if (entry.referenceModel === 'PayoutSchedule' || entry.referenceModel === 'Withdrawal') {
        newEarningBalance += entry.amount;
        entry.balanceType = 'earning';
      } else {
        newWalletBalance += entry.amount;
        entry.balanceType = 'wallet';
      }
      await entry.save();
    }

    console.log(`User ${user.email} - Old Wallet: ${user.walletBalance}, Old Earning: ${user.earningBalance}`);
    console.log(`User ${user.email} - New Wallet: ${newWalletBalance}, New Earning: ${newEarningBalance}`);
    
    user.walletBalance = newWalletBalance;
    user.earningBalance = newEarningBalance;
    await user.save();
  }

  console.log('Migration complete!');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
