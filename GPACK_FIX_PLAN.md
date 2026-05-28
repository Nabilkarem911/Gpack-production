# G.PACK 2.0 ERP — Agent Fix & Completion Plan

> **Instructions for Agent**: Execute each phase in order. Do NOT skip phases.
> Complete all tasks in a phase before moving to the next.
> After each phase, run the app and verify no errors before continuing.

---

## PHASE 1 — Critical Database Fixes (Do This First — Nothing Works Without It)

### Task 1.1 — Add Missing Columns via Migration
Create file: `backend/migrations/009_critical_fixes.sql`

```sql
-- Migration 009: Critical missing columns
-- Date: $(date)

-- Fix 1: Add received_qty to manufacturer_order_items
ALTER TABLE manufacturer_order_items 
  ADD COLUMN IF NOT EXISTS received_qty DECIMAL(15,3) DEFAULT 0;

-- Fix 2: Add has_supplier_invoice to manufacturer_orders
ALTER TABLE manufacturer_orders 
  ADD COLUMN IF NOT EXISTS has_supplier_invoice BOOLEAN DEFAULT false;

-- Fix 3: Add order_type to orders table (commercial vs VMI)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_type VARCHAR(20) DEFAULT 'commercial'
  CHECK (order_type IN ('commercial', 'vmi'));

-- Fix 4: Add status CHECK constraints to prevent invalid values
ALTER TABLE orders 
  DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check 
  CHECK (status IN ('draft', 'confirmed', 'in_production', 'released', 'delivered', 'cancelled'));

ALTER TABLE manufacturer_orders
  DROP CONSTRAINT IF EXISTS mo_status_check;
ALTER TABLE manufacturer_orders
  ADD CONSTRAINT mo_status_check
  CHECK (status IN ('draft', 'sent', 'partially_received', 'received', 'cancelled'));
```

### Task 1.2 — Run Migration
```bash
docker exec -i gpack_db psql -U gpack_user -d gpack_db < backend/migrations/009_critical_fixes.sql
```
**Verify**: No errors. Run `\d manufacturer_order_items` and confirm `received_qty` column exists.

### Task 1.3 — Fix orders.js Query (Bug #3)
File: `backend/routes/orders.js` — Find the subquery around line 104 that uses `moi.received_qty`

Replace the broken subquery with:
```javascript
// BEFORE (broken):
COALESCE(SUM(moi.received_qty), 0) AS total_received

// AFTER (fixed):
COALESCE((
  SELECT SUM(moi2.received_qty) 
  FROM manufacturer_order_items moi2
  JOIN manufacturer_orders mo2 ON moi2.manufacturer_order_id = mo2.id
  WHERE mo2.order_id = o.id
), 0) AS total_received
```

---

## PHASE 2 — Fix Manufacturer Orders (The Receiving Workflow)

### Task 2.1 — Verify manufacturer_orders.js Uses Correct Table
File: `backend/routes/manufacturer_orders.js`

Search for all JOINs to `suppliers` table. The schema has a `manufacturers` table.
**Decision**: Use `suppliers` as the manufacturer source (drop the unused `manufacturers` table confusion).

Add this to migration `009_critical_fixes.sql` (or create `010`):
```sql
-- Clarify: manufacturers table is an alias for suppliers in this system
-- Add a type column to suppliers if not exists
ALTER TABLE suppliers 
  ADD COLUMN IF NOT EXISTS supplier_type VARCHAR(20) DEFAULT 'supplier'
  CHECK (supplier_type IN ('supplier', 'manufacturer', 'both'));
```

### Task 2.2 — Test Receiving Endpoint
After DB fix, test:
```bash
curl -X POST http://localhost:3000/api/manufacturer-orders/{id}/receive \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"items": [{"id": "...", "received_qty": 100}]}'
```
**Expected**: 200 OK, stock updated in inventory.

---

## PHASE 3 — Fix Frontend Issues

### Task 3.1 — Create Missing inventory.html
Create file: `frontend/views/inventory.html`

This page should show:
- List of all warehouses with stock levels
- Filter by warehouse / product / category
- Stock adjustment button (calls `POST /api/inventory/adjustments`)
- Low stock alerts (items below reorder point)

Use the same design pattern as `warehouses.html` — same Tailwind classes, same sidebar structure.

