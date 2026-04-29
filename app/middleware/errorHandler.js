const { AppError } = require('../utils/errors');

function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      detail: err.message,
      code: err.code,
      status_code: err.statusCode,
    });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({
    detail: 'Internal server error',
    code: 'INTERNAL_ERROR',
    status_code: 500,
  });
}

module.exports = errorHandler;
