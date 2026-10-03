#!/usr/bin/env bash
# Runs the backend test suite against a freshly reset netsentinel_test
# database, so results don't depend on whatever state a previous run or
# a manually-started dev server left behind.
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/reset-db.sh test

cd backend
source .venv/bin/activate
pytest tests/ -v