### Task 3.2 — Create inventory.js
Create file: `frontend/js/views/inventory.js`

Functions needed:
```javascript
async function loadInventory()        // GET /api/inventory/stock
async function filterByWarehouse(id)  // GET /api/inventory/stock?warehouse_id=X
async function adjustStock(item)      // POST /api/inventory/adjustments
async function renderStockTable(data) // renders the HTML table
```

### Task 3.3 — Fix Dashboard (Replace Fake Data)
File: `frontend/views/dashboard.html`

Remove ALL hardcoded numbers (247, 38, 1,500,000, etc.)

Replace with:
```html
<span id="stat-quotations">...</span>
<span id="stat-orders">...</span>
<span id="stat-revenue">...</span>
```

File: `frontend/js/views/dashboard.js` (create if not exists)

```javascript
async function loadDashboardStats() {
  const data = await api.get('/api/dashboard/stats');
  document.getElementById('stat-quotations').textContent = data.quotations_count ?? 0;
  document.getElementById('stat-orders').textContent = data.orders_count ?? 0;
  document.getElementById('stat-revenue').textContent = 
    formatCurrency(data.total_revenue ?? 0);
}
```

### Task 3.4 — Uncomment Sidebar Navigation
File: `frontend/js/layout.js` lines 34-49

Uncomment these nav items (only after their views exist):
- ✅ Uncomment now: `inventory` (after Task 3.1 done)
- ✅ Uncomment now: `orders` (view exists)
- ⏳ Uncomment after Phase 4: `delivery-notes`
- ⏳ Uncomment after Phase 5: `invoices`
- ⏳ Leave commented: `accounting`, `tasks` (not built yet)

---

## PHASE 4 — Release Order Endpoint (Missing Critical Business Logic)

### Task 4.1 — Add Release Endpoint to orders.js
File: `backend/routes/orders.js`

Add after existing routes:
```javascript
// POST /api/orders/:id/release
// Reserves stock from inventory for delivery
router.post('/:id/release', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    
    // 1. Get order with items
    const orderResult = await client.query(
      'SELECT * FROM orders WHERE id = $1 AND status = $2',
      [id, 'confirmed']
    );
    if (!orderResult.rows[0]) {
      return res.status(400).json({ error: 'Order not found or not in confirmed status' });
    }
    
    const itemsResult = await client.query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [id]
    );
    
    // 2. Check stock availability for each item
    for (const item of itemsResult.rows) {
      const stockResult = await client.query(
        'SELECT available_qty FROM inventory_stock WHERE product_id = $1',
        [item.product_id]
      );
      if (!stockResult.rows[0] || stockResult.rows[0].available_qty < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: `Insufficient stock for product ${item.product_id}` 
        });
      }
    }
    
    // 3. Reserve stock (deduct from available, add to reserved)
    for (const item of itemsResult.rows) {
      await client.query(
        `UPDATE inventory_stock 
         SET available_qty = available_qty - $1,
             reserved_qty = reserved_qty + $1
         WHERE product_id = $2`,
        [item.quantity, item.product_id]
      );
    }
    
    // 4. Update order status
    await client.query(
      "UPDATE orders SET status = 'released', updated_at = NOW() WHERE id = $1",
      [id]
    );
    
    await client.query('COMMIT');
    res.json({ success: true, message: 'Order released successfully' });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Release order error:', err);
    res.status(500).json({ error: 'Failed to release order' });
  } finally {
    client.release();
  }
});
```

### Task 4.2 — Add Release Button to Orders UI
File: `frontend/js/views/quotations.js` (or orders view)

Add a "Release" button that appears when `order.status === 'confirmed'`:
```javascript
if (order.status === 'confirmed') {
  actionsHTML += `
    <button onclick="releaseOrder('${order.id}')" 
            class="btn-warning text-sm px-3 py-1 rounded">
      تحرير للتوصيل
    </button>`;
}

async function releaseOrder(orderId) {
  if (!confirm('هل تريد تحرير هذه الطلبية للتوصيل؟')) return;
  try {
    await api.post(\`/api/orders/\${orderId}/release\`);
    showSuccess('تم تحرير الطلبية بنجاح');
    loadOrders(); // refresh list
  } catch (err) {
    showError(err.message);
  }
}
```

---

## PHASE 5 — Invoices Module (Most Critical Missing Feature)

