-- =============================================================================
-- G.PACK 2.0 - Complete Database Initialization Script
-- PostgreSQL 14+
-- MILITARY RULE: This is the single source of truth for the database schema.
-- All financial fields on `orders` are NULLABLE to support VMI production orders.
-- All accounting vouchers are IMMUTABLE after posting.
-- =============================================================================

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- SEQUENCES
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 1001 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS manufacturer_order_number_seq START WITH 2001 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS delivery_note_number_seq START WITH 3001 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 4001 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS voucher_number_seq START WITH 5001 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS purchase_invoice_seq START WITH 6001 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS purchase_return_number_seq START WITH 7001 INCREMENT BY 1;

-- =============================================================================
-- TABLE: roles
-- Must be created before `users` due to FK dependency.
-- =============================================================================

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name VARCHAR(100) UNIQUE NOT NULL,
    permissions JSONB NOT NULL DEFAULT '{}',
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: users
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role_id UUID REFERENCES roles(id),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: clients
-- CRITICAL: parent_id enables Franchise/VMI hierarchy.
-- A NULL parent_id indicates a main/root client.
-- A non-NULL parent_id links a branch to its parent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES clients(id),
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    commercial_register VARCHAR(100),
    tax_id VARCHAR(100),
    credit_limit DECIMAL(15,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: suppliers
-- =============================================================================

CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    commercial_register VARCHAR(100),
    tax_id VARCHAR(100),
    payment_terms VARCHAR(100),
    supplier_type VARCHAR(20) DEFAULT 'supplier',
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: categories
-- Supports parent_id for nested category hierarchies.
-- =============================================================================

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES categories(id),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: units
-- Supports unit conversions via base_unit_id and conversion_factor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL,
    abbreviation VARCHAR(10),
    base_unit_id UUID REFERENCES units(id),
    conversion_factor DECIMAL(10,6) DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: products
-- GENERAL: Not tied to any client. Client specificity is in warehouse_stock.
-- =============================================================================

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category_id UUID REFERENCES categories(id),
    sku VARCHAR(100) UNIQUE,
    barcode VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: product_variants
-- GENERAL: Not tied to any client.
-- =============================================================================

CREATE TABLE IF NOT EXISTS product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES products(id),
    size_name VARCHAR(100) NOT NULL,
    sku VARCHAR(100) UNIQUE,
    barcode VARCHAR(100),
    unit_id UUID REFERENCES units(id),
    selling_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    cost_price DECIMAL(15,2) DEFAULT 0,
    min_stock_level INTEGER DEFAULT 0,
    max_stock_level INTEGER,
    weight DECIMAL(10,3),
    dimensions VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: warehouses
-- client_id is NULL for the main/central warehouse.
-- client_id is set for client-dedicated warehouses.
-- =============================================================================

CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE,
    warehouse_type VARCHAR(50) NOT NULL DEFAULT 'main',
    client_id UUID REFERENCES clients(id),
    address TEXT,
    manager_id UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- NOTE: manufacturers table has been REMOVED.
-- The suppliers table now handles both suppliers and manufacturers,
-- differentiated by the supplier_type column ('supplier' or 'manufacturer').
-- See migration 010_supplier_type.sql and 012_drop_manufacturers.sql.
-- =============================================================================

-- =============================================================================
-- TABLE: orders
-- CRITICAL VMI RULE:
--   subtotal, tax_amount, grand_total are ALL NULLABLE.
--   For VMI production orders, ONLY insert:
--     client_id, status ('production'), order_number, internal_notes.
--   NEVER insert financial fields for VMI production orders.
--   order_number is auto-generated via sequence (safe, atomic, gap-tolerant).
-- =============================================================================

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number INTEGER UNIQUE NOT NULL DEFAULT nextval('order_number_seq'),
    client_id UUID REFERENCES clients(id),
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until DATE,
    subtotal DECIMAL(15,2),
    tax_rate DECIMAL(5,4) DEFAULT 0.15,
    tax_amount DECIMAL(15,2),
    grand_total DECIMAL(15,2),
    paid_amount DECIMAL(15,2) DEFAULT 0,
    payment_method VARCHAR(50),
    sales_rep VARCHAR(255),
    internal_notes TEXT,
    client_notes TEXT,
    terms_conditions JSONB,
    custom_terms JSONB,
    snapshotted_terms JSONB,
    down_payment_required DECIMAL(15,2),
    share_token VARCHAR(100),
    token_expires_at TIMESTAMP WITH TIME ZONE,
    client_response VARCHAR(20),
    rejection_reason TEXT,
    responded_at TIMESTAMP WITH TIME ZONE,
    deposit_receipt TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: order_items
-- wh_received_qty: Updated on initial warehouse receiving (NO financial impact).
-- released_qty:    Updated when Release Order (أمر الفسح) is created.
-- delivered_qty:   Updated on manual delivery confirmation.
-- manufacturer_po_qty: Quantity sent to manufacturer.
-- =============================================================================

CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES product_variants(id),
    quantity DECIMAL(15,3) NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    line_total DECIMAL(15,2) GENERATED ALWAYS AS (
        quantity * unit_price * (1 - discount_percent / 100) - discount_amount
    ) STORED,
    manufacturer_po_qty DECIMAL(15,3) DEFAULT 0,
    wh_received_qty DECIMAL(15,3) DEFAULT 0,
    released_qty DECIMAL(15,3) DEFAULT 0,
    delivered_qty DECIMAL(15,3) DEFAULT 0,
    design_status VARCHAR(50) DEFAULT 'new',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: standard_terms
-- Reusable Terms & Conditions templates for quotations/orders.
-- =============================================================================

CREATE TABLE IF NOT EXISTS standard_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: manufacturer_orders
-- =============================================================================

CREATE TABLE IF NOT EXISTS manufacturer_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mo_number INTEGER UNIQUE NOT NULL DEFAULT nextval('manufacturer_order_number_seq'),
    manufacturer_id UUID REFERENCES suppliers(id),
    order_id UUID REFERENCES orders(id),
    expected_delivery_date DATE,
    status VARCHAR(50) DEFAULT 'pending',
    total_amount DECIMAL(15,2) DEFAULT 0,
    total_cost DECIMAL(15,2) DEFAULT 0,
    paid_amount DECIMAL(15,2) DEFAULT 0,
    has_supplier_invoice BOOLEAN DEFAULT false,
    tax_rate DECIMAL(5,4) DEFAULT 0,
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: manufacturer_order_items
-- =============================================================================

CREATE TABLE IF NOT EXISTS manufacturer_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer_order_id UUID REFERENCES manufacturer_orders(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES order_items(id),
    mo_quantity DECIMAL(15,3) NOT NULL,
    unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_cost DECIMAL(15,2) GENERATED ALWAYS AS (mo_quantity * unit_cost) STORED,
    production_status VARCHAR(50) DEFAULT 'pending',
    design_status VARCHAR(50) DEFAULT 'new',
    design_id UUID,
    received_qty DECIMAL(15,3) DEFAULT 0,
    expected_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: warehouse_stock
-- CRITICAL: All stock is CLIENT-SPECIFIC (intermediary/VMI model).
-- UNIQUE constraint on (warehouse_id, variant_id, client_id) enables
-- atomic UPSERT for dispensing stock between parent and franchise branches.
-- available_qty is a computed column: quantity - reserved_qty.
-- =============================================================================

CREATE TABLE IF NOT EXISTS warehouse_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID REFERENCES warehouses(id),
    variant_id UUID REFERENCES product_variants(id),
    client_id UUID REFERENCES clients(id),  -- NULL for general warehouse stock
    quantity DECIMAL(15,3) NOT NULL DEFAULT 0,
    reserved_qty DECIMAL(15,3) DEFAULT 0,
    available_qty DECIMAL(15,3) GENERATED ALWAYS AS (quantity - reserved_qty) STORED,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(warehouse_id, variant_id, client_id)
);

-- =============================================================================
-- TABLE: inventory_transactions
-- =============================================================================

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_id UUID REFERENCES warehouse_stock(id),  -- Reference to affected stock record
    transaction_type VARCHAR(50) NOT NULL,
    quantity DECIMAL(15,3) NOT NULL,
    variant_id UUID REFERENCES product_variants(id),
    warehouse_from UUID REFERENCES warehouses(id),
    warehouse_to UUID REFERENCES warehouses(id),
    client_id UUID REFERENCES clients(id),
    reference_type VARCHAR(50),
    reference_id UUID,
    notes TEXT,
    delivery_status VARCHAR(50),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: delivery_notes
-- =============================================================================

CREATE TABLE IF NOT EXISTS delivery_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_number INTEGER UNIQUE NOT NULL DEFAULT nextval('delivery_note_number_seq'),
    order_id UUID REFERENCES orders(id),
    client_id UUID REFERENCES clients(id),
    status VARCHAR(50) DEFAULT 'pending',
    delivery_date DATE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    driver_name VARCHAR(255),
    vehicle_number VARCHAR(50),
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: delivery_note_items
-- =============================================================================

CREATE TABLE IF NOT EXISTS delivery_note_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_note_id UUID REFERENCES delivery_notes(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES order_items(id),
    variant_id UUID REFERENCES product_variants(id),
    requested_qty DECIMAL(15,3) NOT NULL,
    delivered_qty DECIMAL(15,3) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: invoices
-- =============================================================================

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number INTEGER UNIQUE NOT NULL DEFAULT nextval('invoice_number_seq'),
    order_id UUID REFERENCES orders(id),
    client_id UUID REFERENCES clients(id),
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(5,4) DEFAULT 0.15,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    additional_expenses DECIMAL(15,2) DEFAULT 0,
    grand_total DECIMAL(15,2) NOT NULL DEFAULT 0,
    status VARCHAR(50) DEFAULT 'draft',
    payment_terms VARCHAR(100),
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: invoice_items
-- =============================================================================

CREATE TABLE IF NOT EXISTS invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES order_items(id),
    variant_id UUID REFERENCES product_variants(id),
    quantity DECIMAL(15,3) NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    line_total DECIMAL(15,2) GENERATED ALWAYS AS (
        quantity * unit_price * (1 - discount_percent / 100)
    ) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: invoice_expenses
-- =============================================================================

CREATE TABLE IF NOT EXISTS invoice_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    expense_type VARCHAR(100) NOT NULL,
    description TEXT,
    amount DECIMAL(15,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: purchase_invoices
-- Supplier purchase invoices linked to manufacturer orders.
-- =============================================================================

CREATE TABLE IF NOT EXISTS purchase_invoices (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id          UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    manufacturer_order_id UUID REFERENCES manufacturer_orders(id) ON DELETE SET NULL,
    invoice_number       INTEGER NOT NULL UNIQUE DEFAULT nextval('purchase_invoice_seq'),
    invoice_date         DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date             DATE,
    supplier_invoice_ref VARCHAR(100),
    subtotal             DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_rate             DECIMAL(5,4) DEFAULT 0.15,
    tax_amount           DECIMAL(15,2) NOT NULL DEFAULT 0,
    grand_total          DECIMAL(15,2) NOT NULL DEFAULT 0,
    paid_amount          DECIMAL(15,2) NOT NULL DEFAULT 0,
    status               VARCHAR(20) DEFAULT 'unpaid',
    notes                TEXT,
    created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier_id ON purchase_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_mo_id ON purchase_invoices(manufacturer_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_status ON purchase_invoices(status);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_invoice_date ON purchase_invoices(invoice_date);

-- =============================================================================
-- TABLE: purchase_invoice_items
-- Line items for supplier purchase invoices.
-- =============================================================================

CREATE TABLE IF NOT EXISTS purchase_invoice_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
    variant_id          UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity            DECIMAL(12,3) NOT NULL CHECK (quantity > 0),
    unit_cost           DECIMAL(15,4) NOT NULL DEFAULT 0,
    total_cost          DECIMAL(15,2) NOT NULL DEFAULT 0,
    product_name        VARCHAR(255),
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pii_invoice_id ON purchase_invoice_items(purchase_invoice_id);
CREATE INDEX IF NOT EXISTS idx_pii_variant_id ON purchase_invoice_items(variant_id);

-- =============================================================================
-- TABLE: purchase_returns
-- Returns of goods back to suppliers.
-- =============================================================================

CREATE TABLE IF NOT EXISTS purchase_returns (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_number       INTEGER NOT NULL UNIQUE DEFAULT nextval('purchase_return_number_seq'),
    return_date         DATE NOT NULL DEFAULT CURRENT_DATE,
    supplier_id         UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    purchase_invoice_id UUID REFERENCES purchase_invoices(id) ON DELETE SET NULL,
    total_amount        DECIMAL(15,2) NOT NULL DEFAULT 0,
    status              VARCHAR(20) DEFAULT 'completed',
    notes               TEXT,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier ON purchase_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_status ON purchase_returns(status);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_date ON purchase_returns(return_date);

-- =============================================================================
-- TABLE: purchase_return_items
-- Line items for supplier purchase returns.
-- =============================================================================

CREATE TABLE IF NOT EXISTS purchase_return_items (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_return_id UUID NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
    variant_id         UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity           DECIMAL(12,3) NOT NULL CHECK (quantity > 0),
    unit_cost          DECIMAL(15,4) NOT NULL DEFAULT 0,
    line_total         DECIMAL(15,2) NOT NULL DEFAULT 0,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pri_return_id ON purchase_return_items(purchase_return_id);
CREATE INDEX IF NOT EXISTS idx_pri_variant_id ON purchase_return_items(variant_id);

-- =============================================================================
-- TABLE: receiving_vouchers
-- Physical goods receiving records from suppliers/manufacturers.
-- =============================================================================

CREATE TABLE IF NOT EXISTS receiving_vouchers (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_number        INTEGER NOT NULL UNIQUE,
    receiving_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    supplier_id           UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    purchase_invoice_id   UUID REFERENCES purchase_invoices(id) ON DELETE SET NULL,
    manufacturer_order_id UUID REFERENCES manufacturer_orders(id) ON DELETE SET NULL,
    warehouse_id          UUID REFERENCES warehouses(id) ON DELETE RESTRICT,
    total_amount          DECIMAL(15,2) NOT NULL DEFAULT 0,
    status                VARCHAR(20) DEFAULT 'completed',
    notes                 TEXT,
    created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rv_supplier ON receiving_vouchers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_rv_status ON receiving_vouchers(status);
CREATE INDEX IF NOT EXISTS idx_rv_date ON receiving_vouchers(receiving_date);

-- =============================================================================
-- TABLE: receiving_voucher_items
-- Line items for receiving vouchers.
-- =============================================================================

CREATE TABLE IF NOT EXISTS receiving_voucher_items (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receiving_voucher_id UUID NOT NULL REFERENCES receiving_vouchers(id) ON DELETE CASCADE,
    variant_id           UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity             DECIMAL(12,3) NOT NULL CHECK (quantity > 0),
    unit_cost            DECIMAL(15,4) NOT NULL DEFAULT 0,
    line_total           DECIMAL(15,2) NOT NULL DEFAULT 0,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rvi_voucher_id ON receiving_voucher_items(receiving_voucher_id);
CREATE INDEX IF NOT EXISTS idx_rvi_variant_id ON receiving_voucher_items(variant_id);

-- =============================================================================
-- TABLE: accounts
-- MUST be created before accounting_voucher_lines due to FK dependency.
-- =============================================================================

CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES accounts(id),
    account_type VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: accounting_vouchers
-- IMMUTABILITY RULE: Once posted, a voucher MUST NOT be updated.
-- Any correction requires: BEGIN → Revert (cancellation voucher) → Recreate → COMMIT.
-- =============================================================================

CREATE TABLE IF NOT EXISTS accounting_vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_type VARCHAR(50) NOT NULL,
    voucher_number INTEGER UNIQUE NOT NULL DEFAULT nextval('voucher_number_seq'),
    voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
    description TEXT,
    total_amount DECIMAL(15,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'posted',
    reference_type VARCHAR(50),
    reference_id UUID,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: accounting_voucher_lines
-- Strict double-entry: SUM(debit) MUST equal SUM(credit) per voucher_id.
-- sub_account_type + sub_account_id allow linking to client/supplier ledgers.
-- =============================================================================

CREATE TABLE IF NOT EXISTS accounting_voucher_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_id UUID REFERENCES accounting_vouchers(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id),
    debit DECIMAL(15,2) DEFAULT 0,
    credit DECIMAL(15,2) DEFAULT 0,
    sub_account_type VARCHAR(50),
    sub_account_id UUID,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: client_transactions
-- Tracks client-level financial ledger movements.
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id),
    order_id UUID REFERENCES orders(id),
    invoice_id UUID REFERENCES invoices(id),
    type VARCHAR(50) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    payment_method VARCHAR(50),
    document_number INTEGER,
    description TEXT,
    linked_voucher_id UUID REFERENCES accounting_vouchers(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: tasks
-- =============================================================================

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assigned_to UUID REFERENCES users(id),
    created_by UUID REFERENCES users(id),
    due_date DATE,
    status VARCHAR(50) DEFAULT 'pending',
    priority VARCHAR(20) DEFAULT 'medium',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- TABLE: task_subtasks
-- =============================================================================

CREATE TABLE IF NOT EXISTS task_subtasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    is_completed BOOLEAN DEFAULT false,
    assigned_to UUID REFERENCES users(id),
    due_date DATE,
    comments JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- Optimized for the most common query patterns per the spec.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_clients_parent_id ON clients(parent_id);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_orders_client_id ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variant_id ON order_items(variant_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_client_id ON warehouse_stock(client_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_variant_id ON warehouse_stock(variant_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_warehouse_id ON warehouse_stock(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_client_id ON inventory_transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_variant_id ON inventory_transactions(variant_id);
CREATE INDEX IF NOT EXISTS idx_accounting_vouchers_type ON accounting_vouchers(voucher_type);
CREATE INDEX IF NOT EXISTS idx_accounting_vouchers_date ON accounting_vouchers(voucher_date);
CREATE INDEX IF NOT EXISTS idx_accounting_voucher_lines_voucher_id ON accounting_voucher_lines(voucher_id);
CREATE INDEX IF NOT EXISTS idx_accounting_voucher_lines_account_id ON accounting_voucher_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_client_transactions_client_id ON client_transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_order_id ON delivery_notes(order_id);
CREATE INDEX IF NOT EXISTS idx_manufacturer_orders_order_id ON manufacturer_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_manufacturer_orders_manufacturer_id ON manufacturer_orders(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- =============================================================================
-- SEED DATA: Default Roles
-- =============================================================================

INSERT INTO roles (role_name, permissions, description) VALUES
(
    'super_admin',
    '{"all_access": true}',
    'Full system access with no restrictions'
),
(
    'sales_manager',
    '{
        "quotations": {"create": true, "read": true, "update": true, "delete": false},
        "orders": {"create": true, "read": true, "update": true},
        "clients": {"create": true, "read": true, "update": true},
        "global": {"view_costs": true},
        "data_scope": "team"
    }',
    'Manages sales team, quotations, and orders. Can view cost prices.'
),
(
    'sales_rep',
    '{
        "quotations": {"create": true, "read": true, "update": true, "delete": false},
        "orders": {"create": false, "read": true, "update": false},
        "clients": {"create": false, "read": true, "update": false},
        "global": {"view_costs": false},
        "data_scope": "personal_only"
    }',
    'Creates and manages own quotations. Read-only on orders. Personal data scope only.'
),
(
    'inventory_manager',
    '{
        "inventory": {"create": true, "read": true, "update": true, "delete": false},
        "warehouses": {"read": true, "update": true},
        "products": {"read": true, "update": true},
        "orders": {"read": true, "update": false},
        "data_scope": "all"
    }',
    'Full control over inventory, warehouse stock, and receiving operations.'
),
(
    'accountant',
    '{
        "accounting": {"create": true, "read": true, "update": false, "delete": false},
        "invoices": {"create": true, "read": true, "update": true},
        "reports": {"read": true},
        "global": {"view_costs": true},
        "data_scope": "all"
    }',
    'Manages accounting vouchers, invoices, and financial reports. View-only on costs.'
)
ON CONFLICT (role_name) DO NOTHING;

-- =============================================================================
-- SEED DATA: Default Chart of Accounts
-- Standard double-entry accounting structure.
-- =============================================================================

INSERT INTO accounts (code, name, account_type, parent_id) VALUES
('1000', 'Current Assets', 'asset', NULL),
('1100', 'Cash on Hand', 'asset', NULL),
('1200', 'Bank Accounts', 'asset', NULL),
('1300', 'Accounts Receivable', 'asset', NULL),
('1400', 'Inventory Asset', 'asset', NULL),
('2000', 'Current Liabilities', 'liability', NULL),
('2100', 'Accounts Payable', 'liability', NULL),
('2200', 'VAT Payable', 'liability', NULL),
('3000', 'Equity', 'equity', NULL),
('3100', 'Owner Equity', 'equity', NULL),
('3200', 'Retained Earnings', 'equity', NULL),
('4000', 'Revenue', 'revenue', NULL),
('4100', 'Sales Revenue', 'revenue', NULL),
('4200', 'Service Revenue', 'revenue', NULL),
('5000', 'Cost of Goods Sold', 'expense', NULL),
('5100', 'Direct Material Cost', 'expense', NULL),
('5200', 'Manufacturer Purchase Cost', 'expense', NULL),
('6000', 'Operating Expenses', 'expense', NULL),
('6100', 'Shipping & Logistics', 'expense', NULL),
('6200', 'Administrative Fees', 'expense', NULL),
('6300', 'Salaries & Wages', 'expense', NULL)
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- SEED DATA: Default Admin User
-- Email:    admin@gpack.com
-- Password: Admin@2024!
-- Hash is bcrypt with 12 salt rounds.
-- IMPORTANT: Change this password immediately after first login.
-- =============================================================================

INSERT INTO users (email, password_hash, name, role_id, status)
SELECT
    'admin@gpack.com',
    '$2b$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'System Administrator',
    r.id,
    'active'
FROM roles r
WHERE r.role_name = 'super_admin'
ON CONFLICT (email) DO NOTHING;

-- =============================================================================
-- TABLE: audit_logs
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(100) NOT NULL,
    record_id UUID,
    action VARCHAR(20) NOT NULL,
    old_data JSONB,
    new_data JSONB,
    user_id UUID REFERENCES users(id),
    user_name VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_id ON audit_logs(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);

-- =============================================================================
-- TABLE: system_settings
-- =============================================================================

CREATE TABLE IF NOT EXISTS system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    data_type VARCHAR(20) DEFAULT 'string',
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default VAT rate
INSERT INTO system_settings (key, value, data_type, description)
VALUES ('vat_rate', '0.15', 'number', 'Default VAT rate (15%)')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- TABLE: tasks
-- =============================================================================

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assigned_to UUID REFERENCES users(id),
    created_by UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending',
    priority VARCHAR(20) DEFAULT 'medium',
    due_date DATE,
    order_id UUID REFERENCES orders(id),
    client_id UUID REFERENCES clients(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_subtasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    is_completed BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0,
    completed_by UUID REFERENCES users(id),
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    subtask_id UUID REFERENCES task_subtasks(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    comment TEXT NOT NULL,
    attachments JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add missing columns to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS share_token VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS share_token_hash VARCHAR(64);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_response TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS responded_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_receipt VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS custom_terms TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS down_payment_required DECIMAL(15,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type VARCHAR(20) DEFAULT 'sales';

-- Add missing columns to invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS share_token VARCHAR(100);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS share_token_hash VARCHAR(64);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP WITH TIME ZONE;

-- Add missing columns to order_items table
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS manufacturer_po_qty DECIMAL(15,3) DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS wh_received_qty DECIMAL(15,3) DEFAULT 0;

-- Add missing column to manufacturer_order_items
ALTER TABLE manufacturer_order_items ADD COLUMN IF NOT EXISTS received_qty DECIMAL(15,3) DEFAULT 0;

-- Create indexes for share tokens
CREATE INDEX IF NOT EXISTS idx_orders_share_token ON orders(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_share_token_hash ON orders(share_token_hash) WHERE share_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_share_token ON invoices(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_share_token_hash ON invoices(share_token_hash) WHERE share_token_hash IS NOT NULL;

-- =============================================================================
-- END OF INIT SCRIPT
-- G.PACK 2.0 Database Schema v2.0
-- =============================================================================
