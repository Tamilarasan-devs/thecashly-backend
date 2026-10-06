const express = require('express');
const router = express.Router();
const { getPlans, getPlan, createPlan, updatePlan, deletePlan } = require('../controllers/planController');
const { protect, authorize } = require('../middleware/auth');
const { upload } = require('../config/cloudinary');

// Optional protect middleware for getting plans (so unauthenticated users can't see them if we want to lock down the app)
// The controller handles showing active vs all plans based on req.user

router.route('/')
  .get(getPlans)
  .post(protect, authorize('admin'), upload.single('image'), createPlan);

router.route('/:id')
  .get(getPlan)
  .put(protect, authorize('admin'), upload.single('image'), updatePlan)
  .delete(protect, authorize('admin'), deletePlan);

module.exports = router;
