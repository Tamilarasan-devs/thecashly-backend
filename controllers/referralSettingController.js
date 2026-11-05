const { ReferralSetting } = require('../models');
const { ApiError } = require('../middleware/errorHandler');

// Helper to get or create default referral setting
const getOrCreateDefaultReferralSetting = async () => {
  let setting = await ReferralSetting.findOne().sort('-updatedAt');
  if (!setting) {
    setting = await ReferralSetting.create({
      referrerBonusRupees: 100,
      refereeBonusRupees: 100,
      description: 'Invite friends with your referral link or code to earn cash bonuses!',
      isActive: true
    });
  }
  return setting;
};

// @desc    Get active referral setting (Public / Customer Facing)
// @route   GET /api/referral-settings
// @access  Public
const getPublicReferralSetting = async (req, res, next) => {
  try {
    const setting = await getOrCreateDefaultReferralSetting();
    res.json({
      success: true,
      data: {
        referrerBonusRupees: setting.referrerBonusRupees || 100,
        refereeBonusRupees: setting.refereeBonusRupees || 100,
        description: setting.description,
        isActive: setting.isActive
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get referral setting for Admin
// @route   GET /api/admin/referral-settings
// @access  Private/Admin
const getAdminReferralSetting = async (req, res, next) => {
  try {
    const setting = await getOrCreateDefaultReferralSetting();
    res.json({
      success: true,
      data: setting
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update referral setting by Admin
// @route   PUT /api/admin/referral-settings
// @access  Private/Admin
const updateAdminReferralSetting = async (req, res, next) => {
  try {
    const { referrerBonusRupees, refereeBonusRupees, description, isActive } = req.body;

    const numReferrer = Number(referrerBonusRupees);
    const numReferee = Number(refereeBonusRupees);

    if (referrerBonusRupees !== undefined && (isNaN(numReferrer) || numReferrer < 0)) {
      return next(new ApiError('Please enter a valid referrer reward amount (0 or higher).', 400));
    }
    if (refereeBonusRupees !== undefined && (isNaN(numReferee) || numReferee < 0)) {
      return next(new ApiError('Please enter a valid referee welcome bonus amount (0 or higher).', 400));
    }

    let setting = await getOrCreateDefaultReferralSetting();

    if (referrerBonusRupees !== undefined) setting.referrerBonusRupees = numReferrer;
    if (refereeBonusRupees !== undefined) setting.refereeBonusRupees = numReferee;
    if (description !== undefined) setting.description = description.trim();
    if (isActive !== undefined) setting.isActive = Boolean(isActive === true || isActive === 'true');

    if (req.user) {
      setting.updatedBy = req.user._id;
    }

    await setting.save();

    res.json({
      success: true,
      message: 'Referral reward settings updated successfully.',
      data: setting
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOrCreateDefaultReferralSetting,
  getPublicReferralSetting,
  getAdminReferralSetting,
  updateAdminReferralSetting
};
