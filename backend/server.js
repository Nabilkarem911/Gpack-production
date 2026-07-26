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
const authorize = require('./middleware/authorize');
const log = require('./utils/logger');
const metrics = require('./utils/metrics');

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
            const rawSql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

            // Split SQL into individual statements so that one failure doesn't
            // rollback the entire migration (e.g. "column already exists" on one
            // ALTER shouldn't prevent the rest of the ALTERs from running).
            const statements = rawSql
                .split(/;[ \t]*\r?\n/)
                .map(s => s.trim())
                .filter(s => s.length > 0);

            let skippedAny = false;
            let failedAny = false;

            for (const stmt of statements) {
                try {
                    await client.query(stmt);
                } catch (err) {
                    const msg = err.message || '';
                    const alreadyExists = /already exists/i.test(msg);
                    const duplicateColumn = /column .* already exists/i.test(msg);
                    const duplicateObject = /duplicate/i.test(msg);
                    const notFound = /does not exist/i.test(msg);

                    if (alreadyExists || duplicateColumn || duplicateObject) {
                        // Benign — object/column already exists, skip
                        skippedAny = true;
                        continue;
                    }
                    if (notFound && /DROP CONSTRAINT|DROP INDEX|DROP TRIGGER/i.test(stmt)) {
                        // Benign — trying to drop something that doesn't exist
                        skippedAny = true;
                        continue;
                    }
                    // Real error — log and abort
                    console.error(`[Migrate] Failed statement in ${file}: ${msg}`);
                    console.error(`[Migrate] Statement: ${stmt.substring(0, 200)}...`);
                    failedAny = true;
                    break;
                }
            }

            if (failedAny) {
                throw new Error(`Migration ${file} failed — see logs above`);
            }

            // Mark as applied
            await client.query(
                'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
                [file]
            );
            if (skippedAny) {
                console.warn(`[Migrate] Done with warnings: ${file} (some statements skipped)`);
            } else {
                console.log(`[Migrate] Done: ${file}`);
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

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// Public routes rate limiter
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// =============================================================================
// Global Middleware
// =============================================================================

// Disable ETag to prevent 304 Not Modified responses that cause stale API data
app.set('etag', false);

app.use(helmet({
  contentSecurityPolicy: false,  // CSP is set by nginx for frontend
  crossOriginEmbedderPolicy: false,
  hsts: false,                   // HSTS is set by nginx/Cloudflare
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
// NOTE: In production, ALWAYS set CORS_ORIGIN in .env to your domain.
// Default 'http://localhost' is safe for development only.

app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

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
// Metrics Endpoint (Prometheus-style)
// Protected by authenticate + authorize to prevent public access.
// =============================================================================
app.get('/api/metrics', authenticate, authorize(['super_admin', 'manager']), async (req, res) => {
  try {
    const text = await metrics.collectMetrics();
    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(text);
  } catch (err) {
    log.error('metrics_error', { error: err.message });
    res.status(500).send('# Error collecting metrics');
  }
});

// =============================================================================
// Protected Migration Endpoint (super_admin only)
// =============================================================================
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
_mountRoute('/direct-receipts',    authenticate, require('./routes/direct-receipts'));
_mountRoute('/account-statement',   authenticate, require('./routes/account-statement'));
_mountRoute('/receipt-vouchers',    authenticate, require('./routes/receipt-vouchers'));
_mountRoute('/payment-vouchers',    authenticate, require('./routes/payment-vouchers'));
_mountRoute('/accounts',            authenticate, require('./routes/accounts'));
_mountRoute('/journal-entries',     authenticate, require('./routes/journal-entries'));
_mountRoute('/tasks',               authenticate, require('./routes/tasks'));
_mountRoute('/forecast',            authenticate, require('./routes/forecast'));
_mountRoute('/ai-assistant',        authenticate, require('./routes/ai-assistant'));
_mountRoute('/designer',            authenticate, require('./routes/designer'));
_mountRoute('/notifications',       authenticate, require('./routes/notifications'));
_mountRoute('/public',              publicLimiter, require('./routes/public-statement')); // No auth required
_mountRoute('/public/invoice',      publicLimiter, require('./routes/public-invoice'));   // No auth required
_mountRoute('/public/design',       publicLimiter, require('./routes/public-design'));    // No auth required

// Static files for uploads — serve with proper headers and no fallthrough to 404 JSON
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir, {
    fallthrough: false,
    maxAge: '7d',
    setHeaders: (res, filePath) => {
        if (filePath.match(/\.(jpg|jpeg|png|gif|webp|pdf)$/i)) {
            res.setHeader('Cache-Control', 'public, max-age=604800');
        }
    }
}));

// Fallback for /uploads — return 404 with plain text instead of JSON for missing files
app.use('/uploads', (req, res) => {
    res.status(404).send('File not found');
});

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
        const server = app.listen(PORT, () => {
            console.log(`[Server] G.PACK 2.0 Backend running on port ${PORT}`);
            console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);
            console.log(`[Server] Notification Worker: separate container (notification-worker)`);
        });

        // Graceful shutdown — close HTTP server then drain DB pool
        const shutdown = async (signal) => {
            console.log(`[Server] ${signal} received, shutting down gracefully...`);
            server.close(async () => {
                try {
                    await db.pool.end();
                    console.log('[DB] Pool closed successfully.');
                    process.exit(0);
                } catch (err) {
                    console.error('[DB] Error closing pool:', err.message);
                    process.exit(1);
                }
            });
            // Force exit after 10s if connections hang
            setTimeout(() => {
                console.error('[Server] Forced shutdown after 10s timeout.');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        // Prevent process crash on unhandled errors
        process.on('uncaughtException', (err) => {
            console.error('[Server] Uncaught Exception:', err.message);
            console.error(err.stack);
        });
        process.on('unhandledRejection', (reason, promise) => {
            console.error('[Server] Unhandled Rejection:', reason);
        });
    })
    .catch((err) => {
        console.error('[Server] Migration failed, aborting startup:', err.message);
        process.exit(1);
    });

module.exports = app;
