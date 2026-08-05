const mysql = require('mysql2/promise');

/**
 * Shared connection pool. Every query in the app goes through this —
 * never open ad-hoc connections in a request handler.
 */
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'HYT_TEST',
  port: Number(process.env.DB_PORT) || 8889,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: ['DATE'], // keep DATE columns as 'YYYY-MM-DD', no timezone drift
});

module.exports = pool;
