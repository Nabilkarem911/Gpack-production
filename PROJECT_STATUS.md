# G.PACK 2.0 — Master Project Status & Tracking

> **Last Updated:** 2026-05-03  
> **Purpose:** Single source of truth for completeness, bugs, and roadmap.  
> **Rule:** Check [x] when an item is fixed/implemented. Update date in header.
> **⚠️ CRITICAL:** Master Data MUST be built BEFORE Operational Modules.

---

## ١. Executive Summary

| Layer | Completion | Status |
|-------|-----------|--------|
| Database Schema | 95% | 27 tables, seeds, indexes — mostly complete |
| Backend API | 70% | Users + Roles CRUD added; core routes built |
| Frontend Views | 60% | 9 views exist; 6 missing (Users added ✅) |
| Security / Middleware | 45% | JWT + param queries OK; Users/Roles UI added |
| Business Logic | 60% | Orders + inventory + users done; invoices + delivery + tasks not built |
| DevOps / Docker | 80% | Compose + nginx + healthchecks ready |

---

## ٢. Component Matrix

### ٢.١ Database Tables (27 total)

| # | Table | Status | Notes |
|---|-------|--------|-------|
| 1 | `roles` | [x] | 5 roles seeded, CRUD API added |
| 2 | `users` | [x] | Admin seeded, CRUD API + UI added |
| 3 | `clients` | [x] | Franchise via `parent_id` |
| 4 | `suppliers` | [x] | **BUG:** `type` column missing but used in code |
| 5 | `categories` | [x] | Nested OK |
| 6 | `units` | [x] | Conversion OK |
| 7 | `products` | [x] | General, no client link |
| 8 | `product_variants` | [x] | Selling/cost price, SKU |
| 9 | `warehouses` | [x] | `client_id` nullable |
| 10 | `manufacturers` | [x] | Schema exists but **unused** — manufacturer_orders points to `suppliers` |
| 11 | `orders` | [x] | Sequence + statuses |
| 12 | `order_items` | [x] | `line_total` generated |
| 13 | `standard_terms` | [x] | CRUD ready |
| 14 | `manufacturer_orders` | [x] | Schema OK |
| 15 | `manufacturer_order_items` | [x] | Schema OK |
| 16 | `warehouse_stock` | [x] | `available_qty` generated |
| 17 | `inventory_transactions` | [x] | Schema only — no API |
| 18 | `delivery_notes` | [ ] | Schema only |
| 19 | `delivery_note_items` | [ ] | Schema only |
| 20 | `invoices` | [ ] | Schema only |
| 21 | `invoice_items` | [ ] | Schema only |
| 22 | `invoice_expenses` | [ ] | Schema only |
| 23 | `accounts` | [x] | 18 accounts seeded |
| 24 | `accounting_vouchers` | [x] | Used internally by convert-to-production; no direct API |
| 25 | `accounting_voucher_lines` | [x] | Same as above |
| 26 | `client_transactions` | [x] | Created internally only |
| 27 | `tasks` / `task_subtasks` | [ ] | Schema only — no routes/views |

### ٢.٢ Backend Routes — Implemented

| Route | File | Status |
|-------|------|--------|
| `/api/auth` | `auth.js` | [x] Login, me, logout |
| `/api/categories` | `categories.js` | [x] Full CRUD |
| `/api/units` | `units.js` | [x] Full CRUD |
| `/api/clients` | `clients.js` | [x] Full CRUD + data scoping |
| `/api/products` | `products.js` | [x] Full CRUD + variants |
| `/api/orders` | `orders.js` | [x] Full CRUD + convert-to-production + accounting voucher |
| `/api/inventory/*` | `inventory.js` | [x] Warehouses + stock + adjust |
| `/api/suppliers` | `suppliers.js` | [x] Full CRUD |
| `/api/terms` | `terms.js` | [x] Full CRUD |
| `/api/manufacturer-orders` | `manufacturer_orders.js` | [x] CRUD + status transitions + receive |
| `/api/delivery-notes` | `delivery_notes.js` | [x] CRUD + confirm delivery |

### ٢.٣ Backend Routes — Missing

