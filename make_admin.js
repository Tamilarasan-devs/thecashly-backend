const mongoose = require('mongoose');
const { User } = require('./models');
require('dotenv').config({ path: __dirname + '/.env' });

const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/thecashly';

mongoose.connect(uri).then(async () => {
  const user = await User.findOneAndUpdate({ email: 'tamilarasan@gmail.com' }, { role: 'admin' }, { new: true });
  if (user) {
    console.log(`User ${user.email} is now an ${user.role}!`);
  } else {
    console.log('User not found.');
  }
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
