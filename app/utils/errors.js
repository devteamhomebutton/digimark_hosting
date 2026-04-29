class AppError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

class NotFoundError extends AppError {
  constructor(resource) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 'CONFLICT', 409);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 'FORBIDDEN', 403);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Not authenticated') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 'VALIDATION_ERROR', 422);
  }
}

module.exports = { AppError, NotFoundError, ConflictError, ForbiddenError, UnauthorizedError, ValidationError };
