const { Pool } = require('pg');
require('dotenv').config();

const dbHost = process.env.DB_HOST || '127.0.0.1';
const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
const dbUser = process.env.DB_USER || 'sahilsharma6162';
const dbPassword = process.env.DB_PASSWORD || '';
const dbName = process.env.DB_NAME || 'ticket_triage';

const pool = new Pool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  database: dbName,
});

// Verify connectivity on import
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('[-] PostgreSQL Connection Error:', err.message);
  } else {
    console.log(`[+] PostgreSQL Connected Successfully to "${dbName}" at ${dbHost}:${dbPort}`);
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
