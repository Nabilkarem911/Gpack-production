# G.PACK 2.0 — Architecture

## System Overview

G.PACK 2.0 is a Commercial Intermediary / VMI (Vendor-Managed Inventory) ERP with Franchise capabilities.
The system manages design approval workflows, WhatsApp notifications, and digital approval certificates.

## Tech Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Frontend    | Vanilla JS (ES6+), HTML5, Tailwind  |
| Backend     | Node.js + Express.js                |
| Database    | PostgreSQL 14+ (raw SQL via `pg`)   |
| Deployment  | Docker + Docker Compose             |
| Messaging   | WAHA (WhatsApp HTTP API)            |
| AI          | OpenAI (optional, Python FastAPI)   |

## Container Architecture

```
┌──────────┐     ┌──────────┐     ┌──────────────────┐
│ Frontend │────▶│ Backend  │────▶│ PostgreSQL (ext) │
│ (nginx)  │     │ (Express)│     └──────────────────┘
└──────────┘     └────┬─────┘
                      │
              ┌───────┴────────┐
              │                │
     ┌────────▼─────┐  ┌──────▼──────┐
     │ Notification  │  │ AI Service  │
     │ Worker        │  │ (FastAPI)   │
     └───────────────┘  └─────────────┘
              │
     ┌────────▼─────┐
     │ MCP Server   │
     └──────────────┘
```

## Design Approval Pipeline

```
Order Created → Item Added → Designer Assigned → Design Uploaded →
Manager Review → Send to Client → Client Review Link →
Client Approves/Requests Revision → Approval Package Generated →
Certificate + PDF + ZIP + Manifest + Audit.json →
Outbox Event → Worker → WhatsApp Notifications → Package State: notified
```

## Package State Machine

```
pending → snapshot_done → qr_done → certificate_done → pdf_done →
audit_done → manifest_done → zip_done → ready → notified
```

Each state is persisted in `design_approvals.package_state`.
If the worker crashes, it resumes from the last completed step.

## Notification Architecture

```
Business Event → Outbox (same DB transaction) →
Worker reads Outbox → Dispatches to NotificationService →
Enqueues to notification_queue → Worker polls queue →
Sends via WhatsApp (WAHA) → Success/Retry/DLQ
```

### Resilience Features

- **Outbox Pattern**: Events written in same transaction as business operation
- **Lease Tokens**: UUID `lease_id` + `processing_owner` prevents double processing
- **lease_version**: Optimistic locking counter
- **Circuit Breaker**: CLOSED → OPEN → HALF_OPEN → CLOSED for WAHA
- **Dead Letter Queue**: Permanently failed messages moved to `notification_dead_queue`
- **Exponential Backoff**: 1m → 5m → 15m → 1h → 4h, max 5 attempts

## File Immutability

- SHA-256 hashes for: PDF, Certificate, Signature, Manifest
- `manifest.json` is THE reference document (HMAC-SHA256 signed)
- `manifest.sig` contains the HMAC signature
- `audit.json` is a complete legal evidence bundle
- Snapshot files protected with `chmod 444` (read-only)

## Key Database Tables

| Table                      | Purpose                                    |
|----------------------------|--------------------------------------------|
| `orders` / `order_items`   | Sales orders and line items                |
| `design_approvals`         | Approval records with hashes + state       |
| `notification_queue`       | Pending/processing/sent notifications      |
| `notification_outbox`      | Event outbox (transactional)               |
| `notification_dead_queue`  | Permanently failed notifications           |
| `notification_settings`    | Config (admin recipients, circuit breaker) |
| `design_activity_log`      | Immutable audit trail                      |
| `workflow_history`         | State machine transitions                  |
| `waha_health_log`          | WAHA connectivity history                  |
| `notification_metrics`     | Hourly metrics snapshots                   |
| `notification_templates`   | Message templates with variables           |
| `schema_migrations`        | Applied migration tracking                 |

## Observability

- **Structured Logging**: JSON logs with `correlation_id`, `step`, `duration_ms`
- **Metrics**: `/api/metrics` endpoint (Prometheus-style)
- **Health Check**: `/api/health` (used by Docker healthcheck)

## Security

- Approval packages blocked from direct nginx access (`/uploads/designs/approvals/` → 403)
- Token-based client review links (HMAC hashed, 30-day expiry)
- JWT authentication for ERP users
- Role-based authorization (super_admin, manager, designer, admin)
- Security headers (HSTS, X-Frame-Options, X-Content-Type-Options, CSP)
