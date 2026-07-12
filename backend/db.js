'use strict';

const { Pool } = require('pg');

// =============================================================================
// G.PACK 2.0 - Database Connection Pool
// Raw PostgreSQL via `pg`. NO ORM. Absolute transaction control.
// Environment variables map directly to docker-compose service configuration.
// =============================================================================

const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  database: process.env.DATABASE_NAME || 'gpack_db',
  user: process.env.DATABASE_USER || 'gpack_user',
  password: process.env.DATABASE_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('connect', (client) => {
  console.log('[DB] New client connected to PostgreSQL pool.');
  client.query('SET statement_timeout = 30000').catch(err => {
    console.error('[DB] Failed to set statement_timeout:', err.message);
  });
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err.message);
  // Do NOT process.exit(1) here — let the pool recover idle clients gracefully.
});

// =============================================================================
// query()
// Executes a single raw SQL query using a pool client.
// Use for all simple, non-transactional reads and writes.
//
// @param {string} text   - Parameterized SQL string (e.g. 'SELECT * FROM users WHERE id = $1')
// @param {Array}  params - Array of parameter values (e.g. [userId])
// @returns {Promise<pg.QueryResult>}
// =============================================================================
const query = (text, params) => pool.query(text, params);

// =============================================================================
// getClient()
// Checks out a dedicated client from the pool for use in a manual transaction.
// The caller is responsible for calling client.release() in a finally block.
//
// @returns {Promise<pg.PoolClient>}
// =============================================================================
const getClient = () => pool.connect();

// =============================================================================
// Transaction Helpers
// These enforce the VMI financial immutability rules and prevent partial writes.
//
// Pattern:
//   const client = await db.getClient();
//   try {
//     await db.begin(client);
//     // ... raw SQL operations using client.query() ...
//     await db.commit(client);
//   } catch (err) {
//     await db.rollback(client);
//     throw err;
//   } finally {
//     client.release();
//   }
// =============================================================================

const begin = (client) => client.query('BEGIN');
const commit = (client) => client.query('COMMIT');
const rollback = (client) => client.query('ROLLBACK');

// =============================================================================
// withTransaction()
// Higher-order helper that wraps an async callback in a full BEGIN/COMMIT/ROLLBACK
// transaction. Automatically releases the client. Use this for all accounting
// voucher writes and any multi-step mutation that must be atomic.
//
// @param {Function} callback - async (client) => { ... }
// @returns {Promise<any>}    - The return value of the callback.
// =============================================================================
const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  query,
  getClient,
  begin,
  commit,
  rollback,
  withTransaction,
};
