const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { queryOne } = require('../database');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 12);
}

function verifyPassword(plain, hashed) {
  return bcrypt.compareSync(plain, hashed);
}

function createAccessToken(payload) {
  return jwt.sign(
    { ...payload, type: 'access' },
    config.SECRET_KEY,
    { algorithm: config.ALGORITHM, expiresIn: `${config.ACCESS_TOKEN_EXPIRE_MINUTES}m` }
  );
}

function createRefreshToken(payload) {
  return jwt.sign(
    { ...payload, type: 'refresh' },
    config.SECRET_KEY,
    { algorithm: config.ALGORITHM, expiresIn: `${config.REFRESH_TOKEN_EXPIRE_DAYS}d` }
  );
}

function decodeToken(token) {
  try {
    return jwt.verify(token, config.SECRET_KEY, { algorithms: [config.ALGORITHM] });
  } catch {
    return null;
  }
}

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7);
    const payload = decodeToken(token);
    if (!payload || payload.type !== 'access') {
      throw new UnauthorizedError('Invalid or expired token');
    }

    const user = await queryOne(
      'SELECT id, email, full_name, role, avatar_url, is_active FROM users WHERE id = ? AND is_active = 1',
      [parseInt(payload.sub, 10)]
    );
    if (!user) {
      throw new UnauthorizedError('User not found or inactive');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError('Admin or manager required'));
    }
    next();
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  createAccessToken,
  createRefreshToken,
  decodeToken,
  authenticate,
  requireRoles,
};
