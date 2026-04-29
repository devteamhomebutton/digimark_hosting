const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { authenticate } = require('../middleware/auth');

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildContentWhere(filters) {
  const conditions = ['c.is_deleted = 0'];
  const params = [];
  if (filters.vertical_id) { conditions.push('c.vertical_id = ?'); params.push(filters.vertical_id); }
  if (filters.date_from) { conditions.push('c.scheduled_date >= ?'); params.push(filters.date_from); }
  if (filters.date_to) { conditions.push('c.scheduled_date <= ?'); params.push(filters.date_to); }
  if (filters.status) { conditions.push('c.status = ?'); params.push(filters.status); }
  if (filters.platform) { conditions.push('c.platform = ?'); params.push(filters.platform); }
  if (filters.assigned_to) { conditions.push('c.created_by = ?'); params.push(filters.assigned_to); }
  return { where: conditions.join(' AND '), params };
}

function buildTaskWhere(filters) {
  const conditions = ['t.is_deleted = 0'];
  const params = [];
  if (filters.vertical_id) {
    conditions.push('(t.vertical_id = ? OR ct.vertical_id = ?)');
    params.push(filters.vertical_id, filters.vertical_id);
  }
  if (filters.date_from) { conditions.push('t.due_date >= ?'); params.push(filters.date_from); }
  if (filters.date_to) { conditions.push('t.due_date <= ?'); params.push(filters.date_to); }
  if (filters.status) { conditions.push('t.status = ?'); params.push(filters.status); }
  if (filters.task_type) { conditions.push('t.task_type = ?'); params.push(filters.task_type); }
  if (filters.assigned_to) { conditions.push('t.assigned_to = ?'); params.push(filters.assigned_to); }
  return { where: conditions.join(' AND '), params };
}

async function buildOverview(filters) {
  const cw = buildContentWhere(filters);
  const tw = buildTaskWhere(filters);

  const [totalContent] = await query(`SELECT COUNT(*) AS cnt FROM contents c WHERE ${cw.where}`, cw.params);
  const [totalTasks] = await query(
    `SELECT COUNT(*) AS cnt FROM tasks t LEFT JOIN contents ct ON t.content_id = ct.id WHERE ${tw.where}`, tw.params
  );
  const [completedTasks] = await query(
    `SELECT COUNT(*) AS cnt FROM tasks t LEFT JOIN contents ct ON t.content_id = ct.id WHERE ${tw.where} AND t.status = 'completed'`, tw.params
  );

  const today = new Date().toISOString().split('T')[0];
  let overdueWhere = "t.is_deleted = 0 AND t.due_date < ? AND t.status NOT IN ('completed', 'rejected')";
  const overdueParams = [today];
  if (filters.vertical_id) {
    overdueWhere += ' AND (t.vertical_id = ? OR ct.vertical_id = ?)';
    overdueParams.push(filters.vertical_id, filters.vertical_id);
  }
  const [overdue] = await query(
    `SELECT COUNT(*) AS cnt FROM tasks t LEFT JOIN contents ct ON t.content_id = ct.id WHERE ${overdueWhere}`, overdueParams
  );

  let pendWhere = "c.is_deleted = 0 AND c.status = 'pending_approval'";
  const pendParams = [];
  if (filters.vertical_id) { pendWhere += ' AND c.vertical_id = ?'; pendParams.push(filters.vertical_id); }
  const [pending] = await query(`SELECT COUNT(*) AS cnt FROM contents c WHERE ${pendWhere}`, pendParams);

  let statusWhere = 'c.is_deleted = 0';
  const statusParams = [];
  if (filters.vertical_id) { statusWhere += ' AND c.vertical_id = ?'; statusParams.push(filters.vertical_id); }
  const statusRows = await query(`SELECT status, COUNT(*) AS cnt FROM contents c WHERE ${statusWhere} GROUP BY status`, statusParams);
  const by_status = {};
  for (const r of statusRows) by_status[r.status] = r.cnt;

  const platRows = await query(`SELECT platform, COUNT(*) AS cnt FROM contents c WHERE ${statusWhere} GROUP BY platform`, statusParams);
  const by_platform = {};
  for (const r of platRows) by_platform[r.platform] = r.cnt;

  const verticals = await query(
    `SELECT v.id, v.name FROM verticals v JOIN clients cl ON v.client_id = cl.id
     WHERE v.is_active = 1 AND cl.is_deleted = 0 AND cl.status = 'active'`
  );
  const by_client = [];
  for (const v of verticals) {
    const [cc] = await query('SELECT COUNT(*) AS cnt FROM contents WHERE vertical_id = ? AND is_deleted = 0', [v.id]);
    const [tc] = await query(
      `SELECT COUNT(*) AS cnt FROM tasks t LEFT JOIN contents ct ON t.content_id = ct.id
       WHERE t.is_deleted = 0 AND (t.vertical_id = ? OR ct.vertical_id = ?)`, [v.id, v.id]
    );
    by_client.push({ vertical_name: v.name, content_count: cc.cnt, task_count: tc.cnt });
  }

  return {
    report_type: 'overview',
    summary: {
      total_content: totalContent.cnt, total_tasks: totalTasks.cnt,
      completed_tasks: completedTasks.cnt, overdue_tasks: overdue.cnt,
      pending_approvals: pending.cnt, by_status, by_platform, by_client,
    },
  };
}

