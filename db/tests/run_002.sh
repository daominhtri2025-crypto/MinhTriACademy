#!/usr/bin/env bash
# Chạy: sudo -u postgres db/tests/run_002.sh   (cần PostgreSQL >= 15 đang chạy cục bộ)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; DB=mta_mig_test
psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
psql -q -v ON_ERROR_STOP=1 -d $DB -f "$HERE/../schema.sql"
psql -q -v ON_ERROR_STOP=1 -d $DB -f "$HERE/002_legacy_fixture.sql"
psql -q -v ON_ERROR_STOP=1 -d $DB -f "$HERE/../migrations/002_policy_alignment.sql"
psql -q -v ON_ERROR_STOP=1 -d $DB -f "$HERE/002_policy_test.sql"
psql -q -d postgres -c "DROP DATABASE $DB"
