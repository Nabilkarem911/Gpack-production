# G.PACK 2.0 — Disaster Recovery

## Backup Procedure

### 1. Database Backup

```bash
# Full database dump (run daily via cron)
pg_dump -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -F c -f /backups/gpack_$(date +%Y%m%d_%H%M%S).dump

# Keep 30 days of backups
find /backups -name "gpack_*.dump" -mtime +30 -delete
```

### 2. File System Backup

```bash
# Approval packages, design files, signatures
tar -czf /backups/uploads_$(date +%Y%m%d).tar.gz backend/uploads/
```

### 3. Docker Volume Backup (if using volumes)

```bash
docker run --rm -v gpack_uploads:/data -v /backups:/backup alpine \
  tar -czf /backup/uploads_$(date +%Y%m%d).tar.gz /data
```

## Restore Procedure

### 1. Database Restore

```bash
# Stop services
docker compose down

# Restore database
pg_restore -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -c /backups/gpack_20260726_160000.dump

# Start services
docker compose up -d --build
```

### 2. File System Restore

```bash
# Restore uploads
tar -xzf /backups/uploads_20260726.tar.gz -C backend/

# Verify file permissions
chmod -R 755 backend/uploads/
```

### 3. Verification Checklist

- [ ] `GET /api/health` returns 200
- [ ] All migrations applied (`schema_migrations` table)
- [ ] Login works (test with admin account)
- [ ] Design review links work (test with existing token)
- [ ] Approval certificates verifiable (`GET /api/public/design/verify/:certNumber`)
- [ ] File hashes match DB (`verifyPackageIntegrity` for recent approvals)
- [ ] Notification queue processing (check `notification_queue` for stuck items)
- [ ] WAHA connectivity (check `/api/notifications/whatsapp/health`)

## Crash Recovery

### Worker Crash During Package Generation

The package state machine tracks each step:
```
pending → snapshot_done → qr_done → certificate_done → pdf_done →
audit_done → manifest_done → zip_done → ready → notified
```

If the worker crashes:
1. The outbox event remains in `pending` status
2. On restart, the worker reprocesses the outbox event
3. `processApproval` checks `package_state` and resumes from the last step
4. Already-generated files are not regenerated

### Worker Crash During Notification

1. The `lease_id` on the queue item prevents double processing
2. After 10 minutes, `_reclaimStuckItems` moves the item back to `pending`
3. The item is retried with the next attempt number

### Database Failure

1. Backend health check fails → Docker restarts the container
2. Worker polling fails → retries on next interval
3. No data loss — all state is in PostgreSQL

### WAHA Failure

1. Circuit breaker opens after 5 consecutive failures
2. Messages stay in queue (not lost)
3. Circuit breaker enters HALF_OPEN after 60 seconds
4. If WAHA recovers, messages flow again
5. If not, circuit re-opens

## Emergency Contacts

- System Admin: [configure]
- Database Admin: [configure]
- Hosting Provider: [configure]
