'use strict';

// =============================================================================
// G.PACK 2.0 — AI Migrations Tests
// Phase 31.5: Verify all AI-related migrations are idempotent and complete
//
// Run: node backend/tests/ai-migrations.test.js
// =============================================================================

const fs = require('fs');
const path = require('path');

let _passed = 0;
let _failed = 0;
const _failures = [];

function assert(condition, message) {
    if (condition) {
        _passed++;
    } else {
        _failed++;
        _failures.push(message);
        console.error(`  ✗ FAIL: ${message}`);
    }
}

async function test(name, fn) {
    console.log(`\n▶ ${name}`);
    try {
        await fn();
    } catch (err) {
        _failed++;
        _failures.push(`${name}: ${err.message}`);
        console.error(`  ✗ ERROR: ${err.message}`);
    }
}

async function runTests() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  G.PACK 2.0 — AI Migrations Safety Tests');
    console.log('═══════════════════════════════════════════════════════════');

    const migrationsDir = path.join(__dirname, '..', 'migrations');

    // ── 1. Migrations directory exists ──────────────────────────────────────
    await test('Migrations directory exists', async () => {
        assert(fs.existsSync(migrationsDir), 'Migrations directory should exist');
    });

    // ── 2. AI-related migrations exist ──────────────────────────────────────
    await test('AI-related migration files exist', async () => {
        const expectedMigrations = [
            '060_business_events.sql',
            '063_recurring_order_templates.sql',
            '064_ai_feedback.sql',
            '065_ai_briefings.sql',
            '066_067_068_prompt_flags_goals.sql',
        ];

        for (const file of expectedMigrations) {
            const filePath = path.join(migrationsDir, file);
            assert(fs.existsSync(filePath), `Migration file "${file}" should exist`);
        }
    });

    // ── 3. All migrations use IF NOT EXISTS (idempotency) ───────────────────
    await test('All AI migrations use IF NOT EXISTS for idempotency', async () => {
        const aiMigrationFiles = fs.readdirSync(migrationsDir)
            .filter(f => f.match(/^06[0-9]_.*\.sql$/) || f.match(/^06[0-9]_[0-9]+_.*\.sql$/));

        for (const file of aiMigrationFiles) {
            const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
            if (content.includes('CREATE TABLE')) {
                assert(content.includes('CREATE TABLE IF NOT EXISTS'),
                    `Migration "${file}" uses CREATE TABLE without IF NOT EXISTS — not idempotent`);
            }
            if (content.includes('CREATE INDEX')) {
                assert(content.includes('CREATE INDEX IF NOT EXISTS'),
                    `Migration "${file}" uses CREATE INDEX without IF NOT EXISTS — not idempotent`);
            }
        }
    });

    // ── 4. No DROP statements in migrations ─────────────────────────────────
    await test('No DROP statements in AI migrations', async () => {
        const aiMigrationFiles = fs.readdirSync(migrationsDir)
            .filter(f => f.match(/^06[0-9]_.*\.sql$/) || f.match(/^06[0-9]_[0-9]+_.*\.sql$/));

        for (const file of aiMigrationFiles) {
            const rawContent = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
            // Strip SQL comments (-- lines) before checking
            const content = rawContent.split('\n')
                .filter(line => !line.trim().startsWith('--'))
                .join('\n')
                .toUpperCase();
            // DROP TABLE IF EXISTS in comments is fine, but actual DROP TABLE is not
            if (content.includes('DROP TABLE')) {
                // Check if it's only DROP TABLE IF EXISTS (acceptable for DOWN scripts)
                const dropMatches = content.match(/DROP\s+TABLE(?!\s+IF\s+NOT\s+EXISTS)/g);
                // DROP TABLE IF EXISTS is acceptable (safe rollback)
                const unsafeDropMatches = content.match(/DROP\s+TABLE(?!\s+IF\s+EXISTS)/g);
                assert(!unsafeDropMatches || unsafeDropMatches.length === 0,
                    `Migration "${file}" contains unsafe DROP TABLE (without IF EXISTS) — violates non-breaking rules`);
            }
            assert(!content.includes('DROP COLUMN'),
                `Migration "${file}" contains DROP COLUMN — violates non-breaking rules`);
        }
    });

    // ── 5. RLS enabled on AI tables ─────────────────────────────────────────
    await test('AI tables have RLS enabled', async () => {
        const combinedMigration = fs.readFileSync(
            path.join(migrationsDir, '066_067_068_prompt_flags_goals.sql'), 'utf8'
        );
        assert(combinedMigration.includes('ENABLE ROW LEVEL SECURITY'),
            'AI tables should have RLS enabled');
        assert(combinedMigration.includes('CREATE POLICY'),
            'AI tables should have RLS policies');
    });

    // ── 6. Feature flags seeded ─────────────────────────────────────────────
    await test('Feature flags are seeded with defaults', async () => {
        const combinedMigration = fs.readFileSync(
            path.join(migrationsDir, '066_067_068_prompt_flags_goals.sql'), 'utf8'
        );
        assert(combinedMigration.includes('INSERT INTO ai_feature_flags'),
            'Feature flags should be seeded');
        assert(combinedMigration.includes('ON CONFLICT'),
            'Feature flag seeding should use ON CONFLICT for idempotency');
    });

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  RESULTS: ${_passed} passed, ${_failed} failed`);
    if (_failures.length > 0) {
        console.log('\n  FAILURES:');
        _failures.forEach(f => console.log(`    ✗ ${f}`));
    }
    console.log('═══════════════════════════════════════════════════════════\n');

    process.exit(_failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
