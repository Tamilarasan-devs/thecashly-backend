const { createTenantModel } = require('./tenantModelFactory');

const rawUser = require('./User');
const rawPlan = require('./Plan');
const rawPlanSubscription = require('./PlanSubscription');
const rawPayment = require('./Payment');
const rawPayoutSchedule = require('./PayoutSchedule');
const rawWithdrawal = require('./Withdrawal');
const rawWalletLedgerEntry = require('./WalletLedgerEntry');
const rawAuditLog = require('./AuditLog');
const rawTopUp = require('./TopUp');
const rawSupportTicket = require('./SupportTicket');
const rawColorRound = require('./ColorRound');
const rawColorPrediction = require('./ColorPrediction');
const rawAviatorHistory = require('./AviatorHistory');
const rawPaymentSetting = require('./PaymentSetting');
const rawReferralReward = require('./ReferralReward');
const rawReferralSetting = require('./ReferralSetting');
const rawNotification = require('./Notification');

const User = createTenantModel('User', rawUser.schema);
const Plan = createTenantModel('Plan', rawPlan.schema);
const PlanSubscription = createTenantModel('PlanSubscription', rawPlanSubscription.schema);
const Payment = createTenantModel('Payment', rawPayment.schema);
const PayoutSchedule = createTenantModel('PayoutSchedule', rawPayoutSchedule.schema);
const Withdrawal = createTenantModel('Withdrawal', rawWithdrawal.schema);
const WalletLedgerEntry = createTenantModel('WalletLedgerEntry', rawWalletLedgerEntry.schema);
const AuditLog = createTenantModel('AuditLog', rawAuditLog.schema);
const TopUp = createTenantModel('TopUp', rawTopUp.schema);
const SupportTicket = createTenantModel('SupportTicket', rawSupportTicket.schema);
const ColorRound = createTenantModel('ColorRound', rawColorRound.schema);
const ColorPrediction = createTenantModel('ColorPrediction', rawColorPrediction.schema);
const AviatorHistory = createTenantModel('AviatorHistory', rawAviatorHistory.schema);
const PaymentSetting = createTenantModel('PaymentSetting', rawPaymentSetting.schema);
const ReferralReward = createTenantModel('ReferralReward', rawReferralReward.schema);
const ReferralSetting = createTenantModel('ReferralSetting', rawReferralSetting.schema);
const Notification = createTenantModel('Notification', rawNotification.schema);

module.exports = {
  User,
  Plan,
  PlanSubscription,
  Payment,
  PayoutSchedule,
  Withdrawal,
  WalletLedgerEntry,
  AuditLog,
  TopUp,
  SupportTicket,
  ColorRound,
  ColorPrediction,
  AviatorHistory,
  PaymentSetting,
  ReferralReward,
  ReferralSetting,
  Notification
};
