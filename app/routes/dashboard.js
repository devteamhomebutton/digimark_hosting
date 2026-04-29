const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { authenticate } = require('../middleware/auth');

// GET /api/v1/dashboard
router.get('/', authenticate, async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    const [
      [totalClients],
      [contentThisWeek],
      [pendingApprovals],
      [myPendingTasks],
      [overdueTasks],
      upcomingContent,
      myTasksToday,
    ] = await Promise.all([
      query('SELECT COUNT(*) AS cnt FROM clients WHERE is_deleted = 0 AND status = ?', ['active']),
      query('SELECT COUNT(*) AS cnt FROM contents WHERE is_deleted = 0 AND scheduled_date >= ? AND scheduled_date <= ?', [today, weekEnd]),
      query('SELECT COUNT(*) AS cnt FROM contents WHERE is_deleted = 0 AND status = ?', ['pending_approval']),
      query('SELECT COUNT(*) AS cnt FROM tasks WHERE is_deleted = 0 AND assigned_to = ? AND status IN (?, ?)', [req.user.id, 'pending', 'in_progress']),
      query('SELECT COUNT(*) AS cnt FROM tasks WHERE is_deleted = 0 AND due_date < ? AND status NOT IN (?, ?)', [today, 'completed', 'rejected']),
      query(
        `SELECT id, title, client_id, content_type, platform, scheduled_date, status
         FROM contents WHERE is_deleted = 0 AND scheduled_date >= ? AND scheduled_date <= ?
         ORDER BY scheduled_date LIMIT 20`,
        [today, weekEnd]
      ),
      query(
        `SELECT id, title, stage, status, client_id FROM tasks
         WHERE is_deleted = 0 AND assigned_to = ? AND due_date = ? AND status != ?`,
        [req.user.id, today, 'completed']
      ),
    ]);

    res.json({
      stats: {
        total_clients: totalClients.cnt,
        content_this_week: contentThisWeek.cnt,
        pending_approvals: pendingApprovals.cnt,
        my_pending_tasks: myPendingTasks.cnt,
        overdue_tasks: overdueTasks.cnt,
      },
      upcoming_content: upcomingContent,
      my_tasks_today: myTasksToday,
    });
  } catch (err) { next(err); }
});

module.exports = router;
