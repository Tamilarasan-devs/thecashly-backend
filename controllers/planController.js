const { Plan } = require('../models');
const { ApiError } = require('../middleware/errorHandler');
const { cloudinary } = require('../config/cloudinary');

// @desc    Get all plans
// @route   GET /api/plans
// @access  Public
const getPlans = async (req, res, next) => {
  try {
    // All non-archived plans are returned: active ones show clearly, hidden ones show with blur effect
    const plans = await Plan.find({ status: { $ne: 'archived' } }).sort({ displayOrder: 1, createdAt: -1 });
    res.json({ success: true, data: plans });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all plans for admin management (active, draft, hidden)
// @route   GET /api/plans/admin
// @access  Private/Admin
const getAdminPlans = async (req, res, next) => {
  try {
    const plans = await Plan.find({ status: { $ne: 'archived' } }).sort({ displayOrder: 1, createdAt: -1 });
    res.json({ success: true, data: plans });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single plan
// @route   GET /api/plans/:id
// @access  Public
const getPlan = async (req, res, next) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan || plan.status === 'archived') return next(new ApiError('Plan not found', 404));
    
    res.json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new plan
// @route   POST /api/plans
// @access  Private/Admin
const createPlan = async (req, res, next) => {
  try {
    const {
      name,
      description,
      initialPayment,
      dailyAmount,
      durationDays,
      eligibilityRules,
      terms,
      status,
      displayOrder,
      planType,
      isSpecial,
      isComingSoon,
      badgeText
    } = req.body;
    
    let resolvedType = planType || 'regular';
    if (isSpecial === 'true' || isSpecial === true) resolvedType = 'special';
    if (isComingSoon === 'true' || isComingSoon === true) resolvedType = 'coming_soon';

    const planData = {
      name,
      description,
      initialPayment,
      dailyAmount,
      durationDays,
      totalScheduled: Number(dailyAmount) * Number(durationDays),
      eligibilityRules,
      terms,
      status: status || 'draft',
      planType: resolvedType,
      isSpecial: resolvedType === 'special',
      isComingSoon: resolvedType === 'coming_soon',
      badgeText: badgeText || '',
      displayOrder: displayOrder || 0
    };

    if (req.file) {
      planData.productImage = {
        url: req.file.path,
        publicId: req.file.filename
      };
    }

    const plan = await Plan.create(planData);
    res.status(201).json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
};

// @desc    Update plan
// @route   PUT /api/plans/:id
// @access  Private/Admin
const updatePlan = async (req, res, next) => {
  try {
    let plan = await Plan.findById(req.params.id);
    if (!plan) return next(new ApiError('Plan not found', 404));

    const {
      name,
      description,
      initialPayment,
      dailyAmount,
      durationDays,
      eligibilityRules,
      terms,
      status,
      displayOrder,
      planType,
      isSpecial,
      isComingSoon,
      badgeText
    } = req.body;

    if (name) plan.name = name;
    if (description) plan.description = description;
    if (initialPayment) plan.initialPayment = initialPayment;
    if (dailyAmount) plan.dailyAmount = dailyAmount;
    if (durationDays) plan.durationDays = durationDays;
    if (eligibilityRules) plan.eligibilityRules = eligibilityRules;
    if (terms) plan.terms = terms;
    if (status) plan.status = status;
    if (displayOrder !== undefined) plan.displayOrder = displayOrder;
    
    if (planType !== undefined || isSpecial !== undefined || isComingSoon !== undefined) {
      let resolvedType = planType || plan.planType || 'regular';
      if (isSpecial === 'true' || isSpecial === true) resolvedType = 'special';
      if (isComingSoon === 'true' || isComingSoon === true) resolvedType = 'coming_soon';
      if (isSpecial === 'false' && plan.planType === 'special') resolvedType = 'regular';
      if (isComingSoon === 'false' && plan.planType === 'coming_soon') resolvedType = 'regular';

      plan.planType = resolvedType;
      plan.isSpecial = resolvedType === 'special';
      plan.isComingSoon = resolvedType === 'coming_soon';
    }
    if (badgeText !== undefined) plan.badgeText = badgeText;

    if (dailyAmount || durationDays) {
      plan.totalScheduled = plan.dailyAmount * plan.durationDays;
    }

    if (req.file) {
      // Delete old image from cloudinary if it exists (safely ignore if not found or from prior account)
      if (plan.productImage && plan.productImage.publicId) {
        try {
          await cloudinary.uploader.destroy(plan.productImage.publicId);
        } catch (delErr) {
          console.warn('Could not destroy old cloudinary image:', delErr.message);
        }
      }
      
      plan.productImage = {
        url: req.file.path,
        publicId: req.file.filename
      };
    }

    await plan.save();
    res.json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete/Archive plan
// @route   DELETE /api/plans/:id
// @access  Private/Admin
const deletePlan = async (req, res, next) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) return next(new ApiError('Plan not found', 404));

    // Instead of deleting (which breaks foreign keys), we archive it.
    plan.status = 'archived';
    await plan.save();

    res.json({ success: true, data: {} });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPlans,
  getAdminPlans,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan
};
