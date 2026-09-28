#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

usage() {
  cat >&2 <<USAGE
usage: scripts/reset_db.sh <database> [--force]

Drops and rebuilds <database> from sql/*.sql, then prints row counts.
Refuses to touch DB_NAME ($DB_NAME) without --force, because that is the
database holding your demo data.

  scripts/reset_db.sh ${TEST_DB_NAME:-mockfolio_test}
  scripts/reset_db.sh $DB_NAME --force
USAGE
  exit 2
}

TARGET="${1:-}"
FORCE="${2:-}"
[ -n "$TARGET" ] || usage

if [ "$TARGET" = "$DB_NAME" ] && [ "$FORCE" != "--force" ]; then
  echo "refusing to reset $TARGET (DB_NAME) without --force" >&2
  usage
fi

run() { mysql --defaults-extra-file=<(printf '[client]\nuser=%s\npassword=%s\n' "$DB_MIGRATE_USER" "$DB_MIGRATE_PASS") -h "$DB_HOST" -P "$DB_PORT" "$@"; }

echo "resetting database: $TARGET"
run -e "DROP DATABASE IF EXISTS \`$TARGET\`; CREATE DATABASE \`$TARGET\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"

for f in schema triggers views procedures seed migrate_006_orders migrate_007_universe; do
  echo "  applying sql/$f.sql"
  run "$TARGET" < "sql/$f.sql" > /dev/null
done

run "$TARGET" -t -e "
SELECT 'users' AS table_name, COUNT(*) AS rows_present FROM users
UNION ALL SELECT 'accounts', COUNT(*) FROM accounts
UNION ALL SELECT 'instruments', COUNT(*) FROM instruments
UNION ALL SELECT 'price_state', COUNT(*) FROM price_state
UNION ALL SELECT 'settings', COUNT(*) FROM settings
UNION ALL SELECT 'watchlist', COUNT(*) FROM watchlist;"

NON_INNODB=$(run "$TARGET" -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TARGET' AND table_type='BASE TABLE' AND engine <> 'InnoDB';")
if [ "$NON_INNODB" != "0" ]; then
  echo "FAIL: $NON_INNODB table(s) are not InnoDB" >&2
  exit 1
fi

echo "reset complete: $TARGET (all tables InnoDB)"