| Route | Purpose | Priority |
|-------|---------|----------|
| `/api/reports/dashboard` | Real dashboard data | **P0** |
| `/api/orders/:id/release-order` | Release + stock reservation | **P0** |
| `/api/delivery-notes` | Delivery management | P1 |
| `/api/delivery-notes/:id/confirm` | Confirm delivery, update stock | P1 |
| `/api/invoices` | Invoices | P1 |
| `/api/invoices/generate/:orderId` | Auto-invoice from order | P1 |
| `/api/users` | User management | P1 |
| `/api/accounting/vouchers` | Accounting vouchers | P2 |
| `/api/tasks` | Task management | P3 |
| `/api/manufacturers` | Separate from suppliers | P2 |

### ٢.₄ Frontend Views

| View | HTML | JS | Sidebar | Status |
|------|------|----|---------|--------|
| Login | [x] | [x] | N/A | Ready |
| Dashboard | [x] | [x] | [x] | **Fake data — no API** |
| Clients | [x] | [x] | [x] | Ready |
| Products | [x] | [x] | [x] | Ready |
| Quotations | [x] | [x] | [x] | Ready |
| Production Orders | [x] | [x] | [x] | Ready |
| Suppliers | [x] | [x] | [x] | Ready |
| Settings | [x] | [ ] | [x] | Template only |
| Warehouses | [x] | [x] | [x] | Ready - Phase 1 Complete |
| Inventory / Stock | [x] | [x] | [x] | Ready - Phase 1 Complete |
| Manufacturers | [ ] | [ ] | [ ] | Missing |
| Delivery Notes | [ ] | [ ] | [ ] | Missing |
| Invoices | [ ] | [ ] | [ ] | Missing |
| Accounting | [ ] | [ ] | [ ] | Missing |
| Tasks | [ ] | [ ] | [ ] | Missing |
| Users | [ ] | [ ] | [ ] | Missing |
| Commercial Orders | [ ] | [ ] | [ ] | Missing |

> Sidebar items for missing views are **commented out** in `frontend/js/layout.js:24-50`.

---

## ٣. Issue Tracker

> **Legend:**  
> [ ] = Open (not fixed)  
> [x] = Closed (fixed — include date)  
> 🔴 P0 = Critical (blocks system / corrupts data)  
> 🟡 P1 = High (blocks main workflow)  
> 🟢 P2 = Medium (feature gap)  
> ⚪ P3 = Low (cosmetic / refactor)

### 🔴 P0 — Critical Bugs

- [x] **Issue #1** — `manufacturer_orders.js:183` calls `nextval('manufacturer_po_seq')` but **sequence does not exist**. Real name is `manufacturer_order_number_seq` in `init.sql:17`. Result: POST manufacturer-orders always fails. ✅ **FIXED 2026-05-03**

- [x] **Issue #2** — `manufacturer_orders.js:117` selects `moi.quantity` but actual column is `mo_quantity`. Result: GET /:id query fails. ✅ **FIXED 2026-05-03**

- [x] **Issue #3** — `manufacturer_orders.js:120` selects `moi.received_qty` but column **does not exist** in `manufacturer_order_items`. Result: GET /:id query fails. ✅ **FIXED 2026-05-03** (Removed from SELECT)

- [x] **Issue #4** — `suppliers` table has **no `type` column**, but `suppliers.js:29-31` filters by it. Result: GET /api/suppliers?type=... fails. ✅ **FIXED 2026-05-03**

- [ ] **Issue #5** — `dashboard.html:23-72` is **100% hardcoded fake data** (247 quotations, 38 orders, 1.5M revenue). No API connected. Result: user sees false numbers. ⏳ **PENDING** (Phase 4)

- [x] **Issue #6** — `manufacturer_orders` stores `manufacturer_id` but JOINs to `suppliers`. Table `manufacturers` exists but is **unused**. Result: data integrity confusion. ✅ **FIXED 2026-05-03** (Changed FK to suppliers)

### 🟡 P1 — Missing Core Workflows

- [ ] **Issue #7** — No `POST /api/orders/:id/release-order` route. Cannot reserve stock when moving order to processing.

- [ ] **Issue #8** — No delivery notes API or UI. Cannot confirm delivery and deduct stock.

- [ ] **Issue #9** — No invoices API or UI. Cannot generate invoices or link to accounting.

- [ ] **Issue #10** — No centralized permission middleware. Each route manually checks `req.user.role`. Risk of inconsistent enforcement.

- [ ] **Issue #11** — No rate limiting. `express-rate-limit` not installed. Brute-force risk on `/api/auth/login`.

