const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, WalletLedgerEntry } = require('../models');
const { ApiError } = require('../middleware/errorHandler');
const { generateUniqueReferralCode } = require('../utils/referral');

const REFERRAL_BONUS_REFERRER = 10000; // ₹100.00 in paise
const REFERRAL_BONUS_REFEREE = 10000;  // ₹100.00 in paise (100 rupees welcome bonus)

const generateToken = (id) => {
  return jwt.sign({ id: id.toString() }, process.env.JWT_SECRET || 'fallback_secret_for_dev', {
    expiresIn: '7d',
  });
};

const registerUser = async (req, res, next) => {
  try {
    const { name, phone, email, password, referralCode, referral, ref } = req.body;
    
    if (!name || !name.trim()) {
      return next(new ApiError('Please enter your full name.', 400, 'name'));
    }

    const rawPhone = (phone || req.body.mobile || req.body.mobileNumber || '').toString().trim();
    if (!rawPhone) {
      return next(new ApiError('Please enter your 10-digit phone number.', 400, 'phone'));
    }
    const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
    if (cleanPhone.length !== 10) {
      return next(new ApiError('Please enter a valid 10-digit phone number.', 400, 'phone'));
    }

    if (!password) {
      return next(new ApiError('Please create a password.', 400, 'password'));
    }
    
    const userExists = await User.findOne({ phone: cleanPhone });
    if (userExists) {
      return next(new ApiError('An account with this phone number already exists. Please sign in instead.', 400, 'phone'));
    }

    // Check referral code if provided
    let referrer = null;
    const providedCode = (referralCode || referral || ref || '').toString().trim().toUpperCase();
    if (providedCode) {
      referrer = await User.findOne({ referralCode: providedCode });
      if (!referrer) {
        return next(new ApiError('Invalid referral code. Please check your code or leave it blank.', 400, 'referralCode'));
      }
    }
    
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    
    const newReferralCode = await generateUniqueReferralCode(User);

    const user = await User.create({
      name: name.trim(),
      phone: cleanPhone,
      email: email ? email.trim().toLowerCase() : undefined,
      passwordHash,
      referralCode: newReferralCode,
      referredBy: referrer ? referrer._id : null,
      walletBalance: 0,
    });
    
    res.status(201).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
        referralCode: user.referralCode,
        walletBalance: user.walletBalance,
        token: generateToken(user._id)
      }
    });
  } catch (error) {
    next(error);
  }
};

