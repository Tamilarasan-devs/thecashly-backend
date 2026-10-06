const express = require('express');
const router = express.Router();
const { 
  createWithdrawalRequest, 
  getUserWithdrawals, 
  getAllWithdrawals, 
  approveWithdrawalRequest, 
  rejectWithdrawalRequest 
} = require('../controllers/withdrawalController');
const { protect, authorize } = require('../middleware/auth');

router.post('/request', protect, createWithdrawalRequest);
router.get('/', protect, getUserWithdrawals);

router.get('/admin', protect, authorize('admin'), getAllWithdrawals);
router.post('/:id/approve', protect, authorize('admin'), approveWithdrawalRequest);
router.post('/:id/reject', protect, authorize('admin'), rejectWithdrawalRequest);

module.exports = router;