// ── GET /api/v1/reports/data ────────────────────────────────────────────────

router.get('/data', authenticate, async (req, res, next) => {
  try {
    const { report_type = 'content', vertical_id, date_from, date_to, status,
            task_type, platform, assigned_to, page = 1, per_page = 50 } = req.query;
    const pageNum = parseInt(page, 10);
    const limit = Math.min(parseInt(per_page, 10), 500);
    const offset = (pageNum - 1) * limit;
    const filters = { vertical_id, date_from, date_to, status, task_type, platform, assigned_to };

    const filters_applied = {};
    for (const [k, v] of Object.entries(filters)) { if (v) filters_applied[k] = v; }

    if (report_type === 'overview') {
      return res.json(await buildOverview(filters));
    }

    if (report_type === 'tasks') {
      const tw = buildTaskWhere(filters);
      const [total] = await query(
        `SELECT COUNT(*) AS cnt FROM tasks t LEFT JOIN contents ct ON t.content_id = ct.id WHERE ${tw.where}`, tw.params
      );
      const today = new Date().toISOString().split('T')[0];
      const rows = await query(
        `SELECT t.id, v.name AS vertical_name, t.title, t.stage, t.task_type, t.status, t.due_date,
                u.full_name AS assignee_name, ct.title AS content_title
         FROM tasks t
         LEFT JOIN contents ct ON t.content_id = ct.id
         LEFT JOIN users u ON t.assigned_to = u.id
         LEFT JOIN verticals v ON COALESCE(t.vertical_id, ct.vertical_id) = v.id
         WHERE ${tw.where}
         ORDER BY t.due_date DESC LIMIT ? OFFSET ?`,
        [...tw.params, limit, offset]
      );
      const taskRows = rows.map(r => ({
        ...r,
        is_overdue: r.due_date && r.due_date < today && !['completed', 'rejected'].includes(r.status),
      }));
      return res.json({ report_type, filters_applied, total: total.cnt, page: pageNum, per_page: limit, rows: taskRows });
    }

    // Default: content
    const cw = buildContentWhere(filters);
    const [total] = await query(`SELECT COUNT(*) AS cnt FROM contents c WHERE ${cw.where}`, cw.params);
    const rows = await query(
      `SELECT c.id, v.name AS vertical_name, c.title, c.content_type, c.platform, c.status, c.scheduled_date,
              (SELECT COUNT(*) FROM tasks WHERE content_id = c.id AND is_deleted = 0) AS task_count,
              (SELECT COUNT(*) FROM tasks WHERE content_id = c.id AND is_deleted = 0 AND status = 'completed') AS completed_tasks
       FROM contents c
       LEFT JOIN verticals v ON c.vertical_id = v.id
       WHERE ${cw.where}
       ORDER BY c.scheduled_date DESC LIMIT ? OFFSET ?`,
      [...cw.params, limit, offset]
    );
    res.json({ report_type, filters_applied, total: total.cnt, page: pageNum, per_page: limit, rows });
  } catch (err) { next(err); }
});

// ── GET /api/v1/reports/export/excel ────────────────────────────────────────

