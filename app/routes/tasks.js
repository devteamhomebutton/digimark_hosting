const express = require('express');
const router = express.Router();
const db = require('../database');
const { query, queryOne } = db;
const { authenticate } = require('../middleware/auth');
const { NotFoundError, ValidationError } = require('../utils/errors');

// ── Helpers ──────────────────────────────────────────────────────────────────

function taskToDict(t, assignees = [], approvals = []) {
  const result = {
    id: t.id,
    task_type: t.task_type || 'content',
    content_id: t.content_id,
    client_id: t.client_id,
    client_name: t.client_name || null,
    vertical_id: t.vertical_id,
    vertical_name: t.vertical_name || t.content_vertical_name || null,
    title: t.title,
    description: t.description,
    stage: t.stage,
    task_category: t.task_category,
    assigned_to: t.assigned_to,
    assigned_by: t.assigned_by,
    due_date: t.due_date,
    scheduled_time: t.scheduled_time ? String(t.scheduled_time).substring(0, 5) : null,
    status: t.status,
    order: t.order,
    parent_task_id: t.parent_task_id,
    notes: t.notes,
    assignee_comment: t.assignee_comment,
    drive_url: t.drive_url,
    created_at: t.created_at ? new Date(t.created_at).toISOString() : null,
  };

  // Assignee info
  if (t.assignee_id) {
    result.assignee = {
      id: t.assignee_id,
      full_name: t.assignee_name,
      avatar_url: t.assignee_avatar,
      role: t.assignee_role,
    };
  } else {
    result.assignee = null;
  }

  result.assignees = assignees.map(u => ({
    id: u.id, full_name: u.full_name, avatar_url: u.avatar_url, role: u.role,
  }));

  // Approvals
  let pending_approval = null;
  let last_approval = null;
  const sorted = (approvals || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  for (const appr of sorted) {
    if (appr.status === 'pending' && !pending_approval) {
      pending_approval = {
        id: appr.id,
        approval_type: appr.approval_type,
        approver_id: appr.approver_id,
        approver_name: appr.approver_name,
        message: appr.message,
        created_at: appr.created_at ? new Date(appr.created_at).toISOString() : null,
      };
    } else if (['approved', 'changes_requested'].includes(appr.status) && !last_approval) {
      last_approval = {
        id: appr.id,
        approval_type: appr.approval_type,
        status: appr.status,
        approver_id: appr.approver_id,
        approver_name: appr.approver_name,
        response_comment: appr.response_comment,
        resolved_at: appr.resolved_at ? new Date(appr.resolved_at).toISOString() : null,
      };
    }
  }
  result.current_approval = pending_approval;
  result.last_approval = last_approval;

  return result;
}

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
     WHERE ta.task_id IN (${placeholders})`,
    taskIds
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.task_id]) map[r.task_id] = [];
    map[r.task_id].push(r);
  }
  return map;
}

async function loadTaskApprovals(taskIds) {
  if (!taskIds.length) return {};
  const placeholders = taskIds.map(() => '?').join(',');
  const rows = await query(
    `SELECT ta.*, u.full_name AS approver_name
     FROM task_approvals ta
     LEFT JOIN users u ON ta.approver_id = u.id
     WHERE ta.task_id IN (${placeholders})
     ORDER BY ta.created_at DESC`,
    taskIds
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.task_id]) map[r.task_id] = [];
    map[r.task_id].push(r);
  }
  return map;
}

async function enrichTasks(tasks) {
  const ids = tasks.map(t => t.id);
  const [assigneesMap, approvalsMap] = await Promise.all([
    loadTaskAssignees(ids),
    loadTaskApprovals(ids),
  ]);
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

// ── GET /api/v1/tasks/my-tasks ──────────────────────────────────────────────

router.get('/my-tasks', authenticate, async (req, res, next) => {
  try {
    let sql = `SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.assigned_to = ? AND t.is_deleted = 0`;
    const params = [req.user.id];
    if (req.query.status) { sql += ' AND t.status = ?'; params.push(req.query.status); }
    sql += ' ORDER BY t.due_date';
    const tasks = await query(sql, params);
    res.json(await enrichTasks(tasks));
  } catch (err) { next(err); }
});

// ── GET /api/v1/tasks/daily ──────────────────────────────────────────────────

router.get('/daily', authenticate, async (req, res, next) => {
  try {
    const { date: dateStr, user_id } = req.query;
    let sql = `SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.is_deleted = 0`;
    const params = [];
    if (dateStr) { sql += ' AND t.due_date = ?'; params.push(dateStr); }
    if (user_id) { sql += ' AND t.assigned_to = ?'; params.push(user_id); }
    sql += ' ORDER BY t.assigned_to, t.scheduled_time';

    const tasks = await query(sql, params);
    const enriched = await enrichTasks(tasks);

    const grouped = {};
    for (const t of enriched) {
      const uid = t.assigned_to || 0;
      if (!grouped[uid]) {
        grouped[uid] = {
          user_id: uid,
          user_name: t.assignee ? t.assignee.full_name : 'Unassigned',
          user_role: t.assignee ? t.assignee.role : null,
          tasks: [],
        };
      }
      grouped[uid].tasks.push(t);
    }
    res.json({ date: dateStr, team_tasks: Object.values(grouped) });
  } catch (err) { next(err); }
});

// ── GET /api/v1/tasks/overview ──────────────────────────────────────────────

router.get('/overview', authenticate, async (req, res, next) => {
  try {
    const { client_id, vertical_id, user_id, status, task_type } = req.query;
    let sql = `SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.is_deleted = 0`;
    const params = [];
    if (client_id) { sql += ' AND t.client_id = ?'; params.push(client_id); }
    if (vertical_id) { sql += ' AND (t.vertical_id = ? OR ct.vertical_id = ?)'; params.push(vertical_id, vertical_id); }
    if (user_id) { sql += ' AND t.assigned_to = ?'; params.push(user_id); }
    if (status) { sql += ' AND t.status = ?'; params.push(status); }
    if (task_type) { sql += ' AND t.task_type = ?'; params.push(task_type); }
    sql += ' ORDER BY t.task_type, t.due_date';

    const tasks = await query(sql, params);
    res.json(await enrichTasks(tasks));
  } catch (err) { next(err); }
});

// ── POST /api/v1/tasks/daily/bulk ───────────────────────────────────────────

router.post('/daily/bulk', authenticate, async (req, res, next) => {
  try {
    const { client_id, tasks: taskList } = req.body;
    const created = [];
    for (const td of taskList) {
      const [result] = await db.pool.execute(
        `INSERT INTO tasks (task_type, client_id, title, description, stage, assigned_to, assigned_by,
         due_date, notes, \`order\`, status, is_deleted, created_at, updated_at)
         VALUES ('general', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NOW(), NOW())`,
        [client_id, td.title, td.description || null, td.stage, td.assigned_to || null,
         req.user.id, td.due_date, td.notes || null, td.order || 0]
      );
      const task = await queryOne(`SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.id = ?`, [result.insertId]);
      created.push(task);
    }
    res.status(201).json(await enrichTasks(created));
  } catch (err) { next(err); }
});

