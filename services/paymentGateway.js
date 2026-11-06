const crypto = require('crypto');
const { TopUp, Payment, User } = require('../models');
const { recordLedgerEntry } = require('./ledger');
const { logAuditEvent } = require('./auditLogger');
const { triggerReferralCheckOnDeposit } = require('../controllers/referralAdminController');

/**
 * Timing-safe HMAC SHA-256 signature verification.
 */
function verifyHmacSignature(data, signature, secret) {
  if (!signature || !secret || !data) return false;
  try {
    const hmac = crypto.createHmac('sha256', secret);
    const expected = hmac.update(data).digest('hex');
    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch (err) {
    console.error('[Signature Verification Error]', err.message);
    return false;
  }
}

/**
 * Verifies standard client-side payment signature (e.g. Razorpay: order_id + "|" + payment_id).
 */
function verifyPaymentSignature({ orderId, paymentId, signature, secret }) {
  const secretKey = secret || process.env.RAZORPAY_KEY_SECRET || process.env.PAYMENT_GATEWAY_SECRET;
  if (!secretKey) {
    throw new Error('Payment gateway secret is not configured on the server.');
  }
  const payload = `${orderId}|${paymentId}`;
  return verifyHmacSignature(payload, signature, secretKey);
}

/**
 * Handles incoming payment gateway webhooks (Razorpay / Cashfree / Standard PG).
 * Idempotently verifies signatures, credits wallet, and records audit logs.
 */
async function processGatewayWebhook({ rawBody, headers, body, req = null }) {
  const signature = headers['x-razorpay-signature'] || 
                    headers['x-webhook-signature'] || 
                    headers['x-signature'];

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 
                        process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET ||
                        process.env.PAYMENT_GATEWAY_SECRET;

  if (!webhookSecret) {
    console.error('[Webhook Error] Webhook secret not configured in environment.');
    return { success: false, status: 500, error: 'Webhook secret is not configured.' };
  }

  // Use rawBody buffer or string for HMAC computation
  const bodyToVerify = rawBody || JSON.stringify(body || {});
  const isValid = verifyHmacSignature(bodyToVerify, signature, webhookSecret);

  if (!isValid) {
    console.warn('[Webhook Warning] Received invalid or forged webhook signature.');
    return { success: false, status: 400, error: 'Invalid webhook signature.' };
  }

  // Parse payment event details
  const event = body.event || body.type || 'payment.captured';
  const entity = body.payload?.payment?.entity || body.data?.payment || body;

  const paymentId = entity.id || entity.payment_id || entity.order_id || body.event_id;
  const orderId = entity.order_id;
  const amountPaise = entity.amount ? Math.round(Number(entity.amount)) : 0;
  const userNotes = entity.notes || {};
  const userId = userNotes.userId || userNotes.user_id;

  if (!paymentId) {
    return { success: true, message: 'Event ignored: no actionable payment id.' };
  }

  // Check if this payment reference was already processed (Idempotency)
  const existingTopUp = await TopUp.findOne({
    gatewayReference: String(paymentId)
  });

  if (existingTopUp && existingTopUp.status === 'verified') {
    return { success: true, message: 'Payment already processed (idempotent)', data: existingTopUp };
  }

  // Handle successful capture events
  const isSuccessEvent = ['payment.captured', 'order.paid', 'PAYMENT_SUCCESS'].includes(event) || entity.status === 'captured';

  if (isSuccessEvent && userId && amountPaise > 0) {
    let topUp = existingTopUp;
    if (!topUp) {
      topUp = await TopUp.create({
        user: userId,
        amount: amountPaise,
        status: 'verified',
        gatewayReference: String(paymentId),
        paymentMethod: 'gateway_webhook',
        verifiedAt: new Date()
      });
    } else {
      topUp.status = 'verified';
      topUp.verifiedAt = new Date();
      await topUp.save();
    }

    // Transactionally credit wallet ledger
    await recordLedgerEntry(
      userId,
      amountPaise,
      'credit',
      `Wallet deposit via Payment Gateway (${paymentId})`,
      topUp._id,
      'TopUp'
    );

    // Audit log
    await logAuditEvent({
      action: 'GATEWAY_PAYMENT_VERIFIED',
      targetModel: 'TopUp',
      targetId: topUp._id,
      changes: { status: 'verified', amount: amountPaise, gatewayReference: paymentId },
      reason: `Automated webhook event: ${event}`,
      req
    });

    // Check referral eligibility
    try {
      await triggerReferralCheckOnDeposit(topUp);
    } catch (refErr) {
      console.error('[Webhook Referral Error]', refErr.message);
    }

    return { success: true, message: 'Payment captured and wallet credited.', data: topUp };
  }

  return { success: true, message: `Event ${event} acknowledged.` };
}

module.exports = {
  verifyHmacSignature,
  verifyPaymentSignature,
  processGatewayWebhook
};

