const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User } = require('./models');
require('dotenv').config({ path: __dirname + '/.env' });

const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/thecashly';

mongoose.connect(uri).then(async () => {
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('admin', salt);
  
  const user = await User.findOneAndUpdate(
    { email: 'tamilarasan@gmail.com' }, 
    { passwordHash: passwordHash }, 
    { new: true }
  );
  
  if (user) {
    console.log(`Password for ${user.email} reset to "admin"!`);
  } else {
    console.log('User not found.');
  }
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
