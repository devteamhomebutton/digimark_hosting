const express = require('express');
const router = express.Router();
const db = require('../database');
const { query, queryOne } = db;
const { authenticate, requireRoles } = require('../middleware/auth');
const { AppError } = require('../utils/errors');

const DEFAULT_STAGES = {
  'Video': ['Scripting', 'Storyboarding', 'Shooting', 'Video Editing', 'Colour Grading', 'Voiceover', 'Copywriting', 'Review', 'Client Approval', 'Scheduling'],
  'Festival Shoot': ['Planning', 'Location Scouting', 'Prop Arrangement', 'Shooting', 'Photo Editing', 'Design', 'Copywriting', 'Review', 'Client Approval'],
  'Event': ['Event Planning', 'Coordination', 'Live Coverage', 'Photo & Video Editing', 'Highlight Reel', 'Copywriting', 'Review', 'Publishing'],
  'Poster': ['Brief', 'Concept', 'Design', 'Review', 'Revision', 'Final Approval', 'Publishing'],
  'Shooting': ['Location Scouting', 'Setup', 'Shooting', 'Selection & Culling', 'Photo Editing', 'Delivery'],
  'Others': [],
};

function requireAdmin(req) {
  if (!['admin', 'manager'].includes(req.user.role)) {
    throw new AppError('Admin or manager required', 'FORBIDDEN', 403);
  }
}

// ── Categories ──────────────────────────────────────────────────────────────

router.get('/pipeline-templates/categories', authenticate, async (req, res, next) => {
  try {
    const cats = await query('SELECT name, color, is_default, sort_order FROM task_categories ORDER BY sort_order, name');
    res.json(cats);
  } catch (err) { next(err); }
});

router.post('/pipeline-templates/categories', authenticate, async (req, res, next) => {
  try {
    requireAdmin(req);
    const name = (req.body.name || '').trim();
    if (!name) throw new AppError('Category name cannot be empty', 'VALIDATION_ERROR', 422);
    const existing = await queryOne('SELECT id FROM task_categories WHERE name = ?', [name]);
    if (existing) throw new AppError(`Category '${name}' already exists`, 'CONFLICT', 409);

    const [countRow] = await query('SELECT COUNT(*) AS cnt FROM task_categories');
    await db.pool.execute(
      'INSERT INTO task_categories (name, color, is_default, sort_order) VALUES (?, ?, 0, ?)',
      [name, req.body.color || '#64748B', (countRow.cnt || 0) + 1]
    );
    const cat = await queryOne('SELECT name, color, is_default, sort_order FROM task_categories WHERE name = ?', [name]);
    res.status(201).json(cat);
  } catch (err) { next(err); }
});

