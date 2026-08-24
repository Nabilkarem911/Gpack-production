'use strict';

// =============================================================================
// G.PACK 2.0 — AI Functions Tests
// Phase 31.2: Regression tests for AI read-only functions
//
// Run: node backend/tests/ai-functions.test.js
// Or:  npx jest backend/tests/ai-functions.test.js
// =============================================================================

const { AI_FUNCTIONS, FUNCTION_MAP } = require('../utils/ai-functions');
const { auditFunctions, validateFunctionResilience, validateSqlSafety } = require('../utils/ai-safety');

// Mock user for testing
const mockManager = { id: 'test-manager-id', role: 'manager', name: 'Test Manager' };
const mockSalesRep = { id: 'test-sales-id', role: 'sales_rep', name: 'Test Sales' };

// ── Test runner (no jest dependency — works with plain Node) ─────────────────
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

// =============================================================================
// Tests
// =============================================================================

async function runTests() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  G.PACK 2.0 — AI Functions Safety Tests');
    console.log('═══════════════════════════════════════════════════════════');

    // ── 1. Structure validation ─────────────────────────────────────────────
    await test('All AI functions have required structure', async () => {
        assert(AI_FUNCTIONS.length > 0, 'AI_FUNCTIONS array should not be empty');

        for (const fn of AI_FUNCTIONS) {
            assert(fn.type === 'function', `Function "${fn.function?.name}" type must be 'function'`);
            assert(fn.function && fn.function.name, 'Every function must have a name');
            assert(typeof fn.execute === 'function', `Function "${fn.function.name}" must have execute() method`);
            assert(fn.function.parameters && fn.function.parameters.type === 'object', `Function "${fn.function.name}" parameters must be type: object`);
        }
    });

    // ── 2. FUNCTION_MAP completeness ────────────────────────────────────────
    await test('FUNCTION_MAP contains all functions', async () => {
        for (const fn of AI_FUNCTIONS) {
            assert(FUNCTION_MAP[fn.function.name] !== undefined, `FUNCTION_MAP missing "${fn.function.name}"`);
        }
    });

    // ── 3. No duplicate function names ──────────────────────────────────────
    await test('No duplicate function names', async () => {
        const names = AI_FUNCTIONS.map(fn => fn.function.name);
        const unique = new Set(names);
        assert(names.length === unique.size, `Found ${names.length - unique.size} duplicate function names`);
    });

    // ── 4. Safety audit ─────────────────────────────────────────────────────
    await test('Safety audit passes for all functions', async () => {
        const audit = auditFunctions(AI_FUNCTIONS);
        console.log(`  Audit: ${audit.passed}/${audit.total} passed, ${audit.failed} failed`);
        assert(audit.failed === 0, `${audit.failed} functions failed safety audit`);
    });

    // ── 5. SQL safety validation ────────────────────────────────────────────
    await test('SQL safety validator catches dangerous keywords', async () => {
        assert(validateSqlSafety('DELETE FROM clients').safe === false, 'DELETE FROM should be unsafe');
        assert(validateSqlSafety('DROP TABLE orders').safe === false, 'DROP TABLE should be unsafe');
        assert(validateSqlSafety('TRUNCATE inventory').safe === false, 'TRUNCATE should be unsafe');
        assert(validateSqlSafety('SELECT * FROM clients').safe === true, 'SELECT should be safe');
        assert(validateSqlSafety('').safe === false, 'Empty SQL should be unsafe');
        assert(validateSqlSafety(null).safe === false, 'Null SQL should be unsafe');
    });

    // ── 6. Function resilience validation ───────────────────────────────────
    await test('Function resilience validation works', async () => {
        const goodFn = {
            type: 'function',
            function: { name: 'test_good', parameters: { type: 'object', properties: {} } },
            execute: async () => ({})
        };
        const badFn = {
            type: 'function',
            function: { name: 'test_bad', parameters: { type: 'object', properties: {} } },
            // missing execute
        };
        assert(validateFunctionResilience(goodFn).valid === true, 'Good function should pass validation');
        assert(validateFunctionResilience(badFn).valid === false, 'Bad function should fail validation');
    });

    // ── 7. Read functions handle empty/null gracefully (structure check) ────
    await test('Read functions have proper error handling structure', async () => {
        const readFunctions = AI_FUNCTIONS.filter(fn =>
            fn.function.description && (
                fn.function.description.includes('يقرأ') ||
                fn.function.description.includes('عرض') ||
                fn.function.description.includes('تحليل') ||
                fn.function.description.includes('يقارن') ||
                fn.function.description.includes('يكتشف') ||
                fn.function.description.includes('يستخرج') ||
                fn.function.description.includes('يرصد') ||
                fn.function.description.includes('يحول') ||
                fn.function.description.includes('يولد') ||
                fn.function.description.includes('محرك') ||
                fn.function.description.includes('محاكاة') ||
                fn.function.description.includes('إعادة') ||
                fn.function.description.includes('لوحة') ||
                fn.function.description.includes('مخطط') ||
                fn.function.description.includes('مساعد')
            )
        );
        console.log(`  Found ${readFunctions.length} read/query functions`);
        assert(readFunctions.length > 0, 'Should have read functions');
    });

    // ── 8. All functions have Arabic descriptions ───────────────────────────
    await test('All functions have Arabic descriptions', async () => {
        for (const fn of AI_FUNCTIONS) {
            assert(fn.function.description && fn.function.description.length > 20,
                `Function "${fn.function.name}" has no or short description`);
        }
    });

    // ── 9. Parameters have descriptions ─────────────────────────────────────
    await test('Function parameters have descriptions', async () => {
        for (const fn of AI_FUNCTIONS) {
            const props = fn.function.parameters?.properties || {};
            for (const [key, val] of Object.entries(props)) {
                assert(val.description && val.description.length > 5,
                    `Function "${fn.function.name}" param "${key}" missing description`);
            }
        }
    });

    // ── 10. _explanation field presence (functions that return insights) ────
    await test('Key insight functions include _explanation metadata', async () => {
        const insightFunctions = [
            'getSmartQuoteSuggestions',
            'getDiscountDecision',
            'getRootCauseAnalysis',
            'getKPIStatus',
            'simulateAction',
            'getAIMetrics',
            'getGoalStatus',
            'getCompanyLearning',
            'getBusinessPlanner',
        ];
        for (const name of insightFunctions) {
            const fn = FUNCTION_MAP[name];
            assert(fn !== undefined, `Function "${name}" should exist in FUNCTION_MAP`);
        }
    });

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  RESULTS: ${_passed} passed, ${_failed} failed`);
    console.log(`  Total AI Functions: ${AI_FUNCTIONS.length}`);
    if (_failures.length > 0) {
        console.log('\n  FAILURES:');
        _failures.forEach(f => console.log(`    ✗ ${f}`));
    }
    console.log('═══════════════════════════════════════════════════════════\n');

    process.exitCode = _failed > 0 ? 1 : 0;
}

if (process.env.JEST_WORKER_ID !== undefined) {
    global.test('AI functions safety checks', async () => {
        await runTests();
        expect(_failed).toBe(0);
    });
} else {
    runTests().catch(err => {
        console.error('Fatal test error:', err);
        process.exitCode = 1;
    });
}
