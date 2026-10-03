#!/usr/bin/env bash
# Drops and recreates a local Postgres database from scratch. Use this
# when seed/schema state has drifted and you just want a clean slate.
#
#   ./scripts/reset-db.sh            # resets the dev database (netsentinel)
#   ./scripts/reset-db.sh test       # resets the test database (netsentinel_test)
set -euo pipefail

TARGET="${1:-dev}"
if [ "$TARGET" = "test" ]; then
  DB_NAME="netsentinel_test"
else
  DB_NAME="netsentinel"
fi

echo "==> Dropping and recreating $DB_NAME"
sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${DB_NAME};"
sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER netsentinel;"
echo "==> Done. Tables/seed data are created automatically the next time the backend starts."
