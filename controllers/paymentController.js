const mongoose = require('mongoose');
const { Plan, PlanSubscription, PayoutSchedule } = require('../models');
const { ApiError } = require('../middleware/errorHandler');
const { purchasePlanFromWallet } = require('../services/payment');
const { recordLedgerEntry } = require('../services/ledger');

// @desc    Purchase a plan using wallet balance
// @route   POST /api/payments/purchase
// @access  Private
const purchasePlan = async (req, res, next) => {
  try {
    const { planId } = req.body;
    
    if (!planId) {
      return next(new ApiError('Plan ID is required', 400));
    }
    
    // Attempt purchase (will throw error if insufficient balance)
    const subscription = await purchasePlanFromWallet(req.user._id, planId);
    
    res.status(201).json({
      success: true,
      message: 'Plan purchased successfully',
      data: subscription
    });
  } catch (error) {
    next(new ApiError(error.message, 400));
  }
};

// @desc    Get user's subscriptions (My Products)
// @route   GET /api/payments/subscriptions
// @access  Private
const getSubscriptions = async (req, res, next) => {
  try {
    const subscriptions = await PlanSubscription.find({ user: req.user._id })
      .populate('plan', 'name productImage')
      .sort('-createdAt')
      .lean();
      
    // Fetch all payouts for this user (selecting only required projection fields)
    const allPayouts = await PayoutSchedule.find({
      user: req.user._id
    })
      .select('planSubscription status amount eligibilityDate')
      .lean();

    // Attach eligible, collected, and pending amounts to each subscription
    const subsWithAmounts = subscriptions.map(sub => {
      const subPayouts = allPayouts.filter(p => p.planSubscription.toString() === sub._id.toString());
      
      const eligiblePayouts = subPayouts.filter(p => p.status === 'eligible');
      const paidPayouts = subPayouts.filter(p => p.status === 'paid');
      const scheduledPayouts = subPayouts.filter(p => p.status === 'scheduled');

      const eligibleAmount = eligiblePayouts.reduce((sum, p) => sum + p.amount, 0);
      const collectedAmount = paidPayouts.reduce((sum, p) => sum + p.amount, 0);
      const pendingAmount = scheduledPayouts.reduce((sum, p) => sum + p.amount, 0);

      const collectedDays = paidPayouts.length;
      const totalDays = sub.planSnapshot.durationDays;
      
      // Find the next scheduled payout date
      scheduledPayouts.sort((a, b) => new Date(a.eligibilityDate) - new Date(b.eligibilityDate));
      const nextCollectionDate = scheduledPayouts.length > 0 ? scheduledPayouts[0].eligibilityDate : null;

      return { 
        ...sub, 
        eligibleAmount, 
        collectedAmount, 
        pendingAmount,
        collectedDays,
        totalDays,
        nextCollectionDate
      };
    });

    res.json({ success: true, data: subsWithAmounts });
  } catch (error) {
    next(error);
  }
};

// @desc    Collect daily earnings for a subscription
// @route   POST /api/payments/subscriptions/:id/collect
// @access  Private
const { getActiveTenant } = require('../config/tenantContext');
const { startTenantSession } = require('../config/dbManager');

