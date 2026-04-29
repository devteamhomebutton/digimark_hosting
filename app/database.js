const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  waitForConnections: true,
  connectionLimit: 20,
  maxIdle: 10,
  idleTimeout: 1800000, // 30 minutes
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  dateStrings: ['DATE'],
  typeCast: function (field, next) {
    if (field.type === 'JSON') {
      const val = field.string();
      if (val === null) return null;
      try { return JSON.parse(val); } catch { return val; }
    }
    if (field.type === 'TINY' && field.length === 1) {
      return field.string() === '1';
    }
    return next();
  },
});

async function getConnection() {
  return pool.getConnection();
}

async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function queryOne(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

module.exports = { pool, getConnection, query, queryOne };
