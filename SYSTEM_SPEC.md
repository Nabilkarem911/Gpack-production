# G.PACK 2.0 - Technical Specification Document

## 📋 Overview

G.PACK 2.0 is a comprehensive commercial intermediary CRM system designed for traders and middlemen, managing the complete lifecycle from price quotations to manufacturer orders, client-specific inventory management, and financial tracking. The system is built for self-hosting on VPS without external dependencies like Supabase.

---

## 🗄️ Data Model Specification

### Core Tables

#### 1. `users`
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role_id UUID REFERENCES roles(id),
    status VARCHAR(20) DEFAULT 'active', -- active, inactive, suspended
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 2. `roles`
```sql
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name VARCHAR(100) UNIQUE NOT NULL,
    permissions JSONB NOT NULL DEFAULT '{}',
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Default Roles
INSERT INTO roles (role_name, permissions) VALUES
('super_admin', '{"all_access": true}'),
('sales_manager', '{"quotations": {"create": true, "read": true, "update": true, "delete": false}, "orders": {"create": true, "read": true, "update": true}, "clients": {"create": true, "read": true, "update": true}, "global": {"view_costs": true}}'),
('sales_rep', '{"quotations": {"create": true, "read": true, "update": true}, "orders": {"create": false, "read": true}, "clients": {"read": true}, "data_scope": "personal_only"}'),
('inventory_manager', '{"inventory": {"create": true, "read": true, "update": true}, "warehouses": {"read": true, "update": true}, "products": {"read": true}}'),
('accountant', '{"accounting": {"create": true, "read": true, "update": true}, "reports": {"read": true}, "global": {"view_costs": true}}');
```

#### 3. `clients`
```sql
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES clients(id), -- For franchise/VMI hierarchy - NULL for main client
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    commercial_register VARCHAR(100),
    tax_id VARCHAR(100),
    credit_limit DECIMAL(15,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active', -- active, inactive, blacklisted
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 4. `suppliers`
```sql
CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    commercial_register VARCHAR(100),
    tax_id VARCHAR(100),
    payment_terms VARCHAR(100), -- NET30, NET60, etc.
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 5. `products`
```sql
CREATE TABLE products (
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
```

#### 6. `categories`
```sql
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES categories(id),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 7. `units`
```sql
CREATE TABLE units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL, -- كجم, قطعة, متر, etc.
    abbreviation VARCHAR(10),
    base_unit_id UUID REFERENCES units(id), -- for conversion
    conversion_factor DECIMAL(10,6) DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 8. `product_variants`
```sql
CREATE TABLE product_variants (
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
    dimensions VARCHAR(100), -- LxWxH
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 9. `warehouses`
```sql
CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE,
    warehouse_type VARCHAR(50) NOT NULL DEFAULT 'main', -- main, client_dedicated
    client_id UUID REFERENCES clients(id), -- NULL for main warehouse
    address TEXT,
    manager_id UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 10. `manufacturers`
