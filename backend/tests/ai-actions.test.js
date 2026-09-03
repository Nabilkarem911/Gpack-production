'use strict';

// =============================================================================
// G.PACK 2.0 — AI Actions Tests
// Phase 31.3: Regression tests for AI write actions
//
// Run: node backend/tests/ai-actions.test.js
// =============================================================================

const { AI_ACTIONS, ACTION_MAP } = require('../utils/ai-actions');
const { auditActions, validateActionIdempotency } = require('../utils/ai-safety');

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
    console.log('  G.PACK 2.0 — AI Actions Safety Tests');
    console.log('═══════════════════════════════════════════════════════════');

    // ── 1. Structure validation ─────────────────────────────────────────────
    await test('All AI actions have required structure', async () => {
        assert(AI_ACTIONS.length > 0, 'AI_ACTIONS array should not be empty');

        for (const action of AI_ACTIONS) {
            assert(action.type, 'Every action must have a type');
            assert(typeof action.propose === 'function', `Action "${action.type}" must have propose() method`);
            assert(typeof action.execute === 'function', `Action "${action.type}" must have execute() method`);
        }
    });

    // ── 2. ACTION_MAP completeness ──────────────────────────────────────────
    await test('ACTION_MAP contains all actions', async () => {
        for (const action of AI_ACTIONS) {
            assert(ACTION_MAP[action.type] !== undefined, `ACTION_MAP missing "${action.type}"`);
        }
    });

    // ── 3. No duplicate action types ────────────────────────────────────────
    await test('No duplicate action types', async () => {
        const types = AI_ACTIONS.map(a => a.type);
        const unique = new Set(types);
        assert(types.length === unique.size, `Found ${types.length - unique.size} duplicate action types`);
    });

    // ── 4. Safety audit ─────────────────────────────────────────────────────
    await test('Safety audit passes for all actions', async () => {
        const audit = auditActions(AI_ACTIONS);
        console.log(`  Audit: ${audit.passed}/${audit.total} passed, ${audit.failed} failed`);
        assert(audit.failed === 0, `${audit.failed} actions failed safety audit`);
    });

    // ── 5. Idempotency validation ───────────────────────────────────────────
    await test('Action idempotency validation works', async () => {
        const goodAction = {
            type: 'test_good',
            propose: async () => ({}),
            execute: async () => ({}),
        };
        const badAction = {
            type: 'test_bad',
            // missing propose and execute
        };
        assert(validateActionIdempotency(goodAction).valid === true, 'Good action should pass');
        assert(validateActionIdempotency(badAction).valid === false, 'Bad action should fail');
    });

    // ── 6. Actions list ─────────────────────────────────────────────────────
    await test('Expected actions exist', async () => {
        const expectedActions = [
            'create_client',
            'create_quote',
            'add_payment',
            'convert_quote_to_invoice',
        ];
        for (const type of expectedActions) {
            assert(ACTION_MAP[type] !== undefined, `Expected action "${type}" not found`);
        }
    });

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  RESULTS: ${_passed} passed, ${_failed} failed`);
    console.log(`  Total AI Actions: ${AI_ACTIONS.length}`);
    if (_failures.length > 0) {
        console.log('\n  FAILURES:');
        _failures.forEach(f => console.log(`    ✗ ${f}`));
    }
    console.log('═══════════════════════════════════════════════════════════\n');

    if (!process.env.JEST_WORKER_ID) process.exit(_failed > 0 ? 1 : 0);
}

if (typeof describe !== 'undefined') {
    describe('AI Actions', () => {
        it('runs safety checks', async () => {
            await runTests();
            expect(_failed).toBe(0);
        });
    });
} else {
    runTests().catch(err => {
        console.error('Fatal test error:', err);
        if (!process.env.JEST_WORKER_ID) process.exit(1);
    });
}