- [ ] **Issue #12** — `orders.js` POST always inserts financial fields (`subtotal`, `tax_amount`, `grand_total`). Per SYSTEM_SPEC, VMI production orders must leave these NULL. No `type` field distinguishes commercial vs VMI.

- [ ] **Issue #13** — 7 views missing from sidebar (warehouses, inventory, manufacturers, delivery, invoices, accounting, tasks, users, commercial orders). Commented out in `layout.js:24-50`.

### 🟢 P2 — Medium Gaps

- [ ] **Issue #14** — No API versioning. Spec requests `/api/v1/` but routes have no prefix.

- [ ] **Issue #15** — `CORS_ORIGIN` not set in `.env`. `server.js:22` falls back to `'*'`. Security concern in production.

- [ ] **Issue #16** — No audit trail / activity log table. Cannot track who changed what.

- [ ] **Issue #17** — No Redis / caching layer. Every request hits DB directly.

- [ ] **Issue #18** — `orders.status` has no CHECK constraint. Invalid statuses can be inserted directly.

- [ ] **Issue #19** — `manufacturers` table exists but has no routes or UI. Should merge with suppliers or build its own module.

### ⚪ P3 — Low / Polish

- [ ] **Issue #20** — `seed-demo.js` does not set `created_by` on products. Results in NULL.

- [ ] **Issue #21** — Some GET endpoints omit `created_by` from response even though column exists.

- [ ] **Issue #22** — Stock adjustment (`/api/inventory/stock/adjust`) does not create `inventory_transactions` record. No audit for manual corrections.

- [ ] **Issue #23** — Sidebar has commented-out nav items. Should be removed or activated incrementally.

---

## ٤. Implementation Roadmap — Corrected Building Sequence

> **⚠️ CRITICAL PRINCIPLE:** Master Data MUST be built BEFORE Operational Modules.
> **Sequence:** Master Data → Inventory Foundation → Production Cycle → Delivery → Reports

---

