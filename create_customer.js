const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User } = require('./models');
require('dotenv').config({ path: __dirname + '/.env' });

const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/thecashly';

mongoose.connect(uri).then(async () => {
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('password', salt);
  
  await User.findOneAndUpdate(
    { email: 'customer@example.com' }, 
    { name: 'Casual User', username: 'casual123', passwordHash, role: 'customer' }, 
    { upsert: true }
  );
  
  console.log('Customer created successfully.');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
