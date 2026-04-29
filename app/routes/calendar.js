const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../database');
const { authenticate } = require('../middleware/auth');
const { NotFoundError } = require('../utils/errors');

function contentToDict(c) {
  return {
    id: c.id,
    client_id: c.client_id,
    title: c.title,
    content_type: c.content_type,
    platform: c.platform,
    secondary_platforms: typeof c.secondary_platforms === 'string' ? JSON.parse(c.secondary_platforms || '[]') : (c.secondary_platforms || []),
    scheduled_date: c.scheduled_date,
    scheduled_time: c.scheduled_time ? String(c.scheduled_time).substring(0, 5) : null,
    description: c.description,
    caption: c.caption,
    reference_url: c.reference_url,
    status: c.status,
    task_category: c.task_category,
    vertical_id: c.vertical_id,
    created_by: c.created_by,
    owner_id: c.created_by,
    created_at: c.created_at ? new Date(c.created_at).toISOString() : null,
  };
}

// GET /api/v1/clients/:client_id/calendar
router.get('/clients/:client_id/calendar', authenticate, async (req, res, next) => {
  try {
    const { client_id } = req.params;
    const year = parseInt(req.query.year || new Date().getFullYear(), 10);
    const month = parseInt(req.query.month || (new Date().getMonth() + 1), 10);
    const { vertical_id } = req.query;

    const client = await queryOne(
      'SELECT id, name, slug, platforms FROM clients WHERE id = ? AND is_deleted = 0', [client_id]
    );
    if (!client) throw new NotFoundError('Client');
    if (typeof client.platforms === 'string') client.platforms = JSON.parse(client.platforms);

    let sql = `SELECT * FROM contents WHERE client_id = ? AND is_deleted = 0
               AND YEAR(scheduled_date) = ? AND MONTH(scheduled_date) = ?`;
    const params = [client_id, year, month];
    if (vertical_id) { sql += ' AND vertical_id = ?'; params.push(vertical_id); }
    sql += ' ORDER BY scheduled_date, scheduled_time';

    const contents = await query(sql, params);

    const calendar = {};
    const by_type = {}, by_platform = {}, by_status = {};
    for (const c of contents) {
      const dateKey = c.scheduled_date;
      if (!calendar[dateKey]) calendar[dateKey] = [];
      calendar[dateKey].push(contentToDict(c));
      by_type[c.content_type] = (by_type[c.content_type] || 0) + 1;
      by_platform[c.platform] = (by_platform[c.platform] || 0) + 1;
      by_status[c.status] = (by_status[c.status] || 0) + 1;
    }

    const verticals = await query(
      'SELECT id, name, color, sort_order FROM verticals WHERE client_id = ? AND is_active = 1 ORDER BY sort_order',
      [client_id]
    );

    res.json({
      year, month,
      client: { id: client.id, name: client.name, slug: client.slug, platforms: client.platforms },
      verticals,
      calendar,
      stats: { total: contents.length, by_type, by_platform, by_status },
    });
  } catch (err) { next(err); }
});

// GET /api/v1/clients/:client_id/calendar/:date_str
router.get('/clients/:client_id/calendar/:date_str', authenticate, async (req, res, next) => {
  try {
    const { client_id, date_str } = req.params;
    const client = await queryOne('SELECT id FROM clients WHERE id = ? AND is_deleted = 0', [client_id]);
    if (!client) throw new NotFoundError('Client');

    const contents = await query(
      'SELECT * FROM contents WHERE client_id = ? AND is_deleted = 0 AND scheduled_date = ? ORDER BY scheduled_time',
      [client_id, date_str]
    );

    const result = [];
    for (const c of contents) {
      const cDict = contentToDict(c);
      const tasks = await query(
        'SELECT id, title, stage, status, assigned_to, due_date FROM tasks WHERE content_id = ? AND is_deleted = 0 ORDER BY `order`',
        [c.id]
      );
      cDict.tasks = tasks;
      result.push(cDict);
    }

    res.json({ date: date_str, client_id: parseInt(client_id, 10), contents: result, total: result.length });
  } catch (err) { next(err); }
});

// POST /api/v1/clients/:client_id/content
router.post('/clients/:client_id/content', authenticate, async (req, res, next) => {
  try {
    const { client_id } = req.params;
    const client = await queryOne('SELECT id FROM clients WHERE id = ? AND is_deleted = 0', [client_id]);
    if (!client) throw new NotFoundError('Client');

    const { title, content_type, platform, secondary_platforms = [], scheduled_date, scheduled_time,
            description, caption, reference_url, status = 'draft', vertical_id, task_category } = req.body;

    const [result] = await require('../database').pool.query(
      `INSERT INTO contents (client_id, title, content_type, platform, secondary_platforms,
       scheduled_date, description, caption, reference_url, status, vertical_id, task_category,
       created_by, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
      [client_id, title, content_type, platform, JSON.stringify(secondary_platforms),
       scheduled_date, description || null, caption || null, reference_url || null,
       status, vertical_id || null, task_category || null, req.user.id]
    );

    const content = await queryOne('SELECT * FROM contents WHERE id = ?', [result.insertId]);
    res.status(201).json(contentToDict(content));
  } catch (err) { next(err); }
});

// GET /api/v1/content/:content_id
router.get('/content/:content_id', authenticate, async (req, res, next) => {
  try {
    const content = await queryOne('SELECT * FROM contents WHERE id = ? AND is_deleted = 0', [req.params.content_id]);
    if (!content) throw new NotFoundError('Content');

    const result = contentToDict(content);
    const tasks = await query(
      'SELECT id, title, stage, status, assigned_to, due_date, notes FROM tasks WHERE content_id = ? AND is_deleted = 0 ORDER BY `order`',
      [content.id]
    );
    result.tasks = tasks;
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/v1/content/:content_id
router.put('/content/:content_id', authenticate, async (req, res, next) => {
  try {
    const content = await queryOne('SELECT id FROM contents WHERE id = ? AND is_deleted = 0', [req.params.content_id]);
    if (!content) throw new NotFoundError('Content');

    const fields = ['title', 'content_type', 'platform', 'secondary_platforms', 'scheduled_date',
                    'description', 'caption', 'reference_url', 'status', 'vertical_id', 'task_category'];
    const updates = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(f === 'secondary_platforms' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      params.push(req.params.content_id);
      await query(`UPDATE contents SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updated = await queryOne('SELECT * FROM contents WHERE id = ?', [req.params.content_id]);
    res.json(contentToDict(updated));
  } catch (err) { next(err); }
});

// DELETE /api/v1/content/:content_id
router.delete('/content/:content_id', authenticate, async (req, res, next) => {
  try {
    const content = await queryOne('SELECT id FROM contents WHERE id = ? AND is_deleted = 0', [req.params.content_id]);
    if (!content) throw new NotFoundError('Content');
    await query('UPDATE contents SET is_deleted = 1, updated_at = NOW() WHERE id = ?', [req.params.content_id]);
    res.json({ message: 'Content deleted' });
  } catch (err) { next(err); }
});

// PATCH /api/v1/content/:content_id/status
router.patch('/content/:content_id/status', authenticate, async (req, res, next) => {
  try {
    const content = await queryOne('SELECT id FROM contents WHERE id = ? AND is_deleted = 0', [req.params.content_id]);
    if (!content) throw new NotFoundError('Content');
    await query('UPDATE contents SET status = ?, updated_at = NOW() WHERE id = ?', [req.body.status, req.params.content_id]);
    res.json({ id: parseInt(req.params.content_id, 10), status: req.body.status });
  } catch (err) { next(err); }
});

module.exports = router;