// ── GET /api/v1/tasks/general ───────────────────────────────────────────────

router.get('/general', authenticate, async (req, res, next) => {
  try {
    const { vertical_id, client_id, assigned_to, status } = req.query;
    const isAdmin = ['admin', 'manager'].includes(req.user.role);
    let sql = `SELECT ${TASK_SELECT} ${TASK_JOINS}
               WHERE t.content_id IS NULL AND t.parent_task_id IS NULL AND t.is_deleted = 0`;
    const params = [];
    if (vertical_id) { sql += ' AND t.vertical_id = ?'; params.push(vertical_id); }
    else if (client_id) { sql += ' AND t.client_id = ?'; params.push(client_id); }
    if (assigned_to) { sql += ' AND t.assigned_to = ?'; params.push(assigned_to); }
    else if (!isAdmin) { sql += ' AND t.assigned_to = ?'; params.push(req.user.id); }
    if (status) { sql += ' AND t.status = ?'; params.push(status); }
    sql += ' ORDER BY t.`order`, t.due_date';

    const tasks = await query(sql, params);
    res.json(await enrichTasks(tasks));
  } catch (err) { next(err); }
});

// ── POST /api/v1/tasks/general ──────────────────────────────────────────────

router.post('/general', authenticate, async (req, res, next) => {
  try {
    const { title, description, category = 'General', task_category, assigned_to,
            assigned_to_ids, due_date, notes, vertical_id, client_id, auto_pipeline = true } = req.body;

    let resolvedClientId;
    if (vertical_id) {
      const vert = await queryOne('SELECT client_id FROM verticals WHERE id = ?', [vertical_id]);
      if (!vert) throw new NotFoundError('Vertical');
      resolvedClientId = vert.client_id;
    } else if (client_id) {
      resolvedClientId = client_id;
    } else {
      throw new ValidationError('Either vertical_id or client_id is required');
    }

    const primaryId = assigned_to_ids && assigned_to_ids.length ? assigned_to_ids[0] : assigned_to;

    const [result] = await db.pool.execute(
      `INSERT INTO tasks (task_type, content_id, client_id, vertical_id, title, description, stage,
       task_category, assigned_to, assigned_by, due_date, \`order\`, notes, status, is_deleted, created_at, updated_at)
       VALUES ('general', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', 0, NOW(), NOW())`,
      [resolvedClientId, vertical_id || null, title, description || null, category,
       task_category || null, primaryId || null, req.user.id, due_date, notes || null]
    );

    const taskId = result.insertId;
    const ids = assigned_to_ids || (assigned_to ? [assigned_to] : []);
    if (ids.length) await syncAssignees(taskId, ids);

    // Auto-create pipeline stages
    if (auto_pipeline && task_category) {
      const stages = await query(
        'SELECT stage_name, stage_order FROM pipeline_templates WHERE task_category = ? AND is_active = 1 ORDER BY stage_order',
        [task_category]
      );
      for (let i = 0; i < stages.length; i++) {
        await db.pool.execute(
          `INSERT INTO tasks (task_type, content_id, parent_task_id, client_id, vertical_id, title, stage,
           task_category, assigned_to, assigned_by, due_date, \`order\`, status, is_deleted, created_at, updated_at)
           VALUES ('general', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NOW(), NOW())`,
          [taskId, resolvedClientId, vertical_id || null, stages[i].stage_name, stages[i].stage_name,
           task_category, assigned_to || null, req.user.id, due_date, i + 1]
        );
      }
    }

    const task = await queryOne(`SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.id = ?`, [taskId]);
    const enriched = await enrichTasks([task]);
    res.status(201).json(enriched[0]);
  } catch (err) { next(err); }
});

