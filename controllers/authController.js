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
    const { name, email, password, referralCode, referral, ref } = req.body;
    
    if (!name || !name.trim()) {
      return next(new ApiError('Please enter your full name.', 400, 'name'));
    }
    if (!email || !email.trim()) {
      return next(new ApiError('Please enter your email address.', 400, 'email'));
    }
    if (!password) {
      return next(new ApiError('Please create a password.', 400, 'password'));
    }
    
    const cleanEmail = email.trim();
    const escapedEmail = cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const userExists = await User.findOne({ 
      email: { $regex: new RegExp(`^${escapedEmail}$`, 'i') } 
    });
    
    if (userExists) {
      return next(new ApiError('An account with this email address already exists. Please sign in instead.', 400, 'email'));
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
      email: cleanEmail.toLowerCase(),
      passwordHash,
      referralCode: newReferralCode,
      referredBy: referrer ? referrer._id : null,
      walletBalance: referrer ? REFERRAL_BONUS_REFEREE : 0,
    });

    // Credit referrer if referral code was used
    if (referrer) {
      referrer.walletBalance = (referrer.walletBalance || 0) + REFERRAL_BONUS_REFERRER;
      referrer.referralEarnings = (referrer.referralEarnings || 0) + REFERRAL_BONUS_REFERRER;
      await referrer.save();

      // Record ledger history for referrer and referee
      try {
        await WalletLedgerEntry.create({
          user: referrer._id,
          amount: REFERRAL_BONUS_REFERRER,
          type: 'credit',
          description: `Referral bonus for inviting ${user.name}`,
          referenceId: user._id,
          referenceModel: 'User',
          balanceType: 'wallet'
        });

        await WalletLedgerEntry.create({
          user: user._id,
          amount: REFERRAL_BONUS_REFEREE,
          type: 'credit',
          description: `Welcome bonus for using referral code ${referrer.referralCode}`,
          referenceId: referrer._id,
          referenceModel: 'User',
          balanceType: 'wallet'
        });
      } catch (ledgerErr) {
        console.error('[Referral] WalletLedgerEntry creation error:', ledgerErr);
      }
    }
    
    res.status(201).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
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
    const { email, password } = req.body;
    
    if (!email && !password) {
      return next(new ApiError('Please enter your email and password.', 400, 'all'));
    }
    if (!email || !email.trim()) {
      return next(new ApiError('Please enter your email address.', 400, 'email'));
    }
    if (!password) {
      return next(new ApiError('Please enter your password.', 400, 'password'));
    }
    
    const cleanEmail = email.trim();
    const lowerEmail = cleanEmail.toLowerCase();
    
    // Direct index match on lowercase email for <1ms query
    let user = await User.findOne({ email: lowerEmail });
    
    if (!user) {
      // Fallback to case-insensitive regex for legacy accounts
      const escapedEmail = cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      user = await User.findOne({ 
        email: { $regex: new RegExp(`^${escapedEmail}$`, 'i') } 
      });
    }
    
    if (!user) {
      return next(new ApiError('No account found with this email address. Please check your email or create an account.', 401, 'email'));
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
      .select('name email createdAt')
      .sort('-createdAt');

    const formattedReferrals = referrals.map(r => {
      const emailParts = (r.email || '').split('@');
      const prefix = emailParts[0] || '';
      const domain = emailParts[1] || '';
      const obscuredEmail = prefix.length > 2 
        ? `${prefix.slice(0, 2)}***@${domain}` 
        : `*@${domain}`;

      return {
        _id: r._id,
        name: r.name,
        email: obscuredEmail,
        createdAt: r.createdAt,
        rewardAmount: REFERRAL_BONUS_REFERRER
      };
    });

    res.json({
      success: true,
      data: {
        referralCode: user.referralCode,
        totalReferrals: referrals.length,
        totalEarnings: user.referralEarnings || (referrals.length * REFERRAL_BONUS_REFERRER),
        rewardPerReferral: REFERRAL_BONUS_REFERRER,
        refereeBonus: REFERRAL_BONUS_REFEREE,
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
