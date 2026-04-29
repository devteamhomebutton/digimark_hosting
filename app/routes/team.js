const express = require('express');
const router = express.Router();
const db = require('../database');
const { query, queryOne } = db;
const { authenticate, hashPassword } = require('../middleware/auth');
const { NotFoundError, ConflictError } = require('../utils/errors');

// GET /api/v1/team
router.get('/', authenticate, async (req, res, next) => {
  try {
    const users = await query(
      'SELECT id, email, full_name, role, avatar_url, is_active, created_at FROM users WHERE is_active = 1 ORDER BY full_name'
    );
    res.json(users);
  } catch (err) { next(err); }
});

// POST /api/v1/team/invite
router.post('/invite', authenticate, async (req, res, next) => {
  try {
    const { email, full_name, role = 'team_member', password = 'changeme123' } = req.body;
    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) throw new ConflictError('Email already registered');

    const validRoles = ['admin', 'manager', 'sm_specialist', 'seo_specialist', 'graphic_designer', 'team_member'];
    const userRole = validRoles.includes(role) ? role : 'team_member';

    const [result] = await db.pool.query(
      'INSERT INTO users (email, hashed_password, full_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, NOW(), NOW())',
      [email, hashPassword(password), full_name, userRole]
    );

    const user = await queryOne(
      'SELECT id, email, full_name, role, avatar_url, is_active, created_at FROM users WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(user);
  } catch (err) { next(err); }
});

// PUT /api/v1/team/:user_id/role
router.put('/:user_id/role', authenticate, async (req, res, next) => {
  try {
    const user = await queryOne('SELECT id FROM users WHERE id = ?', [req.params.user_id]);
    if (!user) throw new NotFoundError('User');
    await query('UPDATE users SET role = ?, updated_at = NOW() WHERE id = ?', [req.body.role, req.params.user_id]);
    const updated = await queryOne(
      'SELECT id, email, full_name, role, avatar_url, is_active, created_at FROM users WHERE id = ?',
      [req.params.user_id]
    );
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/v1/team/:user_id/status
router.patch('/:user_id/status', authenticate, async (req, res, next) => {
  try {
    const user = await queryOne('SELECT id, is_active FROM users WHERE id = ?', [req.params.user_id]);
    if (!user) throw new NotFoundError('User');
    const newStatus = user.is_active ? 0 : 1;
    await query('UPDATE users SET is_active = ?, updated_at = NOW() WHERE id = ?', [newStatus, req.params.user_id]);
    res.json({ id: parseInt(req.params.user_id, 10), is_active: !!newStatus });
  } catch (err) { next(err); }
});

// DELETE /api/v1/team/:user_id
router.delete('/:user_id', authenticate, async (req, res, next) => {
  try {
    const user = await queryOne('SELECT id FROM users WHERE id = ?', [req.params.user_id]);
    if (!user) throw new NotFoundError('User');
    await query('UPDATE users SET is_active = 0, updated_at = NOW() WHERE id = ?', [req.params.user_id]);
    res.json({ message: 'Member removed' });
  } catch (err) { next(err); }
});

module.exports = router;