// ── POST /api/v1/tasks/general/from-template ────────────────────────────────

router.post('/general/from-template', authenticate, async (req, res, next) => {
  try {
    const { vertical_id, client_id, task_category, project_title, due_date, assigned_to } = req.body;

    let resolvedClientId;
    if (vertical_id) {
      const vert = await queryOne('SELECT client_id FROM verticals WHERE id = ?', [vertical_id]);
      if (!vert) throw new NotFoundError('Vertical');
      resolvedClientId = vert.client_id;
    } else if (client_id) {
      resolvedClientId = client_id;
    } else {
      throw new ValidationError('Either vertical_id or client_id is required');
    }

    const stages = await query(
      'SELECT stage_name, stage_order FROM pipeline_templates WHERE task_category = ? AND is_active = 1 ORDER BY stage_order',
      [task_category]
    );

    const created = [];
    for (let i = 0; i < stages.length; i++) {
      const [result] = await db.pool.execute(
        `INSERT INTO tasks (task_type, content_id, client_id, vertical_id, title, stage, task_category,
         assigned_to, assigned_by, due_date, \`order\`, status, is_deleted, created_at, updated_at)
         VALUES ('general', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NOW(), NOW())`,
        [resolvedClientId, vertical_id || null, `${project_title} — ${stages[i].stage_name}`,
         stages[i].stage_name, task_category, assigned_to || null, req.user.id, due_date, i + 1]
      );
      const task = await queryOne(`SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.id = ?`, [result.insertId]);
      created.push(task);
    }
    res.status(201).json(await enrichTasks(created));
  } catch (err) { next(err); }
});

// ── POST /api/v1/tasks/general/reorder ──────────────────────────────────────