router.get('/export/excel', authenticate, async (req, res, next) => {
  try {
    const ExcelJS = require('exceljs');
    const { report_type = 'content', vertical_id, date_from, date_to, status,
            task_type, platform, assigned_to } = req.query;
    const filters = { vertical_id, date_from, date_to, status, task_type, platform, assigned_to };

    const wb = new ExcelJS.Workbook();

    // Summary sheet
    const ws1 = wb.addWorksheet('Summary');
    ws1.getCell('A1').value = 'DigiMark Social Calendar — Report';
    ws1.getCell('A1').font = { bold: true, size: 14 };
    ws1.getCell('A2').value = `Generated: ${new Date().toISOString().substring(0, 16).replace('T', ' ')}`;
    ws1.getCell('A3').value = `Report Type: ${report_type.charAt(0).toUpperCase() + report_type.slice(1)}`;
    let row = 5;
    for (const [k, v] of Object.entries(filters)) {
      if (v) { ws1.getCell(`A${row}`).value = `  ${k}: ${v}`; row++; }
    }
    ws1.getColumn('A').width = 40;

    // Data sheet
    const ws2 = wb.addWorksheet('Data');
    const headerStyle = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1F36' } }, alignment: { horizontal: 'center' } };
    const altFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };

    let headers, dataRows;

    if (report_type === 'tasks') {
      const tw = buildTaskWhere(filters);
      const today = new Date().toISOString().split('T')[0];
      const rows = await query(
        `SELECT t.id, v.name AS vertical_name, t.title, t.stage, t.task_type, t.status, t.due_date,
                u.full_name AS assignee_name, ct.title AS content_title
         FROM tasks t LEFT JOIN contents ct ON t.content_id = ct.id LEFT JOIN users u ON t.assigned_to = u.id
         LEFT JOIN verticals v ON COALESCE(t.vertical_id, ct.vertical_id) = v.id
         WHERE ${tw.where} ORDER BY t.due_date DESC`, tw.params
      );
      headers = ['ID', 'Vertical', 'Title', 'Stage', 'Task Type', 'Status', 'Due Date', 'Assignee', 'Content Title', 'Overdue'];
      dataRows = rows.map(r => [r.id, r.vertical_name, r.title, r.stage, r.task_type, r.status, r.due_date, r.assignee_name, r.content_title, r.due_date < today && !['completed', 'rejected'].includes(r.status) ? 'Yes' : 'No']);
    } else if (report_type === 'overview') {
      const overview = await buildOverview(filters);
      const s = overview.summary;
      headers = ['Metric', 'Value'];
      dataRows = [
        ['Total Content', s.total_content], ['Total Tasks', s.total_tasks],
        ['Completed Tasks', s.completed_tasks], ['Overdue Tasks', s.overdue_tasks],
        ['Pending Approvals', s.pending_approvals],
      ];
      for (const [k, v] of Object.entries(s.by_status)) dataRows.push([`Status: ${k}`, v]);
      for (const [k, v] of Object.entries(s.by_platform)) dataRows.push([`Platform: ${k}`, v]);
      for (const cl of s.by_client) dataRows.push([`Vertical: ${cl.vertical_name}`, `Content: ${cl.content_count}, Tasks: ${cl.task_count}`]);
    } else {
      const cw = buildContentWhere(filters);
      const rows = await query(
        `SELECT c.id, v.name AS vertical_name, c.title, c.content_type, c.platform, c.status, c.scheduled_date,
                (SELECT COUNT(*) FROM tasks WHERE content_id = c.id AND is_deleted = 0) AS task_count,
                (SELECT COUNT(*) FROM tasks WHERE content_id = c.id AND is_deleted = 0 AND status = 'completed') AS completed_tasks
         FROM contents c LEFT JOIN verticals v ON c.vertical_id = v.id
         WHERE ${cw.where} ORDER BY c.scheduled_date DESC`, cw.params
      );
      headers = ['ID', 'Vertical', 'Title', 'Content Type', 'Platform', 'Status', 'Scheduled Date', 'Total Tasks', 'Completed Tasks'];
      dataRows = rows.map(r => [r.id, r.vertical_name, r.title, r.content_type, r.platform, r.status, r.scheduled_date, r.task_count, r.completed_tasks]);
    }

    // Write headers
    const headerRow = ws2.addRow(headers);
    headerRow.eachCell(cell => { Object.assign(cell, headerStyle); cell.font = headerStyle.font; cell.fill = headerStyle.fill; cell.alignment = headerStyle.alignment; });

    // Write data
    dataRows.forEach((vals, i) => {
      const r = ws2.addRow(vals);
      if (i % 2 === 1) r.eachCell(cell => { cell.fill = altFill; });
    });

    // Auto-fit
    ws2.columns.forEach(col => {
      let maxLen = 0;
      col.eachCell({ includeEmpty: false }, cell => { maxLen = Math.max(maxLen, String(cell.value || '').length); });
      col.width = Math.min(maxLen + 4, 50);
    });

    const today = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="digimark-report-${today}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// ── GET /api/v1/reports/export/pdf ──────────────────────────────────────────

router.get('/export/pdf', authenticate, async (req, res, next) => {
  try {
    const PDFDocument = require('pdfkit');
    const { report_type = 'content', vertical_id, date_from, date_to, status,
            task_type, platform, assigned_to } = req.query;
    const filters = { vertical_id, date_from, date_to, status, task_type, platform, assigned_to };

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    const today = new Date().toISOString().split('T')[0];

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="digimark-report-${today}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fontSize(16).fillColor('#1A1F36').text('DigiMark Social Calendar', { align: 'left' });
    doc.fontSize(10).fillColor('gray').text(`${report_type.charAt(0).toUpperCase() + report_type.slice(1)} Report — Generated ${today}`);
    doc.moveDown(0.5);

    // Filters
    const filtersText = Object.entries(filters).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' | ');
    if (filtersText) { doc.fontSize(9).fillColor('gray').text(`Filters: ${filtersText}`); doc.moveDown(0.5); }

    let headers, dataRows;

    if (report_type === 'tasks') {
      const tw = buildTaskWhere(filters);
      const rows = await query(
        `SELECT t.id, v.name AS vertical_name, t.title, t.stage, t.task_type, t.status, t.due_date,
                u.full_name AS assignee_name, ct.title AS content_title
         FROM tasks t LEFT JOIN contents ct ON t.content_id = ct.id LEFT JOIN users u ON t.assigned_to = u.id
         LEFT JOIN verticals v ON COALESCE(t.vertical_id, ct.vertical_id) = v.id
         WHERE ${tw.where} ORDER BY t.due_date DESC`, tw.params
      );
      headers = ['ID', 'Vertical', 'Title', 'Stage', 'Type', 'Status', 'Due', 'Assignee'];
      dataRows = rows.map(r => [String(r.id), r.vertical_name || '', r.title || '', r.stage || '', r.task_type || '', r.status || '', r.due_date || '', r.assignee_name || '']);
    } else if (report_type === 'overview') {
      const overview = await buildOverview(filters);
      const s = overview.summary;
      headers = ['Metric', 'Value'];
      dataRows = [
        ['Total Content', String(s.total_content)], ['Total Tasks', String(s.total_tasks)],
        ['Completed Tasks', String(s.completed_tasks)], ['Overdue Tasks', String(s.overdue_tasks)],
        ['Pending Approvals', String(s.pending_approvals)],
      ];
    } else {
      const cw = buildContentWhere(filters);
      const rows = await query(
        `SELECT c.id, v.name AS vertical_name, c.title, c.content_type, c.platform, c.status, c.scheduled_date,
                (SELECT COUNT(*) FROM tasks WHERE content_id = c.id AND is_deleted = 0) AS task_count,
                (SELECT COUNT(*) FROM tasks WHERE content_id = c.id AND is_deleted = 0 AND status = 'completed') AS completed_tasks
         FROM contents c LEFT JOIN verticals v ON c.vertical_id = v.id
         WHERE ${cw.where} ORDER BY c.scheduled_date DESC`, cw.params
      );
      headers = ['ID', 'Vertical', 'Title', 'Type', 'Platform', 'Status', 'Date', 'Tasks', 'Done'];
      dataRows = rows.map(r => [String(r.id), r.vertical_name || '', r.title || '', r.content_type || '', r.platform || '', r.status || '', r.scheduled_date || '', String(r.task_count), String(r.completed_tasks)]);
    }

    // Draw table
    const colCount = headers.length;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / colCount;
    const startX = doc.page.margins.left;
    let y = doc.y + 10;

    // Header row
    doc.fontSize(7).fillColor('white');
    for (let i = 0; i < colCount; i++) {
      doc.rect(startX + i * colWidth, y, colWidth, 18).fill('#1A1F36');
      doc.fillColor('white').text(headers[i], startX + i * colWidth + 3, y + 5, { width: colWidth - 6, align: 'left' });
    }
    y += 18;

    // Data rows
    doc.fillColor('#333333').fontSize(6);
    for (let r = 0; r < dataRows.length; r++) {
      if (y > doc.page.height - 60) { doc.addPage(); y = doc.page.margins.top; }
      const bg = r % 2 === 1 ? '#F3F4F6' : '#FFFFFF';
      for (let c = 0; c < colCount; c++) {
        doc.rect(startX + c * colWidth, y, colWidth, 16).fill(bg);
        doc.fillColor('#333333').text(dataRows[r][c] || '', startX + c * colWidth + 3, y + 4, { width: colWidth - 6, align: 'left' });
      }
      y += 16;
    }

    doc.end();
  } catch (err) { next(err); }
});

// ── GET /api/v1/reports/filter-options ──────────────────────────────────────

router.get('/filter-options', authenticate, async (req, res, next) => {
  try {
    const verticals = await query(
      `SELECT v.id, v.name, c.name AS client_name FROM verticals v
       JOIN clients c ON v.client_id = c.id
       WHERE v.is_active = 1 AND c.is_deleted = 0 AND c.status = 'active'
       ORDER BY c.name, v.sort_order, v.name`
    );
    const users = await query('SELECT id, full_name AS name FROM users WHERE is_active = 1 ORDER BY full_name');

    const statuses = ['draft', 'scripting', 'shooting', 'editing', 'design', 'review', 'pending_approval', 'approved', 'scheduled', 'published', 'rejected'];
    const platforms = ['instagram', 'facebook', 'youtube', 'linkedin', 'twitter'];

    res.json({ verticals, users, statuses, platforms });
  } catch (err) { next(err); }
});

module.exports = router;
