const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const db = require('../database');
const { query, queryOne } = db;
const { authenticate } = require('../middleware/auth');
const { NotFoundError } = require('../utils/errors');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const CONTENT_TYPES = ['static_post', 'carousel', 'reel', 'story', 'informative_video', 'founder_video', 'podcast', 'testimonial', 'employee_generated', 'promotional_poster', 'event_story', 'public_opinion', 'poster'];
const PLATFORMS = ['instagram', 'facebook', 'youtube', 'linkedin', 'twitter'];
const STATUSES = ['draft', 'scripting', 'shooting', 'editing', 'design', 'review', 'pending_approval', 'approved', 'scheduled', 'published', 'rejected'];

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s.trim());
  if (isNaN(d)) return null;
  return d.toISOString().split('T')[0];
}

// GET /api/v1/import/content/template
router.get('/import/content/template', authenticate, (req, res) => {
  const csv = stringify([
    ['title', 'content_type', 'platform', 'scheduled_date', 'status', 'description', 'vertical_name'],
    ['Q2 Campaign Launch', 'static_post', 'instagram', '2026-05-01', 'draft', 'Caption goes here', 'Brand'],
    ['Product Reel', 'reel', 'instagram', '2026-05-03', 'draft', '', 'Product'],
  ]);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=content_calendar_template.csv');
  res.send(csv);
});

// POST /api/v1/import/content/:client_id
router.post('/import/content/:client_id', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    const client = await queryOne('SELECT id FROM clients WHERE id = ? AND is_deleted = 0', [req.params.client_id]);
    if (!client) throw new NotFoundError('Client');

    // Build vertical lookup
    const verts = await query('SELECT id, LOWER(name) AS name FROM verticals WHERE client_id = ? AND is_active = 1', [req.params.client_id]);
    const vertMap = {};
    for (const v of verts) vertMap[v.name] = v.id;

    const raw = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
    const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
    let created = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const title = (row.title || '').trim();
      if (!title) { errors.push({ row: rowNum, message: 'title is required' }); continue; }

      const ct = (row.content_type || '').trim().toLowerCase();
      if (!CONTENT_TYPES.includes(ct)) { errors.push({ row: rowNum, message: `invalid content_type '${ct}'. Valid: ${CONTENT_TYPES.join(', ')}` }); continue; }

      const plat = (row.platform || '').trim().toLowerCase();
      if (!PLATFORMS.includes(plat)) { errors.push({ row: rowNum, message: `invalid platform '${plat}'. Valid: ${PLATFORMS.join(', ')}` }); continue; }

      const scheduledDate = parseDate(row.scheduled_date);
      if (!scheduledDate) { errors.push({ row: rowNum, message: `invalid scheduled_date '${row.scheduled_date}'. Expected YYYY-MM-DD` }); continue; }

      const rawStatus = (row.status || 'draft').trim().toLowerCase();
      const status = STATUSES.includes(rawStatus) ? rawStatus : 'draft';
      const description = row.description || null;
      const verticalName = (row.vertical_name || '').trim().toLowerCase();
      const verticalId = vertMap[verticalName] || null;

      await db.pool.query(
        `INSERT INTO contents (client_id, title, content_type, platform, secondary_platforms, scheduled_date,
         status, description, vertical_id, created_by, is_deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
        [req.params.client_id, title, ct, plat, scheduledDate, status, description, verticalId, req.user.id]
      );
      created++;
    }

    res.json({ created, errors, total_rows: rows.length });
  } catch (err) { next(err); }
});

// GET /api/v1/import/tasks/general/template
router.get('/import/tasks/general/template', authenticate, (req, res) => {
  const csv = stringify([
    ['title', 'category', 'due_date', 'assigned_to_email', 'notes'],
    ['Competitor analysis', 'Research', '2026-05-15', 'team@agency.com', 'Focus on Q2'],
    ['Design brand guidelines', 'Graphic Design', '2026-05-20', '', ''],
  ]);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=general_tasks_template.csv');
  res.send(csv);
});

// POST /api/v1/import/tasks/general/:client_id
router.post('/import/tasks/general/:client_id', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    const client = await queryOne('SELECT id FROM clients WHERE id = ? AND is_deleted = 0', [req.params.client_id]);
    if (!client) throw new NotFoundError('Client');

    const users = await query('SELECT id, LOWER(email) AS email FROM users WHERE is_active = 1');
    const userMap = {};
    for (const u of users) userMap[u.email] = u.id;

    const raw = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
    const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
    let created = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const title = (row.title || '').trim();
      if (!title) { errors.push({ row: rowNum, message: 'title is required' }); continue; }

      const dueDate = parseDate(row.due_date);
      if (!dueDate) { errors.push({ row: rowNum, message: `invalid due_date '${row.due_date}'. Expected YYYY-MM-DD` }); continue; }

      const category = (row.category || '').trim() || 'General';
      const email = (row.assigned_to_email || '').trim().toLowerCase();
      const assignedTo = userMap[email] || null;
      const notes = row.notes || null;

      await db.pool.query(
        `INSERT INTO tasks (task_type, content_id, client_id, title, stage, assigned_to, assigned_by,
         due_date, notes, \`order\`, status, is_deleted, created_at, updated_at)
         VALUES ('general', NULL, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', 0, NOW(), NOW())`,
        [req.params.client_id, title, category, assignedTo, req.user.id, dueDate, notes]
      );
      created++;
    }

    res.json({ created, errors, total_rows: rows.length });
  } catch (err) { next(err); }
});

module.exports = router;
