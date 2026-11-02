const express = require('express');
const router = express.Router();
const { 
  createWithdrawalRequest, 
  updateUserBankDetailsController,
  getUserWithdrawals, 
  getAllWithdrawals, 
  approveWithdrawalRequest, 
  rejectWithdrawalRequest,
  createManualWithdrawalStatement,
  getManualWithdrawalStatements
} = require('../controllers/withdrawalController');
const { protect, authorize } = require('../middleware/auth');

router.post('/request', protect, createWithdrawalRequest);
router.put('/bank-details', protect, updateUserBankDetailsController);
router.get('/', protect, getUserWithdrawals);

router.get('/admin', protect, authorize('admin'), getAllWithdrawals);
router.get('/admin/manual-statements', protect, authorize('admin'), getManualWithdrawalStatements);
router.post('/admin/manual-statement', protect, authorize('admin'), createManualWithdrawalStatement);
router.post('/:id/approve', protect, authorize('admin'), approveWithdrawalRequest);
router.post('/:id/reject', protect, authorize('admin'), rejectWithdrawalRequest);

module.exports = router;