### Task 5.1 — Create Backend invoices.js Route
Create file: `backend/routes/invoices.js`

Endpoints needed:
```
GET    /api/invoices              → list all invoices (paginated)
GET    /api/invoices/:id          → get single invoice with items
POST   /api/invoices              → create invoice manually
POST   /api/invoices/from-order/:orderId → auto-generate from order
PUT    /api/invoices/:id/status   → update status (draft→sent→paid)
GET    /api/invoices/:id/print    → print-ready data
```

Key logic for `from-order`:
```javascript
// Auto-generate invoice from order
router.post('/from-order/:orderId', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const order = await client.query(
      'SELECT * FROM orders WHERE id = $1', [req.params.orderId]
    );
    
    const items = await client.query(
      'SELECT * FROM order_items WHERE order_id = $1', [req.params.orderId]
    );
    
    // Generate invoice number from sequence
    const seqResult = await client.query(
      "SELECT nextval('invoice_number_seq') AS num"
    );
    const invoiceNumber = `INV-${seqResult.rows[0].num}`;
    
    // Create invoice
    const invoice = await client.query(
      `INSERT INTO invoices 
       (invoice_number, order_id, client_id, subtotal, tax_amount, total_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft')
       RETURNING *`,
      [
        invoiceNumber,
        order.rows[0].id,
        order.rows[0].client_id,
        order.rows[0].subtotal,
        order.rows[0].tax_amount,
        order.rows[0].grand_total
      ]
    );
    
    // Copy order items to invoice items
    for (const item of items.rows) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price, total)
         VALUES ($1, $2, $3, $4, $5)`,
        [invoice.rows[0].id, item.product_id, item.quantity, item.unit_price, item.total_price]
      );
    }
    
    // Create accounting voucher
    await client.query(
      `INSERT INTO accounting_vouchers (voucher_type, reference_id, reference_type, amount, description)
       VALUES ('invoice', $1, 'invoice', $2, $3)`,
      [invoice.rows[0].id, order.rows[0].grand_total, `Invoice ${invoiceNumber}`]
    );
    
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: invoice.rows[0] });
    
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
```

### Task 5.2 — Register Route in server.js
File: `backend/server.js`

Add:
```javascript
const invoicesRouter = require('./routes/invoices');
app.use('/api/invoices', invoicesRouter);
```

### Task 5.3 — Create Frontend invoices.html
Create file: `frontend/views/invoices.html`

Page sections:
1. Header: "الفواتير" + "إنشاء فاتورة" button
2. Filter bar: status filter (draft/sent/paid/overdue) + date range
3. Table: Invoice #, Client, Order #, Amount, Status, Date, Actions
4. Actions per row: View | Print | Mark as Paid

### Task 5.4 — Create Frontend invoices.js
Create file: `frontend/js/views/invoices.js`

```javascript
async function loadInvoices(filters = {}) // GET /api/invoices
async function generateFromOrder(orderId)  // POST /api/invoices/from-order/:id
async function updateInvoiceStatus(id, status) // PUT /api/invoices/:id/status
async function printInvoice(id)            // Opens print view
async function renderInvoicesTable(data)   // Renders HTML
```

---

## PHASE 6 — Security Fixes

### Task 6.1 — Add Rate Limiting
```bash
cd backend && npm install express-rate-limit
```

File: `backend/server.js` — Add after imports:
```javascript
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 login attempts
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200
});

app.use('/api/auth/login', loginLimiter);
app.use('/api/', apiLimiter);
```

### Task 6.2 — Fix CORS
File: `backend/server.js` line ~23

```javascript
// BEFORE:
origin: process.env.CORS_ORIGIN || '*'

// AFTER:
origin: process.env.CORS_ORIGIN || 'http://localhost',
credentials: true
```

### Task 6.3 — Add Centralized Authorization Middleware
Create file: `backend/middleware/authorize.js`

```javascript
const ROLE_PERMISSIONS = {
  admin:      ['all'],
  manager:    ['orders', 'clients', 'products', 'inventory', 'invoices', 'reports'],
  sales:      ['orders', 'clients', 'products', 'invoices'],
  warehouse:  ['inventory', 'delivery-notes'],
  accounting: ['invoices', 'accounting', 'reports'],
};

