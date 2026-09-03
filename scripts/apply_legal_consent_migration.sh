#!/bin/bash
# R16.10-P1-F: 注册链缺失迁移应用验证脚本（修复缺陷：本地测试库缺 legal_consent 表）
# 执行条件：DATABASE_URL 已设置（生产/测试库可访问）
# 当前状态：本地无 psql / 无 DATABASE_URL → 生产应用时需执行以下命令
set -euo pipefail
DB_URL="${DATABASE_URL:?必须设置 DATABASE_URL（如 postgres://postgres:postgres@localhost:5432/bom_intelligence?sslmode=disable）}"
echo "=== 应用注册链缺失迁移（059_user_legal_consents）==="
psql "$DB_URL" -v ON_ERROR_STOP=1 -f apps/api-go/migrations/059_user_legal_consents.sql
echo "=== 验证表存在 ==="
psql "$DB_URL" -c "SELECT COUNT(*) AS legal_consent_rows FROM privacy.legal_consent_records;"
echo "=== 验证迁移完整性（59 前后无缺口）==="
psql "$DB_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='privacy';"
