const express = require('express');
const router = express.Router();
const db = require('../database');
const { query, queryOne } = db;
const { authenticate } = require('../middleware/auth');
const { NotFoundError } = require('../utils/errors');

// GET /api/v1/verticals
router.get('/verticals', authenticate, async (req, res, next) => {
  try {
    const verticals = await query(
      `SELECT v.id, v.client_id, v.name, v.color, v.sort_order, v.is_active, c.name AS client_name
       FROM verticals v JOIN clients c ON v.client_id = c.id
       WHERE v.is_active = 1 AND c.is_deleted = 0 AND c.status = 'active'
       ORDER BY v.client_id, v.sort_order`
    );
    res.json(verticals);
  } catch (err) { next(err); }
});

// GET /api/v1/clients/:client_id/verticals
router.get('/clients/:client_id/verticals', authenticate, async (req, res, next) => {
  try {
    const client = await queryOne('SELECT id FROM clients WHERE id = ? AND is_deleted = 0', [req.params.client_id]);
    if (!client) throw new NotFoundError('Client');

    const verticals = await query(
      'SELECT id, client_id, name, color, sort_order, is_active FROM verticals WHERE client_id = ? AND is_active = 1 ORDER BY sort_order',
      [req.params.client_id]
    );
    res.json(verticals);
  } catch (err) { next(err); }
});

// POST /api/v1/clients/:client_id/verticals
router.post('/clients/:client_id/verticals', authenticate, async (req, res, next) => {
  try {
    const client = await queryOne('SELECT id FROM clients WHERE id = ? AND is_deleted = 0', [req.params.client_id]);
    if (!client) throw new NotFoundError('Client');

    const { name, color = '#6366F1', sort_order = 0 } = req.body;
    const [result] = await db.pool.query(
      'INSERT INTO verticals (client_id, name, color, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, NOW(), NOW())',
      [req.params.client_id, name, color, sort_order]
    );

    const vertical = await queryOne('SELECT id, client_id, name, color, sort_order, is_active FROM verticals WHERE id = ?', [result.insertId]);
    res.status(201).json(vertical);
  } catch (err) { next(err); }
});

// PUT /api/v1/verticals/:vertical_id
router.put('/verticals/:vertical_id', authenticate, async (req, res, next) => {
  try {
    const vertical = await queryOne('SELECT id FROM verticals WHERE id = ?', [req.params.vertical_id]);
    if (!vertical) throw new NotFoundError('Vertical');

    const { name, color, sort_order, is_active } = req.body;
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (color !== undefined) { updates.push('color = ?'); params.push(color); }
    if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(sort_order); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      params.push(req.params.vertical_id);
      await query(`UPDATE verticals SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updated = await queryOne('SELECT id, client_id, name, color, sort_order, is_active FROM verticals WHERE id = ?', [req.params.vertical_id]);
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/v1/verticals/:vertical_id
router.delete('/verticals/:vertical_id', authenticate, async (req, res, next) => {
  try {
    const vertical = await queryOne('SELECT id FROM verticals WHERE id = ?', [req.params.vertical_id]);
    if (!vertical) throw new NotFoundError('Vertical');
    await query('UPDATE verticals SET is_active = 0, updated_at = NOW() WHERE id = ?', [req.params.vertical_id]);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
