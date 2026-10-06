const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { processPayouts } = require('../jobs/payoutJob');
const { User, SupportTicket, PlanSubscription, Withdrawal, TopUp } = require('../models');

// Admin: Get Dashboard Stats
router.get('/stats', protect, authorize('admin'), async (req, res, next) => {
  try {
    const totalUsers = await User.countDocuments({ role: 'customer' });
    const activePlans = await PlanSubscription.countDocuments({ status: 'active' });
    const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'requested' });
    
    const topUps = await TopUp.aggregate([
      { $match: { status: 'verified' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalDeposits = topUps.length > 0 ? topUps[0].total : 0;
    
    res.json({
      success: true,
      data: {
        totalUsers,
        activePlans,
        pendingWithdrawals,
        totalDeposits
      }
    });
  } catch (err) {
    next(err);
  }
});

// Admin endpoint to manually trigger cron
router.post('/trigger-payouts', protect, authorize('admin'), async (req, res, next) => {
  try {
    const result = await processPayouts();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Admin: Get all users
router.get('/users', protect, authorize('admin'), async (req, res, next) => {
  try {
    const users = await User.find({}).select('-passwordHash').sort('-createdAt');
    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
});

// Admin: Get all tickets
router.get('/tickets', protect, authorize('admin'), async (req, res, next) => {
  try {
    const tickets = await SupportTicket.find({}).populate('user', 'name email').sort('-createdAt');
    res.json({ success: true, data: tickets });
  } catch (err) {
    next(err);
  }
});

// Admin: Update ticket status
router.put('/tickets/:id', protect, authorize('admin'), async (req, res, next) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    
    if (req.body.status) ticket.status = req.body.status;
    
    // Add admin response if provided
    if (req.body.responseMessage) {
      ticket.responses.push({
        sender: 'admin',
        message: req.body.responseMessage
      });
    }
    
    await ticket.save();
    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
});

const { getAllTopUps } = require('../controllers/topUpController');

// Admin: Get all top ups
router.get('/topups', protect, authorize('admin'), getAllTopUps);

module.exports = router;