router.post('/general/reorder', authenticate, async (req, res, next) => {
  try {
    const { vertical_id, client_id, ordered_ids } = req.body;
    for (let i = 0; i < ordered_ids.length; i++) {
      await query('UPDATE tasks SET `order` = ?, updated_at = NOW() WHERE id = ?', [i + 1, ordered_ids[i]]);
    }

    let sql = `SELECT ${TASK_SELECT} ${TASK_JOINS}
               WHERE t.content_id IS NULL AND t.is_deleted = 0`;
    const params = [];
    if (vertical_id) { sql += ' AND t.vertical_id = ?'; params.push(vertical_id); }
    else if (client_id) { sql += ' AND t.client_id = ?'; params.push(client_id); }
    sql += ' ORDER BY t.`order`';

    const tasks = await query(sql, params);
    res.json(await enrichTasks(tasks));
  } catch (err) { next(err); }
});

// ── General task stages ─────────────────────────────────────────────────────

router.get('/general/:task_id/stages', authenticate, async (req, res, next) => {
  try {
    const parent = await queryOne('SELECT id FROM tasks WHERE id = ? AND is_deleted = 0', [req.params.task_id]);
    if (!parent) throw new NotFoundError('Task');

    const stages = await query(
      `SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.parent_task_id = ? AND t.is_deleted = 0 ORDER BY t.\`order\``,
      [req.params.task_id]
    );
    res.json(await enrichTasks(stages));
  } catch (err) { next(err); }
});

router.post('/general/:task_id/stages', authenticate, async (req, res, next) => {
  try {
    const parent = await queryOne('SELECT * FROM tasks WHERE id = ? AND is_deleted = 0', [req.params.task_id]);
    if (!parent) throw new NotFoundError('Task');

    const { title, stage, due_date, assigned_to, assigned_to_ids, notes, description, order, drive_url } = req.body;
    const primaryId = assigned_to_ids && assigned_to_ids.length ? assigned_to_ids[0] : assigned_to;

    const [result] = await db.pool.execute(
      `INSERT INTO tasks (task_type, content_id, parent_task_id, client_id, vertical_id, title, stage,
       description, task_category, assigned_to, assigned_by, due_date, notes, drive_url, \`order\`, status, is_deleted, created_at, updated_at)
       VALUES ('general', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NOW(), NOW())`,
      [req.params.task_id, parent.client_id, parent.vertical_id, title, stage,
       description || null, parent.task_category, primaryId || null, req.user.id,
       due_date, notes || null, drive_url || null, order || 0]
    );

    const ids = assigned_to_ids || (assigned_to ? [assigned_to] : []);
    if (ids.length) await syncAssignees(result.insertId, ids);

    const task = await queryOne(`SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.id = ?`, [result.insertId]);
    const enriched = await enrichTasks([task]);
    res.status(201).json(enriched[0]);
  } catch (err) { next(err); }
});

router.post('/general/:task_id/stages/pipeline', authenticate, async (req, res, next) => {
  try {
    const parent = await queryOne('SELECT * FROM tasks WHERE id = ? AND is_deleted = 0', [req.params.task_id]);
    if (!parent) throw new NotFoundError('Task');

    const category = parent.task_category || 'Others';
    const stages = await query(
      'SELECT stage_name, stage_order FROM pipeline_templates WHERE task_category = ? AND is_active = 1 ORDER BY stage_order',
      [category]
    );

    const created = [];
    for (let i = 0; i < stages.length; i++) {
      const [result] = await db.pool.execute(
        `INSERT INTO tasks (task_type, content_id, parent_task_id, client_id, vertical_id, title, stage,
         task_category, assigned_to, assigned_by, due_date, \`order\`, status, is_deleted, created_at, updated_at)
         VALUES ('general', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NOW(), NOW())`,
        [req.params.task_id, parent.client_id, parent.vertical_id, stages[i].stage_name, stages[i].stage_name,
         category, parent.assigned_to, req.user.id, parent.due_date, i + 1]
      );
      const task = await queryOne(`SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.id = ?`, [result.insertId]);
      created.push(task);
    }
    res.status(201).json(await enrichTasks(created));
  } catch (err) { next(err); }
});

router.post('/general/:task_id/stages/reorder', authenticate, async (req, res, next) => {
  try {
    const { ordered_ids } = req.body;
    for (let i = 0; i < ordered_ids.length; i++) {
      await query('UPDATE tasks SET `order` = ?, updated_at = NOW() WHERE id = ? AND parent_task_id = ?',
        [i + 1, ordered_ids[i], req.params.task_id]);
    }
    const stages = await query(
      `SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.parent_task_id = ? AND t.is_deleted = 0 ORDER BY t.\`order\``,
      [req.params.task_id]
    );
    res.json(await enrichTasks(stages));
  } catch (err) { next(err); }
});

