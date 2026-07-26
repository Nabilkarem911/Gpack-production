# G.PACK 2.0 — Deployment Guide

## Prerequisites

- Docker Engine 24+
- Docker Compose v2+
- PostgreSQL 14+ (external, accessible from Docker network)
- Domain name with DNS pointing to server
- SSL termination (via Dokploy, Traefik, or Nginx reverse proxy)

## Environment Variables

Create `.env` file in project root:

```env
# Database
DATABASE_HOST=your-postgres-host
DATABASE_PORT=5432
DATABASE_NAME=gpack
DATABASE_USER=gpack_user
DATABASE_PASSWORD=your-secure-password

# Security
JWT_SECRET=your-jwt-secret-min-32-chars
SHARE_TOKEN_SECRET=your-share-token-secret-min-32-chars

# CORS
CORS_ORIGIN=https://erp.gpacksa.com

# WhatsApp (WAHA)
WAHA_URL=http://your-waha-instance:3000
WAHA_SESSION=default
WAHA_API_KEY=your-waha-api-key
WAHA_WEBHOOK_SECRET=your-webhook-secret
WHATSAPP_PROVIDER=waha

# App
BASE_URL=https://erp.gpacksa.com
NODE_ENV=production

# AI (optional)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
AI_ASSISTANT_ENABLED=true
```

## Deploy Steps

```bash
# 1. Clone repository
git clone https://github.com/Nabilkarem911/Gpack-production.git
cd Gpack-production

# 2. Create .env file (see above)

# 3. Build and start
docker compose up -d --build

# 4. Check health
docker compose ps
curl http://localhost/api/health

# 5. View logs
docker compose logs -f backend
docker compose logs -f notification-worker
```

## Health Checks

| Service               | Endpoint                          |
|-----------------------|-----------------------------------|
| Backend               | `GET /api/health`                 |
| Frontend              | `GET /` (nginx)                   |
| AI Service            | `GET /health`                     |
| Notification Worker   | Logs (no HTTP endpoint)           |

## Migration System

Migrations run automatically on backend startup.
- Files: `backend/migrations/*.sql`
- Tracking: `schema_migrations` table
- Safe to restart — already-applied migrations are skipped

## Re-deployment

```bash
git pull
docker compose up -d --build
```

## Rollback

```bash
# Revert to previous commit
git log --oneline -5
git checkout <previous-commit-hash>
docker compose up -d --build
```

## Docker Compose Services

| Service              | Port | Description                        |
|----------------------|------|------------------------------------|
| `backend`            | 3000 | Express API server                 |
| `notification-worker`| —    | Standalone worker process          |
| `frontend`           | 80   | Nginx serving SPA                  |
| `ai-service`         | 8000 | Python FastAPI AI assistant        |
| `mcp-server`         | 3001 | MCP server for AI integration      |