```sql
CREATE TABLE manufacturers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    specialization VARCHAR(255), -- تخصص المصنع (طباعة، تغليف، إلخ)
    payment_terms VARCHAR(100), -- NET30, NET60, etc.
    average_delivery_days INTEGER DEFAULT 30,
    quality_rating DECIMAL(3,2) DEFAULT 5.0, -- 1-5 rating
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 11. `orders`
```sql
-- Sequence for auto-incremented order numbers
CREATE SEQUENCE order_number_seq START WITH 1001 INCREMENT BY 1;

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number INTEGER UNIQUE NOT NULL DEFAULT nextval('order_number_seq'), -- Auto-incremented integer for strict VMI compliance
    client_id UUID REFERENCES clients(id),
    status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, needs_pricing, quote, manufacturer_ordered, received, released, invoiced, completed, archived, cancelled
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until DATE,
    -- Financial fields - NULL for VMI production orders, required for commercial orders
    subtotal DECIMAL(15,2), -- NULL for VMI orders
    tax_rate DECIMAL(5,4) DEFAULT 0.15, -- 15% VAT
    tax_amount DECIMAL(15,2), -- NULL for VMI orders
    grand_total DECIMAL(15,2), -- NULL for VMI orders
    paid_amount DECIMAL(15,2) DEFAULT 0,
    payment_method VARCHAR(50), -- cash, bank_transfer, etc.
    sales_rep VARCHAR(255), -- captured from session
    internal_notes TEXT,
    client_notes TEXT,
    terms_conditions JSONB,
    snapshotted_terms JSONB, -- frozen terms at order time
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 12. `order_items`
```sql
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES product_variants(id),
    quantity DECIMAL(15,3) NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    line_total DECIMAL(15,2) GENERATED ALWAYS AS (quantity * unit_price * (1 - discount_percent/100) - discount_amount) STORED,
    -- Order tracking fields for intermediary workflow
    manufacturer_po_qty DECIMAL(15,3) DEFAULT 0, -- Quantity ordered from manufacturer
    released_qty DECIMAL(15,3) DEFAULT 0,
    delivered_qty DECIMAL(15,3) DEFAULT 0,
    wh_received_qty DECIMAL(15,3) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 13. `manufacturer_orders`
```sql
-- Sequence for manufacturer order numbers
CREATE SEQUENCE manufacturer_order_number_seq START WITH 2001 INCREMENT BY 1;

