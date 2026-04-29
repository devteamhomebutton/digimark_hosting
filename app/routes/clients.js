const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../database');
const { authenticate } = require('../middleware/auth');
const { NotFoundError } = require('../utils/errors');

function makeSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// GET /api/v1/clients
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { search, status } = req.query;
    let sql = 'SELECT id, name, slug, platforms, description, logo_url, status, created_at FROM clients WHERE is_deleted = 0';
    const params = [];
    if (search) { sql += ' AND name LIKE ?'; params.push(`%${search}%`); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY name';
    const rows = await query(sql, params);
    rows.forEach(r => { if (typeof r.platforms === 'string') r.platforms = JSON.parse(r.platforms); });
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/v1/clients
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { name, platforms = [], description, logo_url } = req.body;
    let slug = makeSlug(name);
    const existing = await queryOne('SELECT id FROM clients WHERE slug = ?', [slug]);
    if (existing) slug = `${slug}-${Date.now()}`;

    const [result] = await require('../database').pool.execute(
      'INSERT INTO clients (name, slug, platforms, description, logo_url, created_by, status, is_deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())',
      [name, slug, JSON.stringify(platforms), description || null, logo_url || null, req.user.id, 'active']
    );

    const client = await queryOne('SELECT id, name, slug, platforms, description, logo_url, status, created_at FROM clients WHERE id = ?', [result.insertId]);
    if (typeof client.platforms === 'string') client.platforms = JSON.parse(client.platforms);
    res.status(201).json(client);
  } catch (err) { next(err); }
});

// GET /api/v1/clients/:id
router.get('/:client_id', authenticate, async (req, res, next) => {
  try {
    const client = await queryOne(
      'SELECT id, name, slug, platforms, description, logo_url, status, created_at FROM clients WHERE id = ? AND is_deleted = 0',
      [req.params.client_id]
    );
    if (!client) throw new NotFoundError('Client');
    if (typeof client.platforms === 'string') client.platforms = JSON.parse(client.platforms);
    res.json(client);
  } catch (err) { next(err); }
});

// PUT /api/v1/clients/:id
router.put('/:client_id', authenticate, async (req, res, next) => {
  try {
    const client = await queryOne('SELECT id FROM clients WHERE id = ? AND is_deleted = 0', [req.params.client_id]);
    if (!client) throw new NotFoundError('Client');

    const { name, platforms, description, logo_url, status } = req.body;
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (platforms !== undefined) { updates.push('platforms = ?'); params.push(JSON.stringify(platforms)); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (logo_url !== undefined) { updates.push('logo_url = ?'); params.push(logo_url); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      params.push(req.params.client_id);
      await query(`UPDATE clients SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updated = await queryOne(
      'SELECT id, name, slug, platforms, description, logo_url, status, created_at FROM clients WHERE id = ?',
      [req.params.client_id]
    );
    if (typeof updated.platforms === 'string') updated.platforms = JSON.parse(updated.platforms);
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/v1/clients/:id
router.delete('/:client_id', authenticate, async (req, res, next) => {
  try {
    const client = await queryOne('SELECT id FROM clients WHERE id = ? AND is_deleted = 0', [req.params.client_id]);
    if (!client) throw new NotFoundError('Client');
    await query('UPDATE clients SET is_deleted = 1, updated_at = NOW() WHERE id = ?', [req.params.client_id]);
    res.json({ message: 'Client deleted' });
  } catch (err) { next(err); }
});

// GET /api/v1/clients/:id/stats
router.get('/:client_id/stats', authenticate, async (req, res, next) => {
  try {
    const client = await queryOne('SELECT id FROM clients WHERE id = ? AND is_deleted = 0', [req.params.client_id]);
    if (!client) throw new NotFoundError('Client');

    const contents = await query(
      'SELECT content_type, platform, status FROM contents WHERE client_id = ? AND is_deleted = 0',
      [req.params.client_id]
    );

    const by_type = {}, by_platform = {}, by_status = {};
    for (const c of contents) {
      by_type[c.content_type] = (by_type[c.content_type] || 0) + 1;
      by_platform[c.platform] = (by_platform[c.platform] || 0) + 1;
      by_status[c.status] = (by_status[c.status] || 0) + 1;
    }
    res.json({ total: contents.length, by_type, by_platform, by_status });
  } catch (err) { next(err); }
});

module.exports = router;
