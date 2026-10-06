const { WalletLedgerEntry, PayoutSchedule, SupportTicket, PlanSubscription } = require('../models');
const { ApiError } = require('../middleware/errorHandler');

// @desc    Get transaction history
// @route   GET /api/services/history
// @access  Private
const getTransactionHistory = async (req, res, next) => {
  try {
    const history = await WalletLedgerEntry.find({ user: req.user._id })
      .populate('referenceId')
      .sort('-createdAt');
    res.json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
};

// @desc    Get payout schedule
// @route   GET /api/services/schedule
// @access  Private
const getPayoutSchedule = async (req, res, next) => {
  try {
    const schedule = await PayoutSchedule.find({ user: req.user._id })
      .populate({
        path: 'planSubscription',
        populate: { path: 'plan', select: 'name' }
      })
      .sort('scheduledDate');
    res.json({ success: true, data: schedule });
  } catch (error) {
    next(error);
  }
};

// @desc    Get support tickets
// @route   GET /api/services/tickets
// @access  Private
const getSupportTickets = async (req, res, next) => {
  try {
    const tickets = await SupportTicket.find({ user: req.user._id }).sort('-createdAt');
    res.json({ success: true, data: tickets });
  } catch (error) {
    next(error);
  }
};

// @desc    Create support ticket
// @route   POST /api/services/tickets
// @access  Private
const createSupportTicket = async (req, res, next) => {
  try {
    const { subject, message } = req.body;
    if (!subject || !message) {
      return next(new ApiError('Subject and message are required', 400));
    }
    
    const ticket = await SupportTicket.create({
      user: req.user._id,
      subject,
      message,
      status: 'open'
    });
    
    res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTransactionHistory,
  getPayoutSchedule,
  getSupportTickets,
  createSupportTicket
};
