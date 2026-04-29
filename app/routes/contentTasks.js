const express = require('express');
const router = express.Router();
const db = require('../database');
const { query, queryOne } = db;
const { authenticate } = require('../middleware/auth');
const { NotFoundError } = require('../utils/errors');

// Re-use helpers from tasks route
const TASK_SELECT = `
  t.*, c.name AS client_name,
  u.id AS assignee_id, u.full_name AS assignee_name, u.avatar_url AS assignee_avatar, u.role AS assignee_role,
  v.name AS vertical_name,
  cv.name AS content_vertical_name
`;

const TASK_JOINS = `
  FROM tasks t
  LEFT JOIN clients c ON t.client_id = c.id
  LEFT JOIN users u ON t.assigned_to = u.id
  LEFT JOIN verticals v ON t.vertical_id = v.id
  LEFT JOIN contents ct ON t.content_id = ct.id
  LEFT JOIN verticals cv ON ct.vertical_id = cv.id
`;

async function loadTaskAssignees(taskIds) {
  if (!taskIds.length) return {};
  const placeholders = taskIds.map(() => '?').join(',');
  const rows = await query(
    `SELECT ta.task_id, u.id, u.full_name, u.avatar_url, u.role
     FROM task_assignees ta JOIN users u ON ta.user_id = u.id
     WHERE ta.task_id IN (${placeholders})`, taskIds
  );
  const map = {};
  for (const r of rows) { if (!map[r.task_id]) map[r.task_id] = []; map[r.task_id].push(r); }
  return map;
}

async function loadTaskApprovals(taskIds) {
  if (!taskIds.length) return {};
  const placeholders = taskIds.map(() => '?').join(',');
  const rows = await query(
    `SELECT ta.*, u.full_name AS approver_name FROM task_approvals ta
     LEFT JOIN users u ON ta.approver_id = u.id
     WHERE ta.task_id IN (${placeholders}) ORDER BY ta.created_at DESC`, taskIds
  );
  const map = {};
  for (const r of rows) { if (!map[r.task_id]) map[r.task_id] = []; map[r.task_id].push(r); }
  return map;
}

function taskToDict(t, assignees = [], approvals = []) {
  const result = {
    id: t.id, task_type: t.task_type || 'content', content_id: t.content_id,
    client_id: t.client_id, client_name: t.client_name || null,
    vertical_id: t.vertical_id, vertical_name: t.vertical_name || t.content_vertical_name || null,
    title: t.title, description: t.description, stage: t.stage, task_category: t.task_category,
    assigned_to: t.assigned_to, assigned_by: t.assigned_by,
    due_date: t.due_date,
    scheduled_time: t.scheduled_time ? String(t.scheduled_time).substring(0, 5) : null,
    status: t.status, order: t.order, parent_task_id: t.parent_task_id,
    notes: t.notes, assignee_comment: t.assignee_comment, drive_url: t.drive_url,
    created_at: t.created_at ? new Date(t.created_at).toISOString() : null,
  };
  result.assignee = t.assignee_id ? { id: t.assignee_id, full_name: t.assignee_name, avatar_url: t.assignee_avatar, role: t.assignee_role } : null;
  result.assignees = assignees.map(u => ({ id: u.id, full_name: u.full_name, avatar_url: u.avatar_url, role: u.role }));

  let pending_approval = null, last_approval = null;
  for (const appr of (approvals || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))) {
    if (appr.status === 'pending' && !pending_approval) {
      pending_approval = { id: appr.id, approval_type: appr.approval_type, approver_id: appr.approver_id, approver_name: appr.approver_name, message: appr.message, created_at: appr.created_at ? new Date(appr.created_at).toISOString() : null };
    } else if (['approved', 'changes_requested'].includes(appr.status) && !last_approval) {
      last_approval = { id: appr.id, approval_type: appr.approval_type, status: appr.status, approver_id: appr.approver_id, approver_name: appr.approver_name, response_comment: appr.response_comment, resolved_at: appr.resolved_at ? new Date(appr.resolved_at).toISOString() : null };
    }
  }
  result.current_approval = pending_approval;
  result.last_approval = last_approval;
  return result;
}

async function enrichTasks(tasks) {
  const ids = tasks.map(t => t.id);
  const [assigneesMap, approvalsMap] = await Promise.all([loadTaskAssignees(ids), loadTaskApprovals(ids)]);
  return tasks.map(t => taskToDict(t, assigneesMap[t.id] || [], approvalsMap[t.id] || []));
}

async function syncAssignees(taskId, userIds) {
  await query('DELETE FROM task_assignees WHERE task_id = ?', [taskId]);
  if (userIds && userIds.length) {
    const values = userIds.map(uid => `(${taskId}, ${parseInt(uid, 10)})`).join(',');
    await query(`INSERT INTO task_assignees (task_id, user_id) VALUES ${values}`);
    await query('UPDATE tasks SET assigned_to = ?, updated_at = NOW() WHERE id = ?', [userIds[0], taskId]);
  }
}

