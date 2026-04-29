const express = require('express');
const router = express.Router();
const db = require('../database');
const { query, queryOne } = db;
const { authenticate } = require('../middleware/auth');
const { NotFoundError, ForbiddenError } = require('../utils/errors');

function approvalToDict(a) {
  return {
    id: a.id,
    task_id: a.task_id,
    approval_type: a.approval_type,
    status: a.status,
    message: a.message,
    response_comment: a.response_comment,
    created_at: a.created_at ? new Date(a.created_at).toISOString() : null,
    resolved_at: a.resolved_at ? new Date(a.resolved_at).toISOString() : null,
    requested_by: a.requested_by_name ? { id: a.requested_by_id, full_name: a.requested_by_name } : null,
    approver: a.approver_name ? { id: a.approver_id, full_name: a.approver_name } : null,
  };
}

const APPROVAL_SELECT = `
  ta.*, rb.full_name AS requested_by_name, ap.full_name AS approver_name
`;
const APPROVAL_JOINS = `
  FROM task_approvals ta
  LEFT JOIN users rb ON ta.requested_by_id = rb.id
  LEFT JOIN users ap ON ta.approver_id = ap.id
`;

// GET /api/v1/approvals/pending
router.get('/pending', authenticate, async (req, res, next) => {
  try {
    const approvals = await query(
      `SELECT ${APPROVAL_SELECT} ${APPROVAL_JOINS}
       WHERE ta.approver_id = ? AND ta.status = 'pending'
       ORDER BY ta.created_at DESC`,
      [req.user.id]
    );
    res.json(approvals.map(approvalToDict));
  } catch (err) { next(err); }
});

// POST /api/v1/approvals
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { task_id, approver_id, approval_type, message } = req.body;
    const task = await queryOne('SELECT id FROM tasks WHERE id = ? AND is_deleted = 0', [task_id]);
    if (!task) throw new NotFoundError('Task');

    const [result] = await db.pool.query(
      `INSERT INTO task_approvals (task_id, requested_by_id, approver_id, approval_type, message, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
      [task_id, req.user.id, approver_id, approval_type, message || null]
    );

    await query('UPDATE tasks SET status = ?, updated_at = NOW() WHERE id = ?', ['pending_approval', task_id]);

    const approval = await queryOne(`SELECT ${APPROVAL_SELECT} ${APPROVAL_JOINS} WHERE ta.id = ?`, [result.insertId]);
    res.status(201).json(approvalToDict(approval));
  } catch (err) { next(err); }
});

// PATCH /api/v1/approvals/:id/approve
router.patch('/:approval_id/approve', authenticate, async (req, res, next) => {
  try {
    const approval = await queryOne(`SELECT ${APPROVAL_SELECT} ${APPROVAL_JOINS} WHERE ta.id = ?`, [req.params.approval_id]);
    if (!approval) throw new NotFoundError('Approval');

    const isAdmin = ['admin', 'manager'].includes(req.user.role);
    if (!isAdmin && req.user.id !== approval.approver_id) {
      throw new ForbiddenError('Only the designated approver or an admin can action this approval.');
    }

    await query(
      `UPDATE task_approvals SET status = 'approved', response_comment = ?, resolved_at = NOW() WHERE id = ?`,
      [req.body.comment || null, req.params.approval_id]
    );

    await query('UPDATE tasks SET status = ?, assignee_comment = COALESCE(?, assignee_comment), updated_at = NOW() WHERE id = ?',
      ['completed', req.body.comment || null, approval.task_id]);

    const updated = await queryOne(`SELECT ${APPROVAL_SELECT} ${APPROVAL_JOINS} WHERE ta.id = ?`, [req.params.approval_id]);
    res.json(approvalToDict(updated));
  } catch (err) { next(err); }
});

// PATCH /api/v1/approvals/:id/request-changes
router.patch('/:approval_id/request-changes', authenticate, async (req, res, next) => {
  try {
    const approval = await queryOne(`SELECT ${APPROVAL_SELECT} ${APPROVAL_JOINS} WHERE ta.id = ?`, [req.params.approval_id]);
    if (!approval) throw new NotFoundError('Approval');

    const isAdmin = ['admin', 'manager'].includes(req.user.role);
    if (!isAdmin && req.user.id !== approval.approver_id) {
      throw new ForbiddenError('Only the designated approver or an admin can action this approval.');
    }

    await query(
      `UPDATE task_approvals SET status = 'changes_requested', response_comment = ?, resolved_at = NOW() WHERE id = ?`,
      [req.body.comment, req.params.approval_id]
    );

    await query('UPDATE tasks SET status = ?, assignee_comment = ?, updated_at = NOW() WHERE id = ?',
      ['in_progress', req.body.comment, approval.task_id]);

    const updated = await queryOne(`SELECT ${APPROVAL_SELECT} ${APPROVAL_JOINS} WHERE ta.id = ?`, [req.params.approval_id]);
    res.json(approvalToDict(updated));
  } catch (err) { next(err); }
});

// GET /api/v1/approvals/task/:task_id
router.get('/task/:task_id', authenticate, async (req, res, next) => {
  try {
    const approvals = await query(
      `SELECT ${APPROVAL_SELECT} ${APPROVAL_JOINS} WHERE ta.task_id = ? ORDER BY ta.created_at DESC`,
      [req.params.task_id]
    );
    res.json(approvals.map(approvalToDict));
  } catch (err) { next(err); }
});

module.exports = router;
