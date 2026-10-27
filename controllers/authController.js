const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { ApiError } = require('../middleware/errorHandler');

const generateToken = (id) => {
  return jwt.sign({ id: id.toString() }, process.env.JWT_SECRET || 'fallback_secret_for_dev', {
    expiresIn: '7d',
  });
};

const registerUser = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    
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
    
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    
    const user = await User.create({
      name: name.trim(),
      email: cleanEmail.toLowerCase(),
      passwordHash,
    });
    
    res.status(201).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
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
    const escapedEmail = cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    const user = await User.findOne({ 
      email: { $regex: new RegExp(`^${escapedEmail}$`, 'i') } 
    });
    
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
    
    res.json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        token: generateToken(user._id)
      }
    });
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: req.user
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
  updateProfile
};