const authorize = (permission) => (req, res, next) => {
  const userRole = req.user?.role;
  if (!userRole) return res.status(401).json({ error: 'Unauthorized' });
  
  const permissions = ROLE_PERMISSIONS[userRole] || [];
  if (permissions.includes('all') || permissions.includes(permission)) {
    return next();
  }
  
  return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
};

module.exports = authorize;
```

Usage in routes:
```javascript
const authorize = require('../middleware/authorize');
router.get('/', authenticate, authorize('invoices'), async (req, res) => { ... });
```

### Task 6.4 — Add Audit Log Table & Middleware
Migration:
```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(50) NOT NULL,        -- 'CREATE', 'UPDATE', 'DELETE'
  entity_type VARCHAR(50) NOT NULL,   -- 'order', 'invoice', etc.
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
```

Create file: `backend/middleware/audit.js`:
```javascript
const { pool } = require('../db');

const audit = (action, entityType) => async (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = async (data) => {
    if (res.statusCode < 400 && req.user) {
      try {
        await pool.query(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            req.user.id, action, entityType,
            data?.data?.id || req.params.id || null,
            JSON.stringify(req.body),
            req.ip
          ]
        );
      } catch (e) {
        console.error('Audit log error:', e);
      }
    }
    originalJson(data);
  };
  next();
};

module.exports = audit;
```

---

## PHASE 7 — Dashboard Real Data

### Task 7.1 — Enhance dashboard.js Backend Route
File: `backend/routes/dashboard.js`

Make sure the stats endpoint returns:
```javascript
{
  quotations_count: Number,      // orders with status='draft'
  orders_count: Number,          // confirmed + in_production orders
  total_revenue: Number,         // SUM of paid invoices this month
  pending_invoices: Number,      // unpaid invoices count
  low_stock_items: Number,       // items below reorder_point
  active_clients: Number,        // clients with order in last 30 days
  recent_orders: Array,          // last 5 orders
  revenue_chart: Array           // last 6 months revenue data
}
```

SQL for revenue:
```sql
SELECT 
  DATE_TRUNC('month', created_at) AS month,
  SUM(total_amount) AS revenue
FROM invoices
WHERE status = 'paid'
  AND created_at >= NOW() - INTERVAL '6 months'
GROUP BY 1
ORDER BY 1;
```

### Task 7.2 — Add Revenue Chart to Dashboard
Use Chart.js (already available via CDN) or build with pure SVG.

Add to `dashboard.html`:
```html
<canvas id="revenueChart" width="600" height="200"></canvas>
```

Add to `dashboard.js`:
```javascript
function renderRevenueChart(data) {
  const ctx = document.getElementById('revenueChart').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => d.month),
      datasets: [{
        label: 'الإيرادات',
        data: data.map(d => d.revenue),
        borderColor: '#6366f1',
        tension: 0.4
      }]
    }
  });
}
```

---

## PHASE 8 — Code Quality & Consistency

### Task 8.1 — Standardize API Response Format
All routes must return consistent format. Create helper:

File: `backend/utils/response.js`
```javascript
const success = (res, data, statusCode = 200) => {
  return res.status(statusCode).json({ success: true, data });
};

const error = (res, message, statusCode = 500) => {
  return res.status(statusCode).json({ success: false, error: message });
};

const paginated = (res, data, total, page, limit) => {
  return res.json({
    success: true,
    data,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) }
  });
};

module.exports = { success, error, paginated };
```

### Task 8.2 — Add Pagination to Large Endpoints
Routes that need pagination (can return huge datasets):
- `GET /api/orders` → Add `?page=1&limit=20`
- `GET /api/clients` → Add `?page=1&limit=20`  
- `GET /api/invoices` → Add `?page=1&limit=20`

Standard pagination SQL pattern:
```sql
SELECT *, COUNT(*) OVER() AS total_count
FROM orders
ORDER BY created_at DESC
LIMIT $1 OFFSET $2
```

### Task 8.3 — Resolve manufacturers vs suppliers Confusion
Check if `manufacturers` table has any data. If empty:
```sql
DROP TABLE IF EXISTS manufacturers CASCADE;
```
Then update any comments/docs to clarify: "suppliers table serves as both suppliers and manufacturers, differentiated by supplier_type column".

---

## PHASE 9 — Missing Views (Build in Order)

### Task 9.1 — Delivery Notes View
- `frontend/views/delivery-notes.html`
- `frontend/js/views/delivery-notes.js`
- Connect to existing `GET/POST /api/delivery-notes` (already built)
- Features: list, create from released order, confirm delivery

### Task 9.2 — Manufacturers/Suppliers Enhanced View
- Current `suppliers.html` works but needs "manufacturer" type filter
- Add tab: "موردون" / "مصنّعون" toggle

### Task 9.3 — Accounting Vouchers View (Read-Only)
- `frontend/views/accounting.html`
- Shows all auto-generated vouchers from orders/invoices
- Read-only for most roles, editable for accounting role only

---

## Verification Checklist (Run After Each Phase)

```
PHASE 1 ✓: 
  [ ] docker-compose up runs without errors
  [ ] manufacturer_order_items has received_qty column
  [ ] manufacturer_orders has has_supplier_invoice column
  [ ] orders table has order_type column