router.delete('/pipeline-templates/categories/:category', authenticate, async (req, res, next) => {
  try {
    requireAdmin(req);
    const cat = await queryOne('SELECT id, is_default FROM task_categories WHERE name = ?', [req.params.category]);
    if (!cat) throw new AppError(`Unknown category '${req.params.category}'`, 'NOT_FOUND', 404);
    if (cat.is_default) throw new AppError('Cannot delete a built-in category', 'BAD_REQUEST', 400);
    await query('DELETE FROM pipeline_templates WHERE task_category = ?', [req.params.category]);
    await query('DELETE FROM task_categories WHERE name = ?', [req.params.category]);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ── Stage Library ───────────────────────────────────────────────────────────

router.get('/stage-library', authenticate, async (req, res, next) => {
  try {
    const stages = await query('SELECT id, name FROM stage_library ORDER BY name');
    res.json(stages);
  } catch (err) { next(err); }
});

router.post('/stage-library', authenticate, async (req, res, next) => {
  try {
    requireAdmin(req);
    const name = (req.body.name || '').trim();
    if (!name) throw new AppError('Stage name cannot be empty', 'VALIDATION_ERROR', 422);
    if (name.length > 100) throw new AppError('Stage name too long', 'VALIDATION_ERROR', 422);
    const existing = await queryOne('SELECT id FROM stage_library WHERE name = ?', [name]);
    if (existing) throw new AppError(`Stage '${name}' already exists in library`, 'CONFLICT', 409);
    const [result] = await db.pool.execute('INSERT INTO stage_library (name) VALUES (?)', [name]);
    res.status(201).json({ id: result.insertId, name });
  } catch (err) { next(err); }
});

router.delete('/stage-library/:stage_id', authenticate, async (req, res, next) => {
  try {
    requireAdmin(req);
    const stage = await queryOne('SELECT id FROM stage_library WHERE id = ?', [req.params.stage_id]);
    if (!stage) throw new AppError('Stage not found', 'NOT_FOUND', 404);
    await query('DELETE FROM stage_library WHERE id = ?', [req.params.stage_id]);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ── Templates ───────────────────────────────────────────────────────────────

router.get('/pipeline-templates', authenticate, async (req, res, next) => {
  try {
    const cats = await query('SELECT name FROM task_categories ORDER BY sort_order, name');
    const stages = await query(
      'SELECT id, task_category, stage_name, stage_order, is_active FROM pipeline_templates WHERE is_active = 1 ORDER BY task_category, stage_order'
    );
    const result = {};
    for (const c of cats) result[c.name] = [];
    for (const s of stages) {
      if (result[s.task_category] !== undefined) result[s.task_category].push(s);
    }
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/pipeline-templates/:category', authenticate, async (req, res, next) => {
  try {
    const cat = await queryOne('SELECT id FROM task_categories WHERE name = ?', [req.params.category]);
    if (!cat) throw new AppError(`Unknown category '${req.params.category}'`, 'NOT_FOUND', 404);
    const stages = await query(
      'SELECT id, task_category, stage_name, stage_order, is_active FROM pipeline_templates WHERE task_category = ? AND is_active = 1 ORDER BY stage_order',
      [req.params.category]
    );
    res.json(stages);
  } catch (err) { next(err); }
});

router.put('/pipeline-templates/:category', authenticate, async (req, res, next) => {
  try {
    requireAdmin(req);
    const cat = await queryOne('SELECT id FROM task_categories WHERE name = ?', [req.params.category]);
    if (!cat) throw new AppError(`Unknown category '${req.params.category}'`, 'NOT_FOUND', 404);

    await query('DELETE FROM pipeline_templates WHERE task_category = ?', [req.params.category]);
    const stageNames = req.body.stages || [];
    for (let i = 0; i < stageNames.length; i++) {
      const name = (stageNames[i] || '').trim();
      if (!name) continue;
      await db.pool.execute(
        'INSERT INTO pipeline_templates (task_category, stage_name, stage_order, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, 1, ?, NOW(), NOW())',
        [req.params.category, name, i + 1, req.user.id]
      );
    }
    const stages = await query(
      'SELECT id, task_category, stage_name, stage_order, is_active FROM pipeline_templates WHERE task_category = ? AND is_active = 1 ORDER BY stage_order',
      [req.params.category]
    );
    res.json(stages);
  } catch (err) { next(err); }
});

router.post('/pipeline-templates/:category/reset', authenticate, async (req, res, next) => {
  try {
    requireAdmin(req);
    const cat = await queryOne('SELECT id, is_default FROM task_categories WHERE name = ?', [req.params.category]);
    if (!cat) throw new AppError(`Unknown category '${req.params.category}'`, 'NOT_FOUND', 404);
    if (!cat.is_default) throw new AppError('Reset is only available for built-in categories', 'BAD_REQUEST', 400);

    await query('DELETE FROM pipeline_templates WHERE task_category = ?', [req.params.category]);
    const defaults = DEFAULT_STAGES[req.params.category] || [];
    for (let i = 0; i < defaults.length; i++) {
      await db.pool.execute(
        'INSERT INTO pipeline_templates (task_category, stage_name, stage_order, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, 1, ?, NOW(), NOW())',
        [req.params.category, defaults[i], i + 1, req.user.id]
      );
    }
    const stages = await query(
      'SELECT id, task_category, stage_name, stage_order, is_active FROM pipeline_templates WHERE task_category = ? AND is_active = 1 ORDER BY stage_order',
      [req.params.category]
    );
    res.json(stages);
  } catch (err) { next(err); }
});

module.exports = router;
