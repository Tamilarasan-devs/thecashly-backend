const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { ApiError } = require('./errorHandler');

const protect = async (req, res, next) => {
  let token;
  
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  
  if (!token) {
    return next(new ApiError('Not authorized, no token provided', 401));
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_for_dev');
    
    req.user = await User.findById(decoded.id).select('-passwordHash');
    
    if (!req.user) {
      return next(new ApiError('User not found', 404));
    }
    
    if (req.user.status === 'suspended') {
      return next(new ApiError(`Account suspended: ${req.user.suspendReason}`, 403));
    }
    
    next();
  } catch (error) {
    return next(new ApiError('Not authorized, token failed', 401));
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(`User role ${req.user ? req.user.role : 'unknown'} is not authorized to access this route`, 403));
    }
    next();
  };
};

module.exports = { protect, authorize };
