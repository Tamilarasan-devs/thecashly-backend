require('dotenv').config();
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const assert = require('assert');

const { User, Plan, TopUp, PlanSubscription, WalletLedgerEntry } = require('../models');
const { recordLedgerEntry } = require('../services/ledger');
const { purchasePlanFromWallet } = require('../services/payment');

async function runTests() {
  console.log('Starting Cashly Integration Tests...\n');
  const mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongoServer.getUri());

  try {
    // Setup
    const user = await User.create({ name: 'Test User', email: 'test@cashly.local', passwordHash: 'hash', role: 'customer' });
    const plan = await Plan.create({
      name: 'Test Plan',
      description: 'Test',
      initialPayment: 100000, // 1,000 INR
      dailyAmount: 15000,     // 150 INR
      durationDays: 10,
      totalScheduled: 150000,
      status: 'active'
    });

    console.log('1. Testing Insufficient Balance...');
    try {
      await purchasePlanFromWallet(user._id, plan._id);
      assert.fail('Should have thrown insufficient balance error');
    } catch (err) {
      assert.match(err.message, /Insufficient wallet balance/);
      console.log('✅ Insufficient balance properly rejected.');
    }

    console.log('2. Testing Wallet Top-Up (Ledger Consistency)...');
    await recordLedgerEntry(user._id, 100000, 'credit', 'Test Top Up', new mongoose.Types.ObjectId(), 'TopUp');
    const updatedUser = await User.findById(user._id);
    assert.strictEqual(updatedUser.walletBalance, 100000);
    console.log('✅ Wallet accurately credited using ledger.');

    console.log('3. Testing Plan Purchase Submission...');
    const sub = await purchasePlanFromWallet(user._id, plan._id);
    const postPurchaseUser = await User.findById(user._id);
    assert.strictEqual(postPurchaseUser.walletBalance, 0); // 1000 - 1000 = 0
    assert.strictEqual(sub.planSnapshot.name, 'Test Plan');
    console.log('✅ Purchase processed and wallet deducted securely.');

    console.log('4. Testing Duplicate Webhook / Duplicate Ledger Entry...');
    const fakeWebhookId = new mongoose.Types.ObjectId();
    await recordLedgerEntry(user._id, 50000, 'credit', 'Webhook 1', fakeWebhookId, 'TopUp');
    
    try {
      // Try processing the exact same webhook reference again
      await recordLedgerEntry(user._id, 50000, 'credit', 'Webhook Duplicate', fakeWebhookId, 'TopUp');
      assert.fail('Should have rejected duplicate ledger entry');
    } catch (err) {
      // MongoDB duplicate key error on referenceId
      console.log('✅ Duplicate webhooks correctly blocked by database indexing.');
    }

    const finalUser = await User.findById(user._id);
    assert.strictEqual(finalUser.walletBalance, 50000); // Only credited once

  } catch (err) {
    console.error('❌ Test failed:', err);
  } finally {
    await mongoose.disconnect();
    await mongoServer.stop();
    console.log('\nFinished all tests.');
  }
}

runTests();
