const { Plan } = require('../models');
const { ApiError } = require('../middleware/errorHandler');
const { cloudinary } = require('../config/cloudinary');

// @desc    Get all plans
// @route   GET /api/plans
// @access  Public
const getPlans = async (req, res, next) => {
  try {
    // Customers only see active plans, admins see all
    const query = (req.user && req.user.role === 'admin') ? {} : { status: 'active' };
    const plans = await Plan.find(query).sort({ displayOrder: 1 });
    
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
    if (!plan) return next(new ApiError('Plan not found', 404));
    
    // Non-admins shouldn't see draft/archived plans
    if (plan.status !== 'active' && (!req.user || req.user.role !== 'admin')) {
      return next(new ApiError('Plan not found', 404));
    }
    
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
    const { name, description, initialPayment, dailyAmount, durationDays, eligibilityRules, terms, status, displayOrder } = req.body;
    
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

    const { name, description, initialPayment, dailyAmount, durationDays, eligibilityRules, terms, status, displayOrder } = req.body;

    if (name) plan.name = name;
    if (description) plan.description = description;
    if (initialPayment) plan.initialPayment = initialPayment;
    if (dailyAmount) plan.dailyAmount = dailyAmount;
    if (durationDays) plan.durationDays = durationDays;
    if (eligibilityRules) plan.eligibilityRules = eligibilityRules;
    if (terms) plan.terms = terms;
    if (status) plan.status = status;
    if (displayOrder !== undefined) plan.displayOrder = displayOrder;
    
    if (dailyAmount || durationDays) {
      plan.totalScheduled = plan.dailyAmount * plan.durationDays;
    }

    if (req.file) {
      // Delete old image from cloudinary if it exists
      if (plan.productImage && plan.productImage.publicId) {
        await cloudinary.uploader.destroy(plan.productImage.publicId);
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
  getPlan,
  createPlan,
  updatePlan,
  deletePlan
};
