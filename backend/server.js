'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
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
                // If error is "already exists" (42P07 table, 42710 column, bj4vyu constraint, etc.)
                // log warning, mark as applied, and continue so server can start.
                const alreadyExists = /already exists/i.test(err.message);
                const duplicate = /duplicate/i.test(err.message);
                if (alreadyExists || duplicate) {
                    console.warn(`[Migrate] Warning: ${file} — ${err.message} (recording as applied)`);
                    try {
                        await client.query(
                            'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
                            [file]
                        );
                    } catch (e) { /* ignore */ }
                } else {
                    console.error(`[Migrate] Failed: ${file} — ${err.message}`);
                    throw err;
                }
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

// Public routes rate limiter
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// =============================================================================
// Global Middleware
// =============================================================================

app.use(helmet());

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
// NOTE: In production, ALWAYS set CORS_ORIGIN in .env to your domain.
// Default 'http://localhost' is safe for development only.

app.use(cookieParser());
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
// Protected Migration Endpoint (super_admin only)
// =============================================================================
const authorize = require('./middleware/authorize');
app.get('/api/migrate-tax-rate', authenticate, authorize(['super_admin']), async (req, res) => {
    try {
        await db.query(`
            ALTER TABLE manufacturer_orders 
            ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,4) DEFAULT 0
        `);
        res.json({ success: true, message: 'tax_rate column added successfully' });
    } catch (err) {
        console.error('[Migration] Error:', err.message);
        res.status(500).json({ success: false, error: 'Internal server error.' });
    }
});

// =============================================================================
// API Routes
// =============================================================================

// Helper: mount routes under both /api/ and /api/v1/ for backward compatibility
function _mountRoute(basePath, ...handlers) {
  app.use(`/api${basePath}`, ...handlers);
  app.use(`/api/v1${basePath}`, ...handlers);
}

// Apply rate limiters
_mountRoute('/auth', loginLimiter);  // Strict limit for auth endpoints
_mountRoute('/', apiLimiter);        // General limit for all API endpoints

_mountRoute('/auth',                require('./routes/auth'));
_mountRoute('/public',              publicLimiter, require('./routes/public_quotation'));
_mountRoute('/users',               authenticate, require('./routes/users'));
_mountRoute('/clients',             authenticate, require('./routes/clients'));
_mountRoute('/products',            authenticate, require('./routes/products'));
_mountRoute('/inventory',           authenticate, require('./routes/inventory'));
_mountRoute('/categories',          authenticate, require('./routes/categories'));
_mountRoute('/units',               authenticate, require('./routes/units'));
_mountRoute('/orders',              authenticate, require('./routes/orders'));
_mountRoute('/manufacturer-orders', authenticate, require('./routes/manufacturer_orders'));
_mountRoute('/manufacturer-orders',       authenticate, require('./routes/manufacturer_print'));
_mountRoute('/suppliers',           authenticate, require('./routes/suppliers'));
_mountRoute('/terms',               authenticate, require('./routes/terms'));
_mountRoute('/delivery-notes',      authenticate, require('./routes/delivery-notes'));
_mountRoute('/dashboard',           authenticate, require('./routes/dashboard'));
_mountRoute('/client-designs',        authenticate, require('./routes/client_designs'));
_mountRoute('/client-pantone-colors', authenticate, require('./routes/client_pantone_colors'));
_mountRoute('/client-items',          authenticate, require('./routes/client_items'));
_mountRoute('/vmi',                 authenticate, require('./routes/vmi'));
_mountRoute('/invoices',            authenticate, require('./routes/invoices'));
_mountRoute('/purchase-invoices',   authenticate, require('./routes/purchase-invoices'));
_mountRoute('/purchase-returns',    authenticate, require('./routes/purchase-returns'));
_mountRoute('/receiving-vouchers', authenticate, require('./routes/receiving-vouchers'));
_mountRoute('/account-statement',   authenticate, require('./routes/account-statement'));
_mountRoute('/receipt-vouchers',    authenticate, require('./routes/receipt-vouchers'));
_mountRoute('/payment-vouchers',    authenticate, require('./routes/payment-vouchers'));
_mountRoute('/accounts',            authenticate, require('./routes/accounts'));
_mountRoute('/journal-entries',     authenticate, require('./routes/journal-entries'));
_mountRoute('/tasks',               authenticate, require('./routes/tasks'));
_mountRoute('/forecast',            authenticate, require('./routes/forecast'));
_mountRoute('/public',              publicLimiter, require('./routes/public-statement')); // No auth required
_mountRoute('/public/invoice',      publicLimiter, require('./routes/public-invoice'));   // No auth required

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