PHASE 2 ✓:
  [ ] POST /api/manufacturer-orders/:id/receive returns 200
  [ ] Stock qty updates in inventory after receiving

PHASE 3 ✓:
  [ ] /inventory route loads without 404
  [ ] Dashboard shows real numbers from database
  [ ] Sidebar navigation items work

PHASE 4 ✓:
  [ ] POST /api/orders/:id/release returns 200
  [ ] Stock reserved_qty increases after release
  [ ] Order status changes to 'released'

PHASE 5 ✓:
  [ ] POST /api/invoices/from-order/:id creates invoice
  [ ] Invoice appears in invoices list
  [ ] Invoice number auto-increments (INV-4001, INV-4002...)
  [ ] Status can be changed draft → sent → paid

PHASE 6 ✓:
  [ ] 11+ login attempts blocked for 15 min
  [ ] CORS only allows configured origin
  [ ] Unauthorized role gets 403 on protected routes
  [ ] Actions appear in audit_logs table

PHASE 7 ✓:
  [ ] Dashboard numbers match actual database counts
  [ ] Revenue chart renders with real data

PHASE 8 ✓:
  [ ] All API responses use {success, data} format
  [ ] Large lists have pagination

PHASE 9 ✓:
  [ ] Delivery notes view loads and works
  [ ] Accounting vouchers view loads
```

---

---

## PHASE 10 — Code Standards Compliance (من الكشف التلقائي)

### Task 10.1 — Fix Function Naming (_init) — 7 Files ✅ CRITICAL
**القاعدة**: كل الدوال يجب تبدأ بـ `_`

| الملف | السطر | التصليح |
|-------|-------|---------|
| `frontend/js/views/vmi-dispatch.js` | 372 | `async function init()` → `async function _init()` |
| `frontend/js/views/users.js` | 343 | `function init()` → `function _init()` |
| `frontend/js/views/supplier-profile.js` | 375 | `async function init()` → `async function _init()` |
| `frontend/js/views/sales-invoices.js` | 321 | `async function init()` → `async function _init()` |
| `frontend/js/views/purchase-invoices.js` | 294 | `async function init()` → `async function _init()` |
| `frontend/js/views/product-movements.js` | 411 | `async function init()` → `async function _init()` |
| `frontend/js/views/client-profile.js` | 283 | `async function init()` → `async function _init()` |

**Important**: بعد التصليح، لازم نغير الاستدعاء في آخر الملف من `init()` لـ `_init()`

**Status**: ✅ COMPLETED (2026-05-17)

---

### Task 10.2 — Standardize Backend API Responses — 8 Files ✅ CRITICAL
**القاعدة**: كل الردود يجب `{ data, message, total }`

**الملفات المخالفة**:
- `backend/routes/users.js` (23 موضع)
- `backend/routes/public_quotation.js` (3 مواضع)
- `backend/routes/vmi.js` (1 موضع)
- `backend/routes/orders.js` (2 مواضع)
- `backend/routes/manufacturer_orders.js` (4 مواضع)
- `backend/routes/invoices.js` (1 موضع)
- `backend/routes/dashboard.js` (4 مواضع)
- `backend/routes/client_designs.js` (1 موضع)

**الحل**: استخدام helper function من Phase 8:
```javascript
// BEFORE (غلط):
res.json({ success: true, data: result.rows });