// ── Individual task operations ──────────────────────────────────────────────

router.get('/:task_id', authenticate, async (req, res, next) => {
  try {
    const task = await queryOne(`SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.id = ? AND t.is_deleted = 0`, [req.params.task_id]);
    if (!task) throw new NotFoundError('Task');
    const enriched = await enrichTasks([task]);
    res.json(enriched[0]);
  } catch (err) { next(err); }
});

router.put('/:task_id', authenticate, async (req, res, next) => {
  try {
    const task = await queryOne('SELECT id FROM tasks WHERE id = ? AND is_deleted = 0', [req.params.task_id]);
    if (!task) throw new NotFoundError('Task');

    const fields = ['title', 'description', 'stage', 'due_date', 'notes', 'assignee_comment', 'task_category'];
    const updates = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (req.body.order !== undefined) { updates.push('`order` = ?'); params.push(req.body.order); }
    if (req.body.drive_url !== undefined) {
      updates.push('drive_url = ?');
      params.push(req.body.drive_url && req.body.drive_url.trim() ? req.body.drive_url : null);
    }
    if (req.body.assigned_to_ids !== undefined) {
      await syncAssignees(req.params.task_id, req.body.assigned_to_ids);
    } else if (req.body.assigned_to !== undefined) {
      updates.push('assigned_to = ?');
      params.push(req.body.assigned_to);
    }
    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      params.push(req.params.task_id);
      await query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updated = await queryOne(`SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.id = ?`, [req.params.task_id]);
    const enriched = await enrichTasks([updated]);
    res.json(enriched[0]);
  } catch (err) { next(err); }
});

router.delete('/:task_id', authenticate, async (req, res, next) => {
  try {
    const task = await queryOne('SELECT id FROM tasks WHERE id = ? AND is_deleted = 0', [req.params.task_id]);
    if (!task) throw new NotFoundError('Task');
    await query('UPDATE tasks SET is_deleted = 1, updated_at = NOW() WHERE id = ?', [req.params.task_id]);
    res.json({ message: 'Task deleted' });
  } catch (err) { next(err); }
});

router.patch('/:task_id/status', authenticate, async (req, res, next) => {
  try {
    const task = await queryOne('SELECT id FROM tasks WHERE id = ? AND is_deleted = 0', [req.params.task_id]);
    if (!task) throw new NotFoundError('Task');
    const updates = ['status = ?', 'updated_at = NOW()'];
    const params = [req.body.status];
    if (req.body.assignee_comment !== undefined) {
      updates.push('assignee_comment = ?');
      params.push(req.body.assignee_comment);
    }
    params.push(req.params.task_id);
    await query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ id: parseInt(req.params.task_id, 10), status: req.body.status, assignee_comment: req.body.assignee_comment || null });
  } catch (err) { next(err); }
});

router.patch('/:task_id/assign', authenticate, async (req, res, next) => {
  try {
    const task = await queryOne('SELECT id FROM tasks WHERE id = ? AND is_deleted = 0', [req.params.task_id]);
    if (!task) throw new NotFoundError('Task');
    if (req.body.assigned_to_ids !== undefined) {
      await syncAssignees(req.params.task_id, req.body.assigned_to_ids);
    } else {
      await query('UPDATE tasks SET assigned_to = ?, updated_at = NOW() WHERE id = ?', [req.body.assigned_to, req.params.task_id]);
    }
    await query('UPDATE tasks SET assigned_by = ?, updated_at = NOW() WHERE id = ?', [req.user.id, req.params.task_id]);

    const assignees = await query(
      'SELECT user_id AS id FROM task_assignees WHERE task_id = ?', [req.params.task_id]
    );
    const updated = await queryOne('SELECT assigned_to FROM tasks WHERE id = ?', [req.params.task_id]);
    res.json({ id: parseInt(req.params.task_id, 10), assigned_to: updated.assigned_to, assignees: assignees.map(a => a.id) });
  } catch (err) { next(err); }
});

module.exports = router;
