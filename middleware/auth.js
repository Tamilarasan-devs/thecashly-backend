const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { ApiError } = require('./errorHandler');

// Short-lived in-memory cache to eliminate redundant User.findById queries during parallel requests
const authUserCache = new Map();
const AUTH_CACHE_TTL_MS = 8000; // 8 seconds

const getCachedUser = async (userId) => {
  const cached = authUserCache.get(userId);
  if (cached && (Date.now() - cached.timestamp < AUTH_CACHE_TTL_MS)) {
    return cached.user;
  }
  const user = await User.findById(userId).select('-passwordHash');
  if (user) {
    authUserCache.set(userId, { user, timestamp: Date.now() });
    if (authUserCache.size > 2000) {
      const oldestKey = authUserCache.keys().next().value;
      authUserCache.delete(oldestKey);
    }
  }
  return user;
};

const invalidateAuthCache = (userId) => {
  if (userId) {
    authUserCache.delete(userId.toString());
  }
};

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
    
    req.user = await getCachedUser(decoded.id);
    
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

const optionalAuth = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_for_dev');
    const user = await User.findById(decoded.id).select('-passwordHash');
    if (user && user.status !== 'suspended') {
      req.user = user;
    }
  } catch (error) {
    // Continue without error as guest
  }
  next();
};

module.exports = { protect, authorize, optionalAuth, invalidateAuthCache };
