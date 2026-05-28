'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { authenticate } = require('./middleware/authMiddleware');

// =============================================================================
// MIGRATION RUNNER
// Runs any new .sql files in /migrations that haven't been applied yet.
// Tracks applied migrations in the `schema_migrations` table.
// Safe to run on every startup — already-applied files are skipped.
// =============================================================================
async function runMigrations() {
    const client = await db.getClient();
    try {
        // Ensure tracking table exists
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename   VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMPTZ  DEFAULT NOW()
            )
        `);

        const migrationsDir = path.join(__dirname, 'migrations');
        if (!fs.existsSync(migrationsDir)) {
            console.log('[Migrate] No migrations directory found, skipping.');
            return;
        }

        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort();

        const appliedRes = await client.query('SELECT filename FROM schema_migrations');
        const applied = new Set(appliedRes.rows.map(r => r.filename));

        for (const file of files) {
            if (applied.has(file)) {
                console.log(`[Migrate] Already applied: ${file}`);
                continue;
            }

            console.log(`[Migrate] Applying: ${file}`);
            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query(
                    'INSERT INTO schema_migrations (filename) VALUES ($1)',
                    [file]
                );
                await client.query('COMMIT');
                console.log(`[Migrate] Done: ${file}`);
            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`[Migrate] Failed: ${file} — ${err.message}`);
                throw err;
            }
        }

        console.log('[Migrate] All migrations applied successfully.');
    } finally {
        client.release();
    }
}

// =============================================================================
// G.PACK 2.0 - Express Application Entry Point
// =============================================================================

const app = express();
const PORT = process.env.PORT || 3000;

// Trust nginx reverse proxy (required for correct IP detection behind Docker+nginx)
app.set('trust proxy', 1);

// =============================================================================
// Security: Rate Limiting
// =============================================================================

// Login rate limiter - prevent brute force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// =============================================================================
// Global Middleware
// =============================================================================

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// =============================================================================
// Request Logger (development-friendly)
// =============================================================================

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// =============================================================================
// Health Check
// Used by Docker healthcheck and load balancers to verify the service is live.
// Also pings the database to confirm connectivity.
// =============================================================================

app.get('/api/health', async (req, res) => {
  try {
    const result = await db.query('SELECT NOW() AS server_time');
    return res.status(200).json({
      status: 'ok',
      service: 'gpack-backend',
      version: '2.0.0',
      db_connected: true,
      server_time: result.rows[0].server_time,
    });
  } catch (err) {
    console.error('[Health] Database ping failed:', err.message);
    return res.status(503).json({
      status: 'error',
      service: 'gpack-backend',
      db_connected: false,
      error: 'Database connection failed.',
    });
  }
});

// =============================================================================
// TEMP: Public Migration Endpoint (No Auth Required)
// =============================================================================
app.get('/api/migrate-tax-rate', async (req, res) => {
    try {
        await db.query(`
            ALTER TABLE manufacturer_orders 
            ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,4) DEFAULT 0
        `);
        res.json({ success: true, message: 'tax_rate column added successfully' });
    } catch (err) {
        console.error('[Migration] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// =============================================================================
// API Routes
// =============================================================================

// Apply rate limiters
app.use('/api/auth', loginLimiter);  // Strict limit for auth endpoints
app.use('/api/', apiLimiter);        // General limit for all API endpoints

app.use('/api/auth',                require('./routes/auth'));
app.use('/api/public',              require('./routes/public_quotation'));
app.use('/api/users',               authenticate, require('./routes/users'));
app.use('/api/clients',             authenticate, require('./routes/clients'));
app.use('/api/products',            authenticate, require('./routes/products'));
app.use('/api/inventory',           authenticate, require('./routes/inventory'));
app.use('/api/categories',          authenticate, require('./routes/categories'));
app.use('/api/units',               authenticate, require('./routes/units'));
app.use('/api/orders',              authenticate, require('./routes/orders'));
app.use('/api/manufacturer-orders', authenticate, require('./routes/manufacturer_orders'));
app.use('/api/suppliers',           authenticate, require('./routes/suppliers'));
app.use('/api/terms',               authenticate, require('./routes/terms'));
app.use('/api/delivery-notes',      authenticate, require('./routes/delivery-notes'));
app.use('/api/dashboard',           authenticate, require('./routes/dashboard'));
app.use('/api/client-designs',        authenticate, require('./routes/client_designs'));
app.use('/api/client-pantone-colors', authenticate, require('./routes/client_pantone_colors'));
app.use('/api/client-items',          authenticate, require('./routes/client_items'));
app.use('/api/manufacturer-orders', authenticate, require('./routes/manufacturer_print'));
app.use('/api/vmi',                 authenticate, require('./routes/vmi'));
app.use('/api/invoices',            authenticate, require('./routes/invoices'));
app.use('/api/purchase-invoices',   authenticate, require('./routes/purchase-invoices'));
app.use('/api/purchase-returns',    authenticate, require('./routes/purchase-returns'));
app.use('/api/receiving-vouchers', authenticate, require('./routes/receiving-vouchers'));
app.use('/api/account-statement',   authenticate, require('./routes/account-statement'));
app.use('/api/receipt-vouchers',    authenticate, require('./routes/receipt-vouchers'));
app.use('/api/payment-vouchers',    authenticate, require('./routes/payment-vouchers'));
app.use('/api/accounts',            authenticate, require('./routes/accounts'));
app.use('/api/journal-entries',     authenticate, require('./routes/journal-entries'));
app.use('/api/public',              require('./routes/public-statement')); // No auth required
app.use('/api/public/invoice',      require('./routes/public-invoice'));   // No auth required

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// =============================================================================
// 404 Handler — catches any unmatched route
// =============================================================================

app.use((req, res) => {
  return res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// =============================================================================
// Global Error Handler
// Catches any unhandled errors thrown by route handlers.
// =============================================================================

app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message);
  return res.status(500).json({ error: 'An unexpected internal server error occurred.' });
});

// =============================================================================
// Start Server
// =============================================================================

runMigrations()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`[Server] G.PACK 2.0 Backend running on port ${PORT}`);
            console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);
        });
    })
    .catch((err) => {
        console.error('[Server] Migration failed, aborting startup:', err.message);
        process.exit(1);
    });

module.exports = app;
