# Local infrastructure

启动本地依赖：

```bash
docker compose -f infrastructure/local/docker-compose.yml up -d
```

Migrations：

```bash
psql "$DATABASE_URL" -f infrastructure/migrations/0001_foundation.sql
psql "$DATABASE_URL" -f infrastructure/migrations/0002_idempotency.sql
psql "$DATABASE_URL" -f infrastructure/migrations/0003_demand.sql
psql "$DATABASE_URL" -f infrastructure/migrations/0004_identity.sql
psql "$DATABASE_URL" -f infrastructure/migrations/0005_outbox_domain_ids.sql
psql "$DATABASE_URL" -f infrastructure/migrations/0006_session_tokens.sql
psql "$DATABASE_URL" -f infrastructure/migrations/0007_login_challenges.sql
```

PostgreSQL 是 canonical store；Redis 和 Object Storage 只作为非权威基础设施。
