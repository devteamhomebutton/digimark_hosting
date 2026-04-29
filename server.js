const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./app/config');
const errorHandler = require('./app/middleware/errorHandler');

const app = express();

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: config.ALLOWED_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ──────────────────────────────────────────────────────────────────
const authRoutes = require('./app/routes/auth');
const clientRoutes = require('./app/routes/clients');
const calendarRoutes = require('./app/routes/calendar');
const taskRoutes = require('./app/routes/tasks');
const contentTaskRoutes = require('./app/routes/contentTasks');
const dashboardRoutes = require('./app/routes/dashboard');
const teamRoutes = require('./app/routes/team');
const verticalRoutes = require('./app/routes/verticals');
const approvalRoutes = require('./app/routes/approvals');
const pipelineTemplateRoutes = require('./app/routes/pipelineTemplates');
const importRoutes = require('./app/routes/imports');
const reportRoutes = require('./app/routes/reports');

app.use('/auth', authRoutes);
app.use('/api/v1/clients', clientRoutes);
app.use('/api/v1', calendarRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1', contentTaskRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/team', teamRoutes);
app.use('/api/v1', verticalRoutes);
app.use('/api/v1/approvals', approvalRoutes);
app.use('/api/v1', pipelineTemplateRoutes);
app.use('/api/v1', importRoutes);
app.use('/api/v1/reports', reportRoutes);

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', app: config.APP_NAME });
});

// ── Serve React frontend (production) ───────────────────────────────────────
const STATIC_DIR = path.join(__dirname, 'static');
if (fs.existsSync(STATIC_DIR)) {
  app.use('/assets', express.static(path.join(STATIC_DIR, 'assets')));
  app.use(express.static(STATIC_DIR));

  // SPA catch-all
  app.get('*', (req, res) => {
    const indexPath = path.join(STATIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.json({ detail: 'Frontend not built. Run: cd frontend && npm run build' });
    }
  });
}

// ── Error handler ───────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start server ────────────────────────────────────────────────────────────
// iisnode sets process.env.PORT to a named pipe like \\.\pipe\GUID
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`${config.APP_NAME} running on port ${PORT}`);
});

module.exports = app;