const loginUser = async (req, res, next) => {
  try {
    const { phone, email, password } = req.body;
    const rawIdentifier = (phone || req.body.mobile || req.body.mobileNumber || email || '').toString().trim();
    
    if (!rawIdentifier && !password) {
      return next(new ApiError('Please enter your phone number and password.', 400, 'all'));
    }
    if (!rawIdentifier) {
      return next(new ApiError('Please enter your phone number.', 400, 'phone'));
    }
    if (!password) {
      return next(new ApiError('Please enter your password.', 400, 'password'));
    }
    
    // Normalize phone number (strip non-digits, keep last 10 digits)
    const cleanPhone = rawIdentifier.replace(/\D/g, '').slice(-10);
    
    let user = null;
    if (cleanPhone.length === 10) {
      user = await User.findOne({ phone: cleanPhone });
    }
    
    // Fallback: in case an existing user logs in with an email or legacy phone formatting
    if (!user && rawIdentifier.includes('@')) {
      const lowerEmail = rawIdentifier.toLowerCase();
      user = await User.findOne({ email: lowerEmail });
    } else if (!user) {
      user = await User.findOne({ 
        $or: [
          { phone: rawIdentifier },
          { phone: cleanPhone }
        ]
      });
    }

    // Cross-tenant fallback: in case the user registered in the primary/default database
    if (!user) {
      const { connections } = require('../config/dbManager');
      const otherConn = connections.earnbuddy && connections.thecashly 
        ? (req.tenant === 'earnbuddy' ? connections.thecashly : connections.earnbuddy)
        : null;
      if (otherConn) {
        const rawUserModel = otherConn.models['User'] || otherConn.model('User', User.schema);
        if (cleanPhone.length === 10) {
          user = await rawUserModel.findOne({ phone: cleanPhone });
        }
        if (!user && rawIdentifier.includes('@')) {
          user = await rawUserModel.findOne({ email: rawIdentifier.toLowerCase() });
        } else if (!user) {
          user = await rawUserModel.findOne({
            $or: [{ phone: rawIdentifier }, { phone: cleanPhone }]
          });
        }
      }
    }
    
    if (!user) {
      return next(new ApiError('No account found with this phone number. Please check your number or create an account.', 401, 'phone'));
    }
    
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return next(new ApiError('Incorrect password. Please verify your password and try again.', 401, 'password'));
    }
    
    if (user.status === 'suspended') {
      return next(new ApiError(`Account suspended: ${user.suspendReason || 'Please contact customer support.'}`, 403, 'general'));
    }

    if (!user.referralCode) {
      user.referralCode = await generateUniqueReferralCode(User);
      await user.save();
    }
    
    res.json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
        referralCode: user.referralCode,
        walletBalance: user.walletBalance,
        token: generateToken(user._id)
      }
    });
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res, next) => {
  try {
    let user = req.user;
    if (!user.referralCode) {
      user.referralCode = await generateUniqueReferralCode(User);
      await user.save();
    }
    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
};

const validateReferralCode = async (req, res, next) => {
  try {
    const { code } = req.params;
    if (!code || !code.trim()) {
      return res.json({ success: false, valid: false, message: 'Please enter a referral code.' });
    }
    const cleanCode = code.trim().toUpperCase();
    const referrer = await User.findOne({ referralCode: cleanCode });
    if (!referrer) {
      return res.json({ success: false, valid: false, message: 'Invalid referral code.' });
    }
    return res.json({
      success: true,
      valid: true,
      data: {
        code: cleanCode,
        referrerName: referrer.name
      }
    });
  } catch (error) {
    next(error);
  }
};

const getReferralStats = async (req, res, next) => {
  try {
    const userId = req.user._id;
    let user = await User.findById(userId);
    if (!user) {
      return next(new ApiError('User not found', 404));
    }
    if (!user.referralCode) {
      user.referralCode = await generateUniqueReferralCode(User);
      await user.save();
    }

    const referrals = await User.find({ referredBy: userId })
      .select('name phone email createdAt')
      .sort('-createdAt');

    const { ReferralReward, ReferralSetting, TopUp } = require('../models');
    let dynamicReferrerBonus = REFERRAL_BONUS_REFERRER;
    let dynamicRefereeBonus = REFERRAL_BONUS_REFEREE;
    try {
      const refSetting = await ReferralSetting.findOne().sort('-updatedAt');
      if (refSetting) {
        if (refSetting.referrerBonusRupees !== undefined) {
          dynamicReferrerBonus = Math.round(refSetting.referrerBonusRupees * 100);
        }
        if (refSetting.refereeBonusRupees !== undefined) {
          dynamicRefereeBonus = Math.round(refSetting.refereeBonusRupees * 100);
        }
      }
    } catch (sErr) {
      // Fallback to defaults
    }

    // Check if the current user (referrer) has made at least one verified deposit
    const userDepositCount = await TopUp.countDocuments({
      user: userId,
      status: 'verified'
    });
    const isEligibleToEarn = userDepositCount > 0;

    const rewards = await ReferralReward.find({ referrer: userId }).lean();
    const rewardsMap = new Map();
    rewards.forEach(rw => {
      rewardsMap.set(String(rw.referredUser), rw);
    });

    const formattedReferrals = referrals.map(r => {
      const userPhone = r.phone || '';
      const obscuredPhone = userPhone.length >= 10 
        ? `${userPhone.slice(0, 2)}******${userPhone.slice(-2)}` 
        : userPhone || 'Verified User';

      const rewardInfo = rewardsMap.get(String(r._id));
      const hasDeposited = Boolean(rewardInfo);
      const isRewardPaid = Boolean(rewardInfo && rewardInfo.referrerRewardAmount > 0);
      const rewardAmount = isRewardPaid ? rewardInfo.referrerRewardAmount : 0;

      let status = 'Registered (No Deposit)';
      if (isRewardPaid) {
        status = 'Reward Credited';
      } else if (hasDeposited) {
        if (!isEligibleToEarn) {
          status = 'Deposit Required by You to Unlock';
        } else {
          status = 'Deposit Under Review';
        }
      }

      return {
        _id: r._id,
        name: r.name,
        phone: obscuredPhone,
        email: obscuredPhone, // For backward compatibility with any frontends expecting identifier
        createdAt: r.createdAt,
        hasDeposited,
        isRewardPaid,
        status,
        rewardAmount: rewardAmount || 0
      };
    });

    res.json({
      success: true,
      data: {
        referralCode: user.referralCode,
        isEligibleToEarn,
        hasDeposited: isEligibleToEarn,
        totalReferrals: referrals.length,
        totalEarnings: user.referralEarnings || 0,
        rewardPerReferral: dynamicReferrerBonus,
        refereeBonus: dynamicRefereeBonus,
        referrals: formattedReferrals
      }
    });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return next(new ApiError('User not found', 404));
    }
    
    if (req.body.name) user.name = req.body.name.trim();
    if (req.body.phone || req.body.mobile || req.body.mobileNumber) {
      const rawP = (req.body.phone || req.body.mobile || req.body.mobileNumber).toString().trim();
      const cleanP = rawP.replace(/\D/g, '').slice(-10);
      if (cleanP.length !== 10) {
        return next(new ApiError('Please enter a valid 10-digit phone number', 400));
      }
      const existing = await User.findOne({ phone: cleanP, _id: { $ne: user._id } });
      if (existing) {
        return next(new ApiError('Phone number is already registered to another account', 400));
      }
      user.phone = cleanP;
    }
    if (req.body.email) {
      const email = req.body.email.trim().toLowerCase();
      const existing = await User.findOne({ email, _id: { $ne: user._id } });
      if (existing) {
        return next(new ApiError('Email address is already in use by another account', 400));
      }
      user.email = email;
    }
    if (req.body.avatar) user.avatar = req.body.avatar;
    if (req.body.payoutDetails) {
      user.payoutDetails = {
        ...(user.payoutDetails || {}),
        ...req.body.payoutDetails,
        updatedAt: new Date()
      };
    }
    
    // Change password if provided
    if (req.body.currentPassword && req.body.newPassword) {
      const isMatch = await bcrypt.compare(req.body.currentPassword, user.passwordHash);
      if (!isMatch) {
        return next(new ApiError('Current password is incorrect', 400));
      }
      if (req.body.newPassword.length < 6) {
        return next(new ApiError('New password must be at least 6 characters long', 400));
      }
      user.passwordHash = await bcrypt.hash(req.body.newPassword, 10);
    }
    
    await user.save();
    
    const safeUser = user.toObject();
    delete safeUser.passwordHash;
    
    res.json({
      success: true,
      data: safeUser
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerUser,
  loginUser,
  getMe,
  updateProfile,
  validateReferralCode,
  getReferralStats
};