CREATE TABLE manufacturer_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mo_number INTEGER UNIQUE NOT NULL DEFAULT nextval('manufacturer_order_number_seq'),
    manufacturer_id UUID REFERENCES manufacturers(id),
    order_id UUID REFERENCES orders(id),
    expected_delivery_date DATE,
    status VARCHAR(50) DEFAULT 'pending', -- pending, confirmed, partially_received, completed, cancelled
    total_amount DECIMAL(15,2) DEFAULT 0,
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 14. `manufacturer_order_items`
```sql
CREATE TABLE manufacturer_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer_order_id UUID REFERENCES manufacturer_orders(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES order_items(id),
    mo_quantity DECIMAL(15,3) NOT NULL,
    unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_cost DECIMAL(15,2) GENERATED ALWAYS AS (mo_quantity * unit_cost) STORED,
    production_status VARCHAR(50) DEFAULT 'pending', -- pending, approved, in_production, completed
    expected_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 15. `warehouse_stock`
```sql
CREATE TABLE warehouse_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID REFERENCES warehouses(id),
    variant_id UUID REFERENCES product_variants(id),
    client_id UUID REFERENCES clients(id) NOT NULL, -- All stock is client-specific for intermediary model
    quantity DECIMAL(15,3) NOT NULL DEFAULT 0,
    reserved_qty DECIMAL(15,3) DEFAULT 0, -- for allocated orders
    available_qty DECIMAL(15,3) GENERATED ALWAYS AS (quantity - reserved_qty) STORED,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(warehouse_id, variant_id, client_id)
);
```

#### 16. `inventory_transactions`
```sql
CREATE TABLE inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_type VARCHAR(50) NOT NULL, -- supply, dispense, transfer, adjustment
    quantity DECIMAL(15,3) NOT NULL,
    variant_id UUID REFERENCES product_variants(id),
    warehouse_from UUID REFERENCES warehouses(id),
    warehouse_to UUID REFERENCES warehouses(id),
    client_id UUID REFERENCES clients(id),
    reference_type VARCHAR(50), -- manufacturer_order, delivery_note, adjustment
    reference_id UUID,
    notes TEXT,
    delivery_status VARCHAR(50), -- pending, shipped, delivered
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 17. `delivery_notes`
```sql
-- Sequence for delivery note numbers
CREATE SEQUENCE delivery_note_number_seq START WITH 3001 INCREMENT BY 1;

CREATE TABLE delivery_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_number INTEGER UNIQUE NOT NULL DEFAULT nextval('delivery_note_number_seq'),
    order_id UUID REFERENCES orders(id),
    client_id UUID REFERENCES clients(id),
    status VARCHAR(50) DEFAULT 'pending', -- pending, confirmed, shipped, delivered, cancelled
    delivery_date DATE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    driver_name VARCHAR(255),
    vehicle_number VARCHAR(50),
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 18. `delivery_note_items`
```sql
CREATE TABLE delivery_note_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_note_id UUID REFERENCES delivery_notes(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES order_items(id),
    variant_id UUID REFERENCES product_variants(id),
    requested_qty DECIMAL(15,3) NOT NULL,
    delivered_qty DECIMAL(15,3) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 19. `invoices`
```sql
-- Sequence for invoice numbers
CREATE SEQUENCE invoice_number_seq START WITH 4001 INCREMENT BY 1;

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number INTEGER UNIQUE NOT NULL DEFAULT nextval('invoice_number_seq'),
    order_id UUID REFERENCES orders(id),
    client_id UUID REFERENCES clients(id),
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(5,4) DEFAULT 0.15, -- 15% VAT
    tax_amount DECIMAL(15,2) DEFAULT 0,
    additional_expenses DECIMAL(15,2) DEFAULT 0, -- Shipping, admin fees, etc.
    grand_total DECIMAL(15,2) NOT NULL DEFAULT 0,
    status VARCHAR(50) DEFAULT 'draft', -- draft, sent, paid, overdue, cancelled
    payment_terms VARCHAR(100), -- NET30, NET60, etc.
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 20. `invoice_items`
```sql
CREATE TABLE invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES order_items(id),
    variant_id UUID REFERENCES product_variants(id),
    quantity DECIMAL(15,3) NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    line_total DECIMAL(15,2) GENERATED ALWAYS AS (quantity * unit_price * (1 - discount_percent/100)) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 21. `invoice_expenses`
```sql
CREATE TABLE invoice_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    expense_type VARCHAR(100) NOT NULL, -- shipping, admin_fees, handling, etc.
    description TEXT,
    amount DECIMAL(15,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 22. `accounting_vouchers`
```sql
-- Sequence for accounting voucher numbers
CREATE SEQUENCE voucher_number_seq START WITH 5001 INCREMENT BY 1;

CREATE TABLE accounting_vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_type VARCHAR(50) NOT NULL, -- receipt, payment, journal
    voucher_number INTEGER UNIQUE NOT NULL DEFAULT nextval('voucher_number_seq'),
    voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
    description TEXT,
    total_amount DECIMAL(15,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'posted', -- draft, posted, cancelled
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 23. `accounting_voucher_lines`
```sql
CREATE TABLE accounting_voucher_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_id UUID REFERENCES accounting_vouchers(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id),
    debit DECIMAL(15,2) DEFAULT 0,
    credit DECIMAL(15,2) DEFAULT 0,
    sub_account_type VARCHAR(50), -- client, supplier, etc.
    sub_account_id UUID,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 24. `accounts`
```sql
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES accounts(id),
    account_type VARCHAR(50) NOT NULL, -- asset, liability, equity, revenue, expense
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 25. `client_transactions`
```sql
CREATE TABLE client_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id),
    order_id UUID REFERENCES orders(id),
    invoice_id UUID REFERENCES invoices(id),
    type VARCHAR(50) NOT NULL, -- payment, invoice, credit_note, debit_note
    amount DECIMAL(15,2) NOT NULL,
    payment_method VARCHAR(50),
    document_number INTEGER, -- Reference to invoice_number or voucher_number
    description TEXT,
    linked_voucher_id UUID REFERENCES accounting_vouchers(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 26. `tasks`
```sql
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assigned_to UUID REFERENCES users(id),
    created_by UUID REFERENCES users(id),
    due_date DATE,
    status VARCHAR(50) DEFAULT 'pending', -- pending, in_progress, completed, cancelled
    priority VARCHAR(20) DEFAULT 'medium', -- low, medium, high, urgent
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 27. `task_subtasks`
```sql
CREATE TABLE task_subtasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    is_completed BOOLEAN DEFAULT false,
    assigned_to UUID REFERENCES users(id),
    due_date DATE,
    comments JSONB DEFAULT '[]', -- array of comment objects
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 👥 User Roles & Permissions Matrix

### Role Hierarchy & Access Levels

| Feature | Super Admin | Sales Manager | Sales Rep | Inventory Manager | Accountant |
|---------|-------------|---------------|-----------|-------------------|------------|
| **User Management** | ✅ Full | ❌ | ❌ | ❌ | ❌ |
| **Role Management** | ✅ Full | ❌ | ❌ | ❌ | ❌ |
| **Client Management** | ✅ Full | ✅ CRUD | 🔍 Read Own | 🔍 Read | 🔍 Read |
| **Supplier Management** | ✅ Full | ✅ CRUD | ❌ | ✅ CRUD | 🔍 Read |
| **Product Catalog** | ✅ Full | ✅ CRUD | 🔍 Read | ✅ Update Stock | 🔍 Read |
| **Quotations** | ✅ Full | ✅ CRUD | ✅ Own Only | ❌ | ❌ |
| **Orders** | ✅ Full | ✅ CRUD | 🔍 Read Own | ✅ Release/Delivery | ❌ |
| **Inventory** | ✅ Full | 🔍 Read | ❌ | ✅ Full Control | ❌ |
| **Accounting** | ✅ Full | 🔍 Read Costs | ❌ | ❌ | ✅ Full |
| **Reports** | ✅ All | ✅ Sales | 📊 Own Sales | 📊 Inventory | 📊 Financial |
| **Tasks** | ✅ Full | ✅ Team | ✅ Own | ✅ Related | ❌ |

### Data Scoping Rules

1. **Super Admin**: Full access to all data
2. **Sales Manager**: Access to team data + view costs
3. **Sales Rep**: Personal data only (created_by = user_id)
4. **Inventory Manager**: Inventory and warehouse data
5. **Accountant**: Financial data and reports

### Permission Implementation

```javascript
// Permission Check Examples
const permissions = {
  quotations: {
    create: true,    // Can create new quotations
    read: true,      // Can view quotations
    update: true,    // Can edit quotations
    delete: false    // Cannot delete quotations
  },
  global: {
    view_costs: true // Can see cost prices and margins
  },
  data_scope: 'team' // personal_only, team, or all
};
```

---

## 🔄 Workflow Lifecycle: Commercial Intermediary Process

### Phase 1: Quotation Creation

```
1. Sales Rep creates quotation
   ├── Select client (existing or new)
   ├── Add products/variants
   ├── Set quantities and client-specific prices
   ├── Apply discounts if needed
   └── Add terms and notes

2. Price Validation
   ├── Check for zero prices
   ├── If zero price → Status: NEEDS_PRICING
   ├── If all priced → Status: QUOTE
   └── Manager approval for pricing

3. Quotation Management
   ├── Edit allowed until converted
   ├── PDF generation for client
   ├── Validity period tracking
   └── Follow-up reminders
```

### Phase 2: Quote to Manufacturer Order Conversion

```
1. Conversion Process
   ├── Manager approval required
   ├── Optional down payment capture
   ├── Auto-generate receipt voucher
   ├── Update order status to MANUFACTURER_ORDERED
   └── Create manufacturer orders

2. Down Payment Flow
   ├── Select payment method (cash/bank)
   ├── Generate receipt voucher (RV-XXXXXX)
   ├── Double-entry posting:
   │   ├── Debit: Cash/Bank Account
   │   └──── Credit: AR Account (1300)
   └── Update client transaction history
```

### Phase 3: Manufacturer Order Management

```
1. Manufacturer Order Creation
   ├── Generate MO numbers (MO-XXXXXX)
   ├── Link to client order items
   ├── Select appropriate manufacturer
   ├── Set unit costs and quantities
   └── Track production status per item

2. Receiving Indicators
   ├── 🔴 Red: No items received (wh_received_qty = 0)
   ├── 🟡 Yellow: Partial receiving (0 < received < planned)
   └── 🟢 Green: Complete receiving (received >= planned)

3. Initial Receiving from Manufacturer
   ├── Filter by pending manufacturer orders
   ├── Update wh_received_qty
   ├── Create inventory transactions
   └── Update warehouse stock (client-specific)
```

### Phase 4: Release Order (أمر الفسح) - Manual Process

```
1. Release Process
   ├── Create delivery note (DEL-XXXXXX)
   ├── Select quantities to release
   ├── Update released_qty in order_items
   └── Status: PENDING delivery

2. Release Validation
   ├── Check available stock in client warehouse
   ├── Prevent over-release
   ├── Reserve stock for delivery
   └── Generate picking list for warehouse staff
```

### Phase 5: Manual Delivery Confirmation

```
1. Manual Delivery Process
   ├── Warehouse staff confirms items ready
   ├── Driver picks up items
   ├── Manual confirmation of delivery to client
   ├── Update delivery note status to DELIVERED
   ├── Update delivered_qty
   ├── Deduct from warehouse_stock
   └── Create inventory transaction

2. Financial Impact
   ├── Update order status to INVOICED
   ├── Generate invoice with additional expenses
   ├── Track delivery completion
   └── Generate delivery reports
```

### Phase 6: Invoice Generation & Order Completion

```
1. Invoice Creation
   ├── Generate invoice number (INV-XXXXXX)
   ├── Include order items
   ├── Add additional expenses (shipping, admin fees)
   ├── Calculate grand total with VAT
   └── Send to client

2. Final Steps
   ├── Archive completed orders
   ├── Generate performance reports
   ├── Calculate sales commissions (2% default)
   └── Update client statistics
```

---

## 🌐 API Design Specification

### Authentication & Authorization

#### POST /api/auth/login
```json
{
  "email": "user@example.com",
  "password": "password123"
}

Response:
{
  "token": "jwt_token_here",
  "user": {
    "id": "uuid",
    "name": "User Name",
    "email": "user@example.com",
    "role": "sales_manager",
    "permissions": {...}
  }
}
```

#### POST /api/auth/logout
```json
Headers: Authorization: Bearer <token>
Response: { "message": "Logged out successfully" }
```

#### GET /api/auth/me
```json
Headers: Authorization: Bearer <token>
Response: { "user": {...} }
```

### Client Management

#### GET /api/clients
```json
Query Parameters:
- page: number (default: 1)
- limit: number (default: 20)
- search: string (optional)
- status: string (optional)

Response:
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

#### POST /api/clients
```json
{
  "name": "Client Name",
  "contact_person": "John Doe",
  "phone": "+9661234567890",
  "email": "client@example.com",
  "address": "123 Street, City",
  "city": "Riyadh",
  "commercial_register": "123456",
  "tax_id": "312345678900003"
}
```

#### GET /api/clients/:id
#### PUT /api/clients/:id
#### DELETE /api/clients/:id

### Product Management

#### GET /api/products
```json
Query Parameters:
- category_id: uuid (optional)
- search: string (optional)
- include_variants: boolean (default: false)
```

#### POST /api/products
```json
{
  "name": "Product Name",
  "description": "Product description",
  "category_id": "uuid",
  "sku": "PROD-001",
  "variants": [
    {
      "size_name": "Large",
      "sku": "PROD-001-L",
      "unit_id": "uuid",
      "selling_price": 100.00,
      "cost_price": 80.00,
      "min_stock_level": 10
    }
  ]
}
```

#### GET /api/products/:id
#### PUT /api/products/:id
#### DELETE /api/products/:id

### Quotations & Orders

#### GET /api/quotations
```json
Query Parameters:
- status: string (draft|needs_pricing|quote|production|completed|archived)
- client_id: uuid (optional)
- sales_rep: string (optional)
- date_from: date (optional)
- date_to: date (optional)
- page: number
- limit: number
```

#### POST /api/quotations
```json
{
  "client_id": "uuid",
  "order_date": "2024-01-15",
  "valid_until": "2024-02-15",
  "items": [
    {
      "variant_id": "uuid",
      "quantity": 100,
      "unit_price": 150.00,
      "discount_percent": 5
    }
  ],
  "internal_notes": "Notes",
  "terms_conditions": {
    "down_payment": 20,
    "show_down_payment": true,
    "notes": "Custom terms"
  }
}
Response:
{
  "id": "uuid",
  "order_number": 1001, // Auto-generated integer
  "status": "draft",
  "created_at": "2024-01-15T10:00:00Z"
}
```

#### GET /api/quotations/:id
#### PUT /api/quotations/:id
#### DELETE /api/quotations/:id

#### POST /api/quotations/:id/convert-to-production
```json
{
  "down_payment_amount": 5000.00,
  "down_payment_safe_id": "uuid"
}
```

### Inventory Management

#### GET /api/inventory/stock
```json
Query Parameters:
- warehouse_id: uuid (optional)
- variant_id: uuid (optional)
- client_id: uuid (optional)
- low_stock: boolean (default: false)
```

#### GET /api/inventory/movements
```json
Query Parameters:
- transaction_type: string (supply|dispense|transfer|adjustment)
- date_from: date (optional)
- date_to: date (optional)
- variant_id: uuid (optional)
```

#### POST /api/inventory/adjustment
```json
{
  "variant_id": "uuid",
  "warehouse_id": "uuid",
  "quantity": -10,
  "adjustment_type": "damage",
  "notes": "Items damaged in transit"
}
```

### Delivery Management

#### GET /api/delivery-notes
```json
Query Parameters:
- status: string (pending|confirmed|shipped|delivered)
- order_id: uuid (optional)
- date_from: date (optional)
```

#### POST /api/orders/:id/release-order
```json
{
  "items": [
    {
      "order_item_id": "uuid",
      "release_quantity": 50
    }
  ],
  "notes": "Release notes"
}
```

#### POST /api/delivery-notes/:id/confirm-delivery
```json
{
  "items": [
    {
      "delivery_note_item_id": "uuid",
      "delivered_quantity": 48
    }
  ],
  "notes": "2 items damaged"
}
```

### Manufacturer Management

#### GET /api/manufacturers
#### POST /api/manufacturers
#### GET /api/manufacturers/:id
#### PUT /api/manufacturers/:id

#### GET /api/manufacturer-orders
```json
Query Parameters:
- manufacturer_id: uuid (optional)
- status: string (pending|confirmed|completed)
```

#### POST /api/manufacturer-orders
```json
{
  "manufacturer_id": "uuid",
  "order_id": "uuid",
  "expected_delivery_date": "2024-02-01",
  "items": [
    {
      "order_item_id": "uuid",
      "mo_quantity": 100,
      "unit_cost": 80.00
    }
  ]
}
```

### Invoice Management

#### GET /api/invoices
```json
Query Parameters:
- status: string (draft|sent|paid|overdue|cancelled)
- client_id: uuid (optional)
- date_from: date (optional)
- date_to: date (optional)
- page: number
- limit: number
```

#### POST /api/invoices
```json
{
  "order_id": "uuid",
  "invoice_date": "2024-01-15",
  "due_date": "2024-02-15",
  "additional_expenses": [
    {
      "expense_type": "shipping",
      "description": "Delivery charges",
      "amount": 150.00
    },
    {
      "expense_type": "admin_fees",
      "description": "Administrative fees",
      "amount": 50.00
    }
  ],
  "notes": "Invoice notes"
}
```

#### GET /api/invoices/:id
#### PUT /api/invoices/:id
#### DELETE /api/invoices/:id

#### POST /api/invoices/:id/send
```json
{
  "send_method": "email", // email, print
  "recipient_email": "client@example.com"
}
```

### Financial Management

#### GET /api/accounting/vouchers
```json
Query Parameters:
- voucher_type: string (receipt|payment|journal)
- date_from: date (optional)
- date_to: date (optional)
```

#### POST /api/accounting/vouchers
```json
{
  "voucher_type": "receipt",
  "voucher_date": "2024-01-15",
  "description": "Down payment for order #123",
  "lines": [
    {
      "account_id": "uuid", // Cash account
      "debit": 5000.00,
      "credit": 0
    },
    {
      "account_id": "uuid", // AR account
      "debit": 0,
      "credit": 5000.00,
      "sub_account_type": "client",
      "sub_account_id": "uuid"
    }
  ]
}
```

#### GET /api/clients/:id/transactions
#### GET /api/reports/sales
#### GET /api/reports/inventory

### Task Management

#### GET /api/tasks
```json
Query Parameters:
- assigned_to: uuid (optional)
- status: string (optional)
- priority: string (optional)
```

#### POST /api/tasks
```json
{
  "title": "Follow up with client",
  "description": "Contact client regarding quotation",
  "assigned_to": "uuid",
  "due_date": "2024-01-20",
  "priority": "high"
}
```

#### GET /api/tasks/:id
#### PUT /api/tasks/:id
#### DELETE /api/tasks/:id

#### POST /api/tasks/:id/subtasks
```json
{
  "title": "Call client",
  "assigned_to": "uuid",
  "due_date": "2024-01-18"
}
```

### Reports & Analytics

#### GET /api/reports/dashboard
```json
Response:
{
  "summary": {
    "total_quotations": 150,
    "pending_quotations": 25,
    "conversion_rate": 0.75,
    "total_sales": 1500000,
    "outstanding_receivables": 250000
  },
  "top_products": [...],
  "sales_by_rep": [...],
  "inventory_alerts": [...]
}
```

#### GET /api/reports/sales-performance
#### GET /api/reports/inventory-valuation
#### GET /api/reports/client-statistics

---

## 🏢 VMI & Franchise Architecture

### Client Hierarchy System
The system supports VMI (Vendor-Managed Inventory) with franchise/branch structure:

```sql
-- Client Relationships
Main Client (parent_id = NULL)
├── Branch 1 (parent_id = main_client_id)
├── Branch 2 (parent_id = main_client_id)
└── Branch 3 (parent_id = main_client_id)
```

### VMI Order Types
1. **VMI Production Orders:**
   - Only: `client_id`, `status`, `order_number`, `internal_notes`
   - Financial fields: NULL
   - Used for internal inventory management

2. **Commercial Orders:**
   - All fields including financial data
   - Used for client billing and invoicing

### Stock Allocation Logic
```sql
-- Stock can be dispensed from main client to branches
UPDATE warehouse_stock 
SET quantity = quantity - :dispensed_qty
WHERE client_id = :main_client_id AND variant_id = :variant_id;

-- Branch receives stock
INSERT INTO warehouse_stock (client_id, variant_id, quantity, warehouse_id)
VALUES (:branch_id, :variant_id, :dispensed_qty, :warehouse_id)
ON CONFLICT (warehouse_id, variant_id, client_id) 
DO UPDATE SET quantity = warehouse_stock.quantity + EXCLUDED.quantity;
```

### Transaction Safety (No ORM)
All accounting transactions use raw PostgreSQL queries with explicit transaction control:

```javascript
// Example: Double-entry transaction with rollback safety
const client = await pool.connect();
try {
  await client.query('BEGIN');
  
  // Debit entry
  await client.query(
    'INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit) VALUES ($1, $2, $3, $4)',
    [voucherId, debitAccountId, amount, 0]
  );
  
  // Credit entry
  await client.query(
    'INSERT INTO accounting_voucher_lines (voucher_id, account_id, debit, credit, sub_account_type, sub_account_id) VALUES ($1, $2, $3, $4, $5, $6)',
    [voucherId, creditAccountId, 0, amount, 'client', clientId]
  );
  
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

---

## 🔒 Security & Data Validation

### Input Validation Rules
- All monetary fields: Decimal(15,2) format
- Email: Valid email format
- Phone: International format validation
- Dates: ISO 8601 format
- UUID: Valid UUID v4 format

### Rate Limiting
- Authentication endpoints: 5 attempts per minute
- General API: 1000 requests per hour per user
- File uploads: 10 files per hour

### Data Encryption
- Passwords: bcrypt with salt rounds 12
- Sensitive data: AES-256 encryption at rest
- API communication: TLS 1.3 required

### Audit Trail
- All CRUD operations logged
- User action tracking
- Data change history
- Login/logout events

---

## 📊 Performance Requirements

### Response Time Targets
- API responses: < 200ms (95th percentile)
- Database queries: < 100ms average
- File uploads: < 5 seconds for 10MB
- Report generation: < 30 seconds

### Scalability Considerations
- Support 100+ concurrent users
- Handle 1M+ order records
- Process 10K+ daily transactions
- 99.9% uptime availability

### Caching Strategy
- Redis for session management
- Product catalog caching (30 minutes)
- Report data caching (15 minutes)
- API response caching where appropriate

---

## 🚀 Self-Hosted Deployment Architecture

### Technology Stack (Strict VMI Compliance)
- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL 14+ (direct connection)
- **Database Access:** Raw PostgreSQL Queries (NO ORM - 100% transaction control)
- **Frontend:** Vanilla JavaScript + HTML5 + CSS3 (Modular SPA - NO React/Vue)
- **Authentication:** JWT + bcrypt
- **File Storage:** Local filesystem or optional cloud storage
- **Email:** Nodemailer with SMTP configuration

### Environment Configuration
- **Development:** Local Docker Compose setup
- **Staging:** VPS with Docker containers
- **Production:** VPS with Docker Compose + reverse proxy

### VPS Requirements
- **Minimum Specs:** 2 CPU cores, 4GB RAM, 50GB SSD
- **Recommended Specs:** 4 CPU cores, 8GB RAM, 100GB SSD
- **Operating System:** Ubuntu 22.04 LTS or CentOS 8
- **Docker & Docker Compose** installed

### Database Setup
```bash
# PostgreSQL configuration
- PostgreSQL 14+ with JSONB support
- Connection pooling via PgBouncer (optional)
- Automated backups via pg_dump + cron
- Point-in-time recovery setup (WAL archiving)
```

### Docker Compose Structure
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:14
    environment:
      POSTGRES_DB: gpack_db
      POSTGRES_USER: gpack_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
      - ./database/init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"

  backend:
    build: ./backend
    environment:
      DATABASE_HOST: postgres
      DATABASE_NAME: gpack_db
      DATABASE_USER: gpack_user
      DATABASE_PASSWORD: ${DB_PASSWORD}
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    depends_on:
      - postgres
    ports:
      - "3000:3000"
    volumes:
      - ./backend:/app
      - /app/node_modules

  frontend:
    image: nginx:alpine
    volumes:
      - ./frontend:/usr/share/nginx/html
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
    ports:
      - "80:80"
    depends_on:
      - backend

volumes:
  postgres_data:
```

### Reverse Proxy (Nginx)
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://frontend:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location /api {
        proxy_pass http://backend:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Backup Strategy
- **Database Backups:** Daily automated via cron
- **File Backups:** Weekly full system backup
- **Retention:** 30 days daily, 12 weeks weekly
- **Recovery:** Point-in-time restoration capability

### Monitoring & Security
- **Monitoring:** Simple health checks + logs
- **Security:** UFW firewall, SSL certificates (Let's Encrypt)
- **Updates:** Automatic security patches
- **Logs:** Centralized logging with logrotate

---

## 📝 Integration Requirements

### External Systems
- Email service for notifications
- SMS service for alerts
- Payment gateway integration
- Accounting software export

### API Versioning
- Current version: v1
- Backward compatibility policy
- Deprecation notice period: 90 days
- Version in URL path: /api/v1/

---

## 🧪 Testing Strategy

### Unit Testing
- Minimum 80% code coverage
- Business logic validation
- Data model testing
- Utility function testing

### Integration Testing
- API endpoint testing
- Database integration
- Third-party service integration
- Workflow testing

### Performance Testing
- Load testing scenarios
- Stress testing limits
- Database query optimization
- Memory usage monitoring

---

*This specification document serves as the foundation for G.PACK 2.0 development and should be referenced throughout the implementation process.*
