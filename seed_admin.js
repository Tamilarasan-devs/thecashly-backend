require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ADMIN_EMAIL = process.argv[2] || 'tamilarasan@gmail.com';
const ADMIN_PASSWORD = process.argv[3] || 'admin';
const ADMIN_NAME = 'Admin';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  passwordHash: { type: String, required: true },
  role: { type: String, default: 'admin' },
  walletBalance: { type: Number, default: 0 },
  referralCode: { type: String }
}, { timestamps: true });

async function seedAdmin(uri, label) {
  if (!uri) {
    console.log(`[${label}] No URI found, skipping.`);
    return;
  }
  try {
    const conn = await mongoose.createConnection(uri).asPromise();
    const UserModel = conn.model('User', userSchema);
    
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, salt);

    const updated = await UserModel.findOneAndUpdate(
      { email: ADMIN_EMAIL.toLowerCase() },
      {
        name: ADMIN_NAME,
        email: ADMIN_EMAIL.toLowerCase(),
        passwordHash,
        role: 'admin'
      },
      { upsert: true, new: true }
    );

    console.log(`[${label}] Admin ready:`);
    console.log(`  Email:    ${updated.email}`);
    console.log(`  Password: ${ADMIN_PASSWORD}`);
    console.log(`  Role:     ${updated.role}`);
    await conn.close();
  } catch (err) {
    console.error(`[${label}] Error setting admin:`, err.message);
  }
}

async function run() {
  console.log('--- Setting Admin Account ---');
  await seedAdmin(process.env.MONGO_URI, 'TheCashly DB');
  await seedAdmin(process.env.EARNBUDDY_MONGO_URI, 'EarnBuddy DB');
  process.exit(0);
}

run();
