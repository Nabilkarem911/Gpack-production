# G.PACK 2.0 — Runbook

## Common Operations

### Check System Health

```bash
# All containers
docker compose ps

# Backend health
curl https://erp.gpacksa.com/api/health

# Metrics (requires auth)
curl -H "Cookie: token=YOUR_JWT" https://erp.gpacksa.com/api/metrics
```

### View Logs

```bash
# Backend (structured JSON)
docker compose logs -f backend

# Notification worker
docker compose logs -f notification-worker

# Frontend (nginx)
docker compose logs -f frontend

# AI service
docker compose logs -f ai-service
```

### Restart a Service

```bash
docker compose restart backend
docker compose restart notification-worker
docker compose restart frontend
```

### Rebuild After Code Change

```bash
git pull
docker compose up -d --build
```

## Troubleshooting

### Backend Unhealthy

1. Check logs: `docker compose logs backend`
2. Check DB connectivity: `curl https://erp.gpacksa.com/api/health`
3. If migration failed: check `schema_migrations` table
4. If DB down: contact DB admin, then `docker compose restart backend`

### Design Review Link Returns 404

1. Check if `SHARE_TOKEN_SECRET` is set in `.env`
2. Check if token has expired (30-day expiry)
3. Check `order_items.review_token_hash` in DB
4. Regenerate link: Manager → Design Task → Resend Review

### Notifications Not Sending

1. Check worker: `docker compose logs notification-worker`
2. Check WAHA: `curl https://erp.gpacksa.com/api/notifications/whatsapp/health`
3. Check circuit breaker state (in health endpoint response)
4. Check queue: `SELECT status, COUNT(*) FROM notification_queue GROUP BY status`
5. Check DLQ: `SELECT COUNT(*) FROM notification_dead_queue`
6. If circuit open: wait 60s for HALF_OPEN, or restart worker

### Approval Package Not Generated

1. Check `design_approvals.package_state` for the item
2. Check backend logs for `approval_processing_error`
3. If stuck in non-`ready` state: reprocess outbox event
   ```sql
   UPDATE notification_outbox SET status = 'pending' WHERE entity_id = ITEM_ID AND status != 'processed';
   ```
4. Restart worker: `docker compose restart notification-worker`

### Stuck Queue Items

```sql
-- Find items stuck in processing > 10 minutes
SELECT id, message_type, recipient, processing_started_at
FROM notification_queue
WHERE status = 'processing' AND processing_started_at < NOW() - INTERVAL '10 minutes';

-- The worker auto-reclaims these, but you can force:
UPDATE notification_queue
SET status = 'pending', processing_started_at = NULL, lease_id = NULL, processing_owner = NULL
WHERE status = 'processing' AND processing_started_at < NOW() - INTERVAL '10 minutes';
```

### WAHA Session Disconnected

1. Check: `GET /api/notifications/whatsapp/health`
2. Restart WAHA session: `POST /api/notifications/whatsapp/start`
3. Get QR code: `GET /api/notifications/whatsapp/qr`
4. Scan QR with phone

## Monitoring Checklist (Daily)

- [ ] All containers running (`docker compose ps`)
- [ ] Backend health OK (`/api/health`)
- [ ] No stuck queue items
- [ ] WAHA connected
- [ ] No items in DLQ (or investigate if any)
- [ ] Disk space sufficient (approval packages grow over time)
- [ ] Database backup completed

## Performance Tuning

### Queue Processing Speed

- Default poll interval: 15 seconds
- Batch size: 10 items per poll
- To increase throughput: reduce `POLL_INTERVAL_MS` in `notification-worker.js`

### Database

- `notification_queue` needs indexes on `(status, next_attempt_at)` and `lease_id`
- `notification_outbox` needs index on `(status, created_at)`
- `design_approvals` needs index on `package_state`

### File Storage

- Approval packages are stored in `backend/uploads/designs/approvals/YYYY/MM/DD/item-ITEM_ID/`
- ZIP files stored one level up: `backend/uploads/designs/approvals/YYYY/MM/DD/item-ITEM_ID.zip`
- Consider S3/MinIO for production scale