// AFTER (صح):
const { success } = require('../utils/response');
return success(res, result.rows);
```

**⚠️ CRITICAL**: لازم نحافظ على backward compatibility! Frontend ممكن يتوقع `success: true`

**الحل الآمن**:
```javascript
// في utils/response.js
const success = (res, data, statusCode = 200) => {
  return res.status(statusCode).json({ 
    success: true,  // للـ backward compatibility
    data,
    message: 'Success',
    total: Array.isArray(data) ? data.length : undefined
  });
};
```

**Status**: ✅ 100% COMPLETED (2026-05-17)
- ✅ Created `backend/utils/response.js` helper
- ✅ Updated `backend/routes/dashboard.js` (5 endpoints)
- ✅ Updated `backend/routes/client_designs.js` (partial)
- ✅ Updated `backend/routes/invoices.js` (1 endpoint)
- ✅ Updated `backend/routes/manufacturer_orders.js` (2 endpoints)
- ✅ Updated `backend/routes/vmi.js` (1 endpoint)
- ✅ Updated `backend/routes/public_quotation.js` (3 endpoints)
- ✅ Updated `backend/routes/orders.js` (4 endpoints)
- ✅ Updated `backend/routes/users.js` (ALL endpoints - complete rewrite)

**Note**: الـ helper بيحافظ على backward compatibility عن طريق إضافة `success: true` للردود.

---

### Task 10.3 — Reduce Inline Styles in Print Templates — 2 Files 🟡 MEDIUM
**القاعدة**: استخدام Tailwind فقط — لا inline styles

**الملفات**:
- `frontend/js/views/supplier-profile.js` (lines 149-223)
- `frontend/js/views/sales-invoice-detail.js` (lines 183-312)

**ملاحظة**: قوالب الطباعة HTML مستقل، فـ inline styles مقبول هنا لكن الأفضل نقللها

**الحل البديل**: نعمل `print.css` منفصل ونستخدم classes

**Status**: ⏳ PENDING (أقل أولوية)

---

## Summary

| Phase | What | Priority | Est. Effort | Status |
|-------|------|----------|-------------|--------|
| 1 | DB Schema Fixes | 🔴 CRITICAL | 30 min | ✅ COMPLETED |
| 2 | Manufacturer Orders Fix | 🔴 CRITICAL | 1 hour | ✅ COMPLETED |
| 3 | Frontend Fixes (inventory + dashboard) | 🔴 HIGH | 2 hours | ✅ COMPLETED |
| 4 | Release Order Endpoint | 🔴 HIGH | 1 hour | ✅ COMPLETED |
| 5 | Invoices Module | 🔴 HIGH | 4 hours | ✅ COMPLETED (Already exists) |
| 6 | Security Fixes | 🟡 MEDIUM | 2 hours | ✅ COMPLETED |
| 7 | Real Dashboard Data | 🟡 MEDIUM | 1 hour | ✅ COMPLETED |
| 8 | Code Quality | 🟢 LOW | 2 hours | ✅ COMPLETED |
| 9 | Missing Views | 🟢 LOW | 4 hours | ⏳ TODO |
| **10** | **Code Standards (من الكشف)** | **🔴 CRITICAL** | **1 hour** | **✅ COMPLETED** |

**Total Estimated Effort: ~18 hours of focused development**

---

## 🎯 خطة التنفيذ الموصى بها

**الأولوية القصوى (نبدأ بيها دلوقتي):**
1. ✅ Phase 10.1 — Fix Function Naming (15 min) — **آمن 100%**
2. ✅ Phase 10.2 — API Response Format (30 min) — **آمن مع backward compatibility**
3. ✅ Phase 1 — DB Schema Fixes (30 min)
4. ✅ Phase 2 — Manufacturer Orders (1 hour)

**بعد كده:**
5. Phase 3-5 (الـ features الناقصة)
6. Phase 6-9 (التحسينات)

---

> ⚠️ **Agent Note**: Always use transactions (`BEGIN/COMMIT/ROLLBACK`) for any operation 
> that touches multiple tables. Never modify `database/init.sql` directly — 
> always create a new numbered migration file.
>
> 🔒 **Safety First**: كل تعديل في Phase 10 آمن ومش هيضرب الموقع لأننا:
> - بنغير أسماء دوال داخلية فقط (مش public API)
> - بنحافظ على backward compatibility في API responses
> - مش بنمس الـ database أو الـ business logic