// GET /api/v1/content/:content_id/tasks
router.get('/content/:content_id/tasks', authenticate, async (req, res, next) => {
  try {
    const content = await queryOne('SELECT id FROM contents WHERE id = ? AND is_deleted = 0', [req.params.content_id]);
    if (!content) throw new NotFoundError('Content');
    const tasks = await query(
      `SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.content_id = ? AND t.is_deleted = 0 ORDER BY t.\`order\``,
      [req.params.content_id]
    );
    res.json(await enrichTasks(tasks));
  } catch (err) { next(err); }
});

// POST /api/v1/content/:content_id/tasks
router.post('/content/:content_id/tasks', authenticate, async (req, res, next) => {
  try {
    const content = await queryOne('SELECT * FROM contents WHERE id = ? AND is_deleted = 0', [req.params.content_id]);
    if (!content) throw new NotFoundError('Content');

    const { title, description, stage, assigned_to, assigned_to_ids, due_date, notes, order, drive_url } = req.body;
    const primaryId = assigned_to_ids && assigned_to_ids.length ? assigned_to_ids[0] : assigned_to;

    const [result] = await db.pool.execute(
      `INSERT INTO tasks (task_type, content_id, client_id, title, description, stage, assigned_to, assigned_by,
       due_date, notes, drive_url, \`order\`, status, is_deleted, created_at, updated_at)
       VALUES ('content', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NOW(), NOW())`,
      [req.params.content_id, content.client_id, title, description || null, stage,
       primaryId || null, req.user.id, due_date, notes || null, drive_url || null, order || 0]
    );

    const ids = assigned_to_ids || (assigned_to ? [assigned_to] : []);
    if (ids.length) await syncAssignees(result.insertId, ids);

    const task = await queryOne(`SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.id = ?`, [result.insertId]);
    const enriched = await enrichTasks([task]);
    res.status(201).json(enriched[0]);
  } catch (err) { next(err); }
});

// POST /api/v1/content/:content_id/tasks/pipeline
router.post('/content/:content_id/tasks/pipeline', authenticate, async (req, res, next) => {
  try {
    const content = await queryOne('SELECT * FROM contents WHERE id = ? AND is_deleted = 0', [req.params.content_id]);
    if (!content) throw new NotFoundError('Content');

    const category = content.task_category || 'Video';
    let templateStages = await query(
      'SELECT stage_name, stage_order FROM pipeline_templates WHERE task_category = ? AND is_active = 1 ORDER BY stage_order',
      [category]
    );

    let stagesData;
    if (templateStages.length) {
      stagesData = templateStages.map((t, i) => ({ stage: t.stage_name, order: i + 1, title: t.stage_name }));
    } else {
      stagesData = [
        { stage: 'Scripting', order: 1, title: 'Write script / brief' },
        { stage: 'Shooting', order: 2, title: 'Shoot video / photos' },
        { stage: 'Editing', order: 3, title: 'Edit video / images' },
        { stage: 'Design', order: 4, title: 'Create graphics / poster' },
        { stage: 'Copywriting', order: 5, title: 'Write caption & hashtags' },
        { stage: 'Review', order: 6, title: 'Internal review' },
        { stage: 'Approval', order: 7, title: 'Client approval' },
        { stage: 'Scheduling', order: 8, title: 'Schedule on platform' },
      ];
    }

    const created = [];
    for (const s of stagesData) {
      const [result] = await db.pool.execute(
        `INSERT INTO tasks (task_type, content_id, client_id, title, stage, task_category,
         assigned_by, due_date, \`order\`, status, is_deleted, created_at, updated_at)
         VALUES ('content', ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NOW(), NOW())`,
        [req.params.content_id, content.client_id, s.title, s.stage, category,
         req.user.id, content.scheduled_date, s.order]
      );
      const task = await queryOne(`SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.id = ?`, [result.insertId]);
      created.push(task);
    }
    res.status(201).json(await enrichTasks(created));
  } catch (err) { next(err); }
});

// POST /api/v1/content/:content_id/tasks/reorder
router.post('/content/:content_id/tasks/reorder', authenticate, async (req, res, next) => {
  try {
    const content = await queryOne('SELECT id FROM contents WHERE id = ? AND is_deleted = 0', [req.params.content_id]);
    if (!content) throw new NotFoundError('Content');

    const { ordered_ids } = req.body;
    for (let i = 0; i < ordered_ids.length; i++) {
      await query('UPDATE tasks SET `order` = ?, updated_at = NOW() WHERE id = ? AND content_id = ?',
        [i + 1, ordered_ids[i], req.params.content_id]);
    }

    const tasks = await query(
      `SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.content_id = ? AND t.is_deleted = 0 ORDER BY t.\`order\``,
      [req.params.content_id]
    );
    res.json(await enrichTasks(tasks));
  } catch (err) { next(err); }
});

module.exports = router;
