'use strict';

// =============================================================================
// G.PACK 2.0 — MCP Server
// وصل AI بقاعدة البيانات الحية والـ Docker
// =============================================================================

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.MCP_PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: process.env.DATABASE_PORT || 5432,
  database: process.env.DATABASE_NAME || 'gpack_db',
  user: process.env.DATABASE_USER || 'gpack_user',
  password: process.env.DATABASE_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Health Check
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ 
      status: 'healthy', 
      database: result.rows[0].now,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ 
      status: 'unhealthy', 
      error: err.message 
    });
  }
});

// =============================================================================
// MCP API Endpoints - واجهة AI بالداتا
// =============================================================================

// Get all tables with their structure
app.get('/api/tables', async (req, res) => {
  try {
    const query = `
      SELECT table_name, table_type 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `;
    const result = await pool.query(query);
    res.json({ 
      data: result.rows,
      message: 'Tables retrieved successfully',
      total: result.rows.length
    });
  } catch (err) {
    res.status(500).json({ 
      error: err.message,
      message: 'Failed to retrieve tables'
    });
  }
});

// Get table structure
app.get('/api/tables/:table/structure', async (req, res) => {
  try {
    const { table } = req.params;
    const query = `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `;
    const result = await pool.query(query, [table]);
    res.json({ 
      data: result.rows,
      message: `Structure for ${table} retrieved successfully`,
      total: result.rows.length
    });
  } catch (err) {
    res.status(500).json({ 
      error: err.message,
      message: 'Failed to retrieve table structure'
    });
  }
});

// Get table data with pagination
app.get('/api/tables/:table/data', async (req, res) => {
  try {
    const { table } = req.params;
    const { limit = 20, offset = 0, where } = req.query;
    
    let query = `SELECT * FROM ${table}`;
    let params = [];
    
    if (where) {
      query += ` WHERE ${where}`;
    }
    
    query += ` ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await pool.query(query, params);
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM ${table} ${where ? `WHERE ${where}` : ''}`;
    const countResult = await pool.query(countQuery);
    
    res.json({ 
      data: result.rows,
      message: `Data from ${table} retrieved successfully`,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    res.status(500).json({ 
      error: err.message,
      message: 'Failed to retrieve table data'
    });
  }
});

// Execute custom query (read-only)
app.post('/api/query', async (req, res) => {
  try {
    const { query, params = [] } = req.body;
    
    // Security: Only allow SELECT queries
    if (!query.trim().toLowerCase().startsWith('select')) {
      return res.status(403).json({ 
        error: 'Only SELECT queries are allowed',
        message: 'For security reasons, only read-only queries are permitted'
      });
    }
    
    const result = await pool.query(query, params);
    res.json({ 
      data: result.rows,
      message: 'Query executed successfully',
      total: result.rows.length
    });
  } catch (err) {
    res.status(500).json({ 
      error: err.message,
      message: 'Query execution failed'
    });
  }
});

// Get system status and statistics
app.get('/api/status', async (req, res) => {
  try {
    const queries = {
      total_clients: 'SELECT COUNT(*) as count FROM clients',
      total_products: 'SELECT COUNT(*) as count FROM products',
      total_orders: 'SELECT COUNT(*) as count FROM orders',
      total_invoices: 'SELECT COUNT(*) as count FROM invoices',
      warehouse_stock: 'SELECT SUM(quantity) as total FROM warehouse_stock',
      recent_activities: `
        SELECT 'Order' as type, created_at, id as reference_id 
        FROM orders 
        ORDER BY created_at DESC LIMIT 5
      `
    };
    
    const results = {};
    for (const [key, query] of Object.entries(queries)) {
      try {
        const result = await pool.query(query);
        results[key] = result.rows;
      } catch (err) {
        results[key] = { error: err.message };
      }
    }
    
    res.json({ 
      data: results,
      message: 'System status retrieved successfully',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ 
      error: err.message,
      message: 'Failed to retrieve system status'
    });
  }
});

// =============================================================================
// Error Handling
// =============================================================================

// Global error handler
app.use((err, req, res, next) => {
  console.error('MCP Server Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: 'Something went wrong in MCP server'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    message: 'Endpoint not found'
  });
});

// =============================================================================
// Start Server
// =============================================================================

app.listen(PORT, () => {
  console.log(`🚀 G.PACK MCP Server running on port ${PORT}`);
  console.log(`📊 Database: ${process.env.DATABASE_NAME}`);
  console.log(`🔗 Connecting to: ${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🔄 Shutting down MCP Server...');
  await pool.end();
  process.exit(0);
});

module.exports = app;
