#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

M="mysql -h $DB_HOST -P $DB_PORT -u $DB_MIGRATE_USER -p$DB_MIGRATE_PASS"

$M -e "DROP DATABASE IF EXISTS $DB_NAME;"
$M < sql/schemas.sql
$M $DB_NAME < sql/triggers.sql
$M $DB_NAME < sql/seed.sql
echo "mockfolio reset complete"