const collectEarnings = async (req, res, next) => {
  const tenant = getActiveTenant();
  const session = await startTenantSession(tenant);

  try {
    let result = { success: false, amount: 0 };

    const executeCollect = async (activeSession) => {
      const subId = req.params.id;
      
      const query = PayoutSchedule.find({
        user: req.user._id,
        planSubscription: subId,
        status: 'eligible'
      });
      if (activeSession) query.session(activeSession);

      const eligiblePayouts = await query;

      if (eligiblePayouts.length === 0) {
        result = { 
          success: true, 
          amount: 0, 
          message: 'No earnings to collect at this time. All eligible returns have already been claimed.' 
        };
        return;
      }

      const totalAmount = eligiblePayouts.reduce((sum, p) => sum + p.amount, 0);

      // Update statuses to paid
      const payoutIds = eligiblePayouts.map(p => p._id);
      const updateOptions = activeSession ? { session: activeSession } : {};
      await PayoutSchedule.updateMany(
        { _id: { $in: payoutIds } },
        { $set: { status: 'paid', processedAt: new Date() } },
        updateOptions
      );

      const subQuery = PlanSubscription.findById(subId);
      if (activeSession) subQuery.session(activeSession);
      const subscription = await subQuery;
      const planName = subscription?.planSnapshot?.name || 'Subscription';
      
      // Credit wallet for each eligible payout schedule
      for (const payout of eligiblePayouts) {
        await recordLedgerEntry(
          req.user._id,
          payout.amount,
          'credit',
          `Collected daily earning for ${planName}`,
          payout._id,
          'PayoutSchedule',
          activeSession,
          'earning'
        );
      }

      result = { success: true, amount: totalAmount };
    };

    if (session) {
      try {
        await session.withTransaction(async () => {
          await executeCollect(session);
        });
      } catch (txnError) {
        console.warn(`[CollectEarnings] Transaction error on ${tenant}, attempting safe direct update:`, txnError.message);
        await executeCollect(null);
      }
    } else {
      await executeCollect(null);
    }

    res.json(result);
  } catch (error) {
    next(new ApiError(error.message, 400));
  } finally {
    if (session) {
      try {
        await session.endSession();
      } catch (e) {
        // Safe to ignore
      }
    }
  }
};

// @desc    Handle incoming payment gateway webhook with HMAC verification
// @route   POST /api/payments/webhook
// @access  Public (Signature-protected)
const { processGatewayWebhook, verifyPaymentSignature } = require('../services/paymentGateway');
const { TopUp } = require('../models');
const { logAuditEvent } = require('../services/auditLogger');

const handleWebhook = async (req, res, next) => {
  try {
    const result = await processGatewayWebhook({
      rawBody: req.rawBody,
      headers: req.headers,
      body: req.body,
      req
    });

    if (!result.success) {
      return res.status(result.status || 400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('[Payment Webhook Error]', error);
    res.status(500).json({ success: false, error: 'Internal webhook handling error' });
  }
};

// @desc    Verify client-side payment completion signature (Razorpay/Gateway)
// @route   POST /api/payments/verify-payment
// @access  Private
const verifyPayment = async (req, res, next) => {
  try {
    const { orderId, paymentId, signature, amount } = req.body;

    if (!orderId || !paymentId || !signature) {
      return next(new ApiError('orderId, paymentId, and signature are required.', 400));
    }

    const isValid = verifyPaymentSignature({
      orderId,
      paymentId,
      signature
    });

    if (!isValid) {
      return next(new ApiError('Invalid payment verification signature.', 400));
    }

    // Check if this payment was already credited (Idempotency)
    const existing = await TopUp.findOne({ gatewayReference: paymentId });
    if (existing && existing.status === 'verified') {
      return res.json({ success: true, message: 'Payment already verified', data: existing });
    }

    const amountPaise = Math.round(Number(amount));
    if (!amountPaise || amountPaise < 10000) {
      return next(new ApiError('Invalid payment amount.', 400));
    }

    const topUp = await TopUp.create({
      user: req.user._id,
      amount: amountPaise,
      status: 'verified',
      gatewayReference: paymentId,
      paymentMethod: 'gateway_sdk',
      verifiedAt: new Date()
    });

    // Credit ledger
    await recordLedgerEntry(
      req.user._id,
      amountPaise,
      'credit',
      `Wallet top-up via Payment Gateway (${paymentId})`,
      topUp._id,
      'TopUp'
    );

    // Audit log
    await logAuditEvent({
      adminUser: null,
      action: 'PAYMENT_SIGNATURE_VERIFIED',
      targetModel: 'TopUp',
      targetId: topUp._id,
      changes: { status: 'verified', paymentId, amount: amountPaise },
      reason: 'Client-side gateway signature verified',
      req
    });

    res.json({
      success: true,
      message: 'Payment verified and wallet credited successfully.',
      data: topUp
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  purchasePlan,
  getSubscriptions,
  collectEarnings,
  handleWebhook,
  verifyPayment
};
