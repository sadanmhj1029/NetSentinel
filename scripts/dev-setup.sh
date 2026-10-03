#!/usr/bin/env bash
# One-time local dev setup WITHOUT Docker: a Python venv for the backend,
# node_modules for the frontend, and local Postgres databases (regular +
# test). Useful on a machine/sandbox where Docker Hub isn't reachable, or
# if you just prefer running things natively. For the normal path, use
# `docker compose up --build` instead -- see docs/DEPLOYMENT.md.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Backend: creating venv and installing requirements"
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip >/dev/null
pip install -r requirements.txt
deactivate
cd ..

echo "==> Frontend: npm install"
cd frontend
npm install
[ -f .env ] || cp .env.example .env
cd ..

echo "==> Postgres: checking for a local server"
if ! command -v psql >/dev/null 2>&1; then
  echo "    psql not found. Install Postgres locally (e.g. 'sudo apt-get install postgresql') and re-run this script,"
  echo "    or run everything via 'docker compose up --build' instead."
  exit 1
fi

echo "==> Postgres: creating netsentinel role + databases (idempotent)"
sudo -u postgres psql -v ON_ERROR_STOP=0 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'netsentinel') THEN
    CREATE ROLE netsentinel LOGIN PASSWORD 'netsentinel';
  END IF;
END
$$;
SQL
sudo -u postgres createdb -O netsentinel netsentinel 2>/dev/null || true
sudo -u postgres createdb -O netsentinel netsentinel_test 2>/dev/null || true

echo "==> Done."
echo "    Start the backend:  cd backend && source .venv/bin/activate && uvicorn app.main:app --reload"
echo "    Start the frontend: cd frontend && npm run dev"
echo "    Run the test suite: ./scripts/run-tests.sh"
