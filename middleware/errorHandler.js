function errorHandler(err, req, res, next) {
  console.error('[Error]', err);
  
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  const responseBody = {
    success: false,
    error: message,
  };

  if (err.field) {
    responseBody.field = err.field;
  }

  if (process.env.NODE_ENV === 'development' && err.stack) {
    responseBody.stack = err.stack;
  }

  res.status(statusCode).json(responseBody);
}

class ApiError extends Error {
  constructor(message, statusCode, field = null) {
    super(message);
    this.statusCode = statusCode;
    this.field = field;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { errorHandler, ApiError };
