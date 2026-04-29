const express = require('express');
const multer = require('multer');
const router = express.Router();
const config = require('../config');
const { query, queryOne } = require('../database');
const { hashPassword, verifyPassword, createAccessToken, createRefreshToken, decodeToken, authenticate } = require('../middleware/auth');
const { ConflictError, UnauthorizedError } = require('../utils/errors');

const upload = multer();

// POST /auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, full_name, role } = req.body;
    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) throw new ConflictError('Email already registered');

    const validRoles = ['admin', 'manager', 'sm_specialist', 'seo_specialist', 'graphic_designer', 'team_member'];
    const userRole = validRoles.includes(role) ? role : 'team_member';

    const hashed = hashPassword(password);
    const [result] = await require('../database').pool.query(
      'INSERT INTO users (email, hashed_password, full_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, NOW(), NOW())',
      [email, hashed, full_name, userRole]
    );

    const user = await queryOne('SELECT id, email, full_name, role, avatar_url, is_active FROM users WHERE id = ?', [result.insertId]);
    res.status(201).json(user);
  } catch (err) { next(err); }
});

// POST /auth/login (accepts both JSON and multipart form data)
router.post('/login', upload.none(), async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const user = await queryOne(
      'SELECT id, email, full_name, role, avatar_url, is_active, hashed_password FROM users WHERE email = ? AND is_active = 1',
      [username]
    );
    if (!user || !verifyPassword(password, user.hashed_password)) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const accessToken = createAccessToken({ sub: String(user.id) });
    const refreshToken = createRefreshToken({ sub: String(user.id) });

    const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_EXPIRE_DAYS * 86400000);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at, is_revoked, created_at, updated_at) VALUES (?, ?, ?, 0, NOW(), NOW())',
      [user.id, refreshToken, expiresAt]
    );

    res.json({ access_token: accessToken, refresh_token: refreshToken, token_type: 'bearer' });
  } catch (err) { next(err); }
});

// POST /auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    const payload = decodeToken(refresh_token);
    if (!payload || payload.type !== 'refresh') {
      throw new UnauthorizedError('Invalid refresh token');
    }

    const dbToken = await queryOne(
      'SELECT id FROM refresh_tokens WHERE token = ? AND is_revoked = 0',
      [refresh_token]
    );
    if (!dbToken) throw new UnauthorizedError('Refresh token not found or revoked');

    const userId = parseInt(payload.sub, 10);
    const accessToken = createAccessToken({ sub: String(userId) });
    const newRefresh = createRefreshToken({ sub: String(userId) });

    await query('UPDATE refresh_tokens SET is_revoked = 1, updated_at = NOW() WHERE token = ?', [refresh_token]);

    const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_EXPIRE_DAYS * 86400000);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at, is_revoked, created_at, updated_at) VALUES (?, ?, ?, 0, NOW(), NOW())',
      [userId, newRefresh, expiresAt]
    );

    res.json({ access_token: accessToken, refresh_token: newRefresh, token_type: 'bearer' });
  } catch (err) { next(err); }
});

// POST /auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    await query(
      'UPDATE refresh_tokens SET is_revoked = 1, updated_at = NOW() WHERE token = ? AND user_id = ?',
      [refresh_token, req.user.id]
    );
    res.json({ message: 'Logged out successfully' });
  } catch (err) { next(err); }
});

// GET /auth/me
router.get('/me', authenticate, async (req, res) => {
  res.json(req.user);
});

// PUT /auth/me
router.put('/me', authenticate, async (req, res, next) => {
  try {
    const { full_name, avatar_url } = req.body;
    const updates = [];
    const params = [];
    if (full_name !== undefined) { updates.push('full_name = ?'); params.push(full_name); }
    if (avatar_url !== undefined) { updates.push('avatar_url = ?'); params.push(avatar_url); }
    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      params.push(req.user.id);
      await query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    const user = await queryOne('SELECT id, email, full_name, role, avatar_url, is_active FROM users WHERE id = ?', [req.user.id]);
    res.json(user);
  } catch (err) { next(err); }
});

module.exports = router;
