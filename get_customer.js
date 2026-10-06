const mongoose = require('mongoose');
const { User } = require('./models');
require('dotenv').config({ path: __dirname + '/.env' });

const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/thecashly';

mongoose.connect(uri).then(async () => {
  const customer = await User.findOne({ role: 'customer' });
  if (customer) {
    console.log(`Found customer: ${customer.email}`);
  } else {
    console.log('No customer found.');
  }
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