### Phase 0 — Fix Critical Bugs (P0) — IN PROGRESS
| # | Task | Status | Files |
|---|------|--------|-------|
| 0.1 | Fix sequence name `manufacturer_order_number_seq` | ✅ DONE | `manufacturer_orders.js:183` |
| 0.2 | Fix column `mo_quantity` vs `quantity` | ✅ DONE | `manufacturer_orders.js:117` |
| 0.3 | Remove `received_qty` from SELECT (column doesn't exist) | ✅ DONE | `manufacturer_orders.js:120` |
| 0.4 | Add `type` column to `suppliers` | ✅ DONE | `init.sql` |
| 0.5 | Fix `updated_at` in order_items UPDATE | ✅ DONE | `manufacturer_orders.js:227` |
| 0.6 | Fix Foreign Key manufacturer_id → suppliers(id) | ✅ DONE | `init.sql` |

---

### Phase 1 — Master Data Foundation (CRITICAL - Build First!)

**⚠️ Rule:** These MUST be completed before any operational features!

| # | Module | Backend API | Frontend View | Sidebar | Status |
|---|--------|-------------|---------------|---------|--------|
| 1.1 | **Users & Permissions** | `users.js` CRUD + roles | `users.html` + `users.js` | ✅ | ⏳ **PENDING** |
| 1.2 | **Warehouses** | `inventory.js` CRUD | `warehouses.html` + `warehouses.js` | ✅ | ✅ **DONE** |
| 1.3 | **Inventory/Stock** | `inventory.js` + transactions | (integrated in warehouses) | ✅ | ✅ **DONE** |

---

### Phase 2 — Complete Production Cycle (Needs Phase 1!)

**⚠️ Rule:** Cannot receive stock without Warehouses & Inventory!

| # | Feature | API Endpoint | Frontend | Depends On |
|---|---------|------------|----------|------------|
| 2.1 | **Receive from Manufacturer** | `POST /api/manufacturer-orders/:id/receive` | Button + Modal in Production Orders | Phase 1.2, 1.3 |
| 2.2 | **Safe Rollback** | `POST /api/manufacturer-orders/:id/rollback` | Button in Production Orders | Phase 2.1 |
| 2.3 | **Auto Complete Order** | Trigger on full receipt | Status badge update | Phase 2.1 |
| 2.4 | **Release Order** | `POST /api/orders/:id/release` | Button in Orders | Phase 1.3 |

---

### Phase 3 — Delivery & Financial (Needs Phase 2!)

| # | Module | Backend | Frontend | Priority |
|---|--------|---------|----------|----------|
| 3.1 | **Delivery Notes** | `delivery-notes.js` + confirm API | `delivery-notes.html` | P1 |
| 3.2 | **Invoices** | `invoices.js` + auto-generate | `invoices.html` | P1 |
| 3.3 | **Accounting Vouchers** | `accounting.js` | `accounting.html` | P2 |

---

### Phase 4 — Dashboard & Reports (Final Polish)

| # | Feature | API | Frontend | Priority |
|---|---------|-----|----------|----------|
| 4.1 | **Real Dashboard** | `GET /api/reports/dashboard` | Replace fake data | P1 |
| 4.2 | **Reports Module** | Various endpoints | `reports.html` | P2 |

---

### Phase 5 — Security & DevOps (Parallel)

| # | Task | Files | Priority |
|---|------|-------|----------|
| 5.1 | Rate limiting + CORS | `server.js` | P1 |
| 5.2 | Unified authorization middleware | `middleware/authorize.js` | P1 |
| 5.3 | Audit trail | `audit_logs` table + middleware | P2 |

---

## ٥. Recent Fixes Log

| Date | Issue # | Description | Files Changed |
|------|---------|-------------|---------------|
| 2026-05-03 | #1 | Fixed sequence name `manufacturer_order_number_seq` | `manufacturer_orders.js:183` |
| 2026-05-03 | #2 | Fixed column `mo_quantity` vs `quantity` in GET query | `manufacturer_orders.js:117` |
| 2026-05-03 | #3 | Removed `received_qty` from SELECT (column doesn't exist) | `manufacturer_orders.js:120` |
| 2026-05-03 | #4 | Added `type` column to `suppliers` table | PostgreSQL schema |
| 2026-05-03 | #6 | Fixed Foreign Key manufacturer_id → suppliers(id) | PostgreSQL schema |
| 2026-05-03 | #24 | Fixed `updated_at` in order_items UPDATE (column doesn't exist) | `manufacturer_orders.js:227` |
| 2026-05-03 | NEW | Created comprehensive Warehouses & Inventory UI | `warehouses.html`, `warehouses.js` |
| 2026-05-03 | NEW | Added inventory transactions API endpoint | `inventory.js` |
| 2026-05-03 | NEW | Added manufacturer orders receive endpoint | `manufacturer_orders.js` |
| 2026-05-03 | NEW | Created Delivery Notes API | `delivery_notes.js` + schema |
| 2026-05-03 | NEW | Updated sidebar with Warehouses link | `layout.js`, `index.html` |

> **Update this table every time a bug is fixed or a feature is completed.**

---

## ٦. Quick Reference — Key Files

| Purpose | File |
|---------|------|
| System Spec | `SYSTEM_SPEC.md` |
| Database Schema | `database/init.sql` |
| Express Entry | `backend/server.js` |
| DB Pool + Transactions | `backend/db.js` |
| JWT Middleware | `backend/middleware/authMiddleware.js` |
| API Gateway (frontend) | `frontend/js/api.js` |
| SPA Router + Sidebar | `frontend/js/layout.js` |
| Auth + Session | `frontend/js/auth.js` |
| App Bootstrap | `frontend/js/app.js` |
| Docker Compose | `docker-compose.yml` |
| Nginx Proxy | `nginx/nginx.conf` |
| Admin Reset Script | `backend/scripts/reset-admin.js` |
| Seed Demo Data | `backend/seed-demo.js` |

---

## ٧. Environment & Secrets

| Variable | Value | Location |
|----------|-------|----------|
| `DB_PASSWORD` | `as123df456` | `.env:1` |
| `JWT_SECRET` | `GpackSuperSecretKeyForTokens2026_Min32Chars` | `.env:2` |
| `JWT_EXPIRES_IN` | `24h` (assumed) | `backend/routes/auth.js:90` |
| `VAT_RATE` | `0.15` (15%) | `backend/routes/orders.js:16` |
| Backend Port | `3000` | `docker-compose.yml` + `backend/Dockerfile` |
| Frontend Port | `80` | `docker-compose.yml` |
| Postgres Port | `5432` | `docker-compose.yml` |

---

*End of document. Update header date and fix log after every change.*
