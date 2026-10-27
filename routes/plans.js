const express = require('express');
const router = express.Router();
const { getPlans, getAdminPlans, getPlan, createPlan, updatePlan, deletePlan } = require('../controllers/planController');
const { protect, authorize, optionalAuth } = require('../middleware/auth');
const { upload } = require('../config/cloudinary');

// Admin-only route to retrieve all plans (active, draft, hidden)
router.get('/admin', protect, authorize('admin'), getAdminPlans);

router.route('/')
  .get(optionalAuth, getPlans)
  .post(protect, authorize('admin'), upload.single('image'), createPlan);

router.route('/:id')
  .get(optionalAuth, getPlan)
  .put(protect, authorize('admin'), upload.single('image'), updatePlan)
  .delete(protect, authorize('admin'), deletePlan);

module.exports = router;
