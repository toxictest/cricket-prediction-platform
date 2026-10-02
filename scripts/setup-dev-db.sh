#!/usr/bin/env bash
# =============================================================================
#  setup-dev-db.sh — one-command local PostgreSQL bootstrap
# =============================================================================
#  Creates the role, the database and the shadow database, then applies
#  migrations and (optionally) seeds the demo network.
#
#  Idempotent: safe to run repeatedly. Re-running will not drop your data.
#
#  Usage:
#    ./scripts/setup-dev-db.sh              # create + migrate
#    ./scripts/setup-dev-db.sh --seed       # create + migrate + seed
#    ./scripts/setup-dev-db.sh --reset      # DROP everything and rebuild
#    ./scripts/setup-dev-db.sh --no-sudo    # already running as root/postgres
#
#  Environment overrides:
#    PG_SUPERUSER   default: postgres
#    DB_NAME        default: cricket_platform
#    DB_USER        default: cricket
#    DB_PASSWORD    default: cricket_dev_password
# =============================================================================

set -euo pipefail

# ---- config -----------------------------------------------------------------
DB_NAME="${DB_NAME:-cricket_platform}"
SHADOW_DB="${DB_NAME}_shadow"
DB_USER="${DB_USER:-cricket}"
DB_PASSWORD="${DB_PASSWORD:-cricket_dev_password}"
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"

SEED=0
RESET=0
USE_SUDO=1

for arg in "$@"; do
  case "$arg" in
    --seed)    SEED=1 ;;
    --reset)   RESET=1 ;;
    --no-sudo) USE_SUDO=0 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# ---- pretty output ----------------------------------------------------------
c_reset=$'\033[0m'; c_red=$'\033[38;5;203m'
c_grn=$'\033[38;5;114m'; c_dim=$'\033[38;5;245m'
step() { printf '%s▸%s %s\n' "$c_red" "$c_reset" "$1"; }
ok()   { printf '%s  ✓%s %s\n' "$c_grn" "$c_reset" "$1"; }
info() { printf '%s    %s%s\n' "$c_dim" "$1" "$c_reset"; }
die()  { printf '%s  ✗ %s%s\n' "$c_red" "$1" "$c_reset" >&2; exit 1; }

# ---- locate psql ------------------------------------------------------------
# Prefer PATH, then fall back to the versioned Debian/Ubuntu layout.
find_psql() {
  if command -v psql >/dev/null 2>&1; then
    command -v psql
    return
  fi
  local candidate
  candidate="$(ls -1d /usr/lib/postgresql/*/bin/psql 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$candidate" ] && { echo "$candidate"; return; }
  return 1
}

# ---- 0. is PostgreSQL installed? -------------------------------------------
step "Checking for PostgreSQL"

if ! find_psql >/dev/null 2>&1; then
  info "not found — attempting to install via apt"
  if [ "$USE_SUDO" -eq 1 ]; then
    sudo apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
  else
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
  fi
fi

PSQL="$(find_psql)" || die "psql could not be located. Install PostgreSQL and re-run."

ok "psql at $PSQL"
info "$("$PSQL" --version)"

# ---- 0b. dependencies -------------------------------------------------------
# `node_modules` is not committed, and workspace snapshots exclude it. Use the
# pinned LOCAL binaries for everything below — `npx prisma` would otherwise
# silently download whatever major version is current (Prisma 7 changed the
# datasource syntax and would reject this schema).
step "Checking Node dependencies"

if [ ! -x ./node_modules/.bin/prisma ]; then
  info "node_modules missing — running npm install"
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
fi

[ -x ./node_modules/.bin/prisma ] || die "prisma binary not found after install"
PRISMA=./node_modules/.bin/prisma
ok "using local Prisma $("$PRISMA" --version 2>/dev/null | head -1 | awk '{print $NF}')"
info "(never `npx prisma` — that can resolve to a different major version)"

# ---- 1. ensure the server is running ---------------------------------------
step "Ensuring the PostgreSQL server is accepting connections"

run_as_pg() {
  if [ "$USE_SUDO" -eq 1 ]; then
    sudo -u "$PG_SUPERUSER" "$@"
  else
    su -s /bin/bash "$PG_SUPERUSER" -c "$(printf '%q ' "$@")"
  fi
}

if ! "$PSQL" -h 127.0.0.1 -p 5432 -U "$PG_SUPERUSER" -c 'SELECT 1' >/dev/null 2>&1; then
  # Cluster may exist but be stopped (common after a container restart).
  if command -v pg_ctlcluster >/dev/null 2>&1; then
    PG_VER="$(ls -1 /usr/lib/postgresql 2>/dev/null | sort -V | tail -1 || true)"
    if [ -n "$PG_VER" ]; then
      info "starting cluster $PG_VER/main"
      if [ "$USE_SUDO" -eq 1 ]; then
        sudo pg_ctlcluster "$PG_VER" main start >/dev/null 2>&1 || true
      else
        pg_ctlcluster "$PG_VER" main start >/dev/null 2>&1 || true
      fi
    fi
  fi

  # Data directory may not have been initialised at all.
  if ! run_as_pg "$PSQL" -c 'SELECT 1' >/dev/null 2>&1; then
    info "no cluster found — initialising one"
    PG_VER="$(ls -1 /usr/lib/postgresql 2>/dev/null | sort -V | tail -1 || true)"
    [ -n "$PG_VER" ] || die "no PostgreSQL version directory found"

    if [ "$USE_SUDO" -eq 1 ]; then
      sudo mkdir -p /var/lib/postgresql/"$PG_VER"/main
      sudo chown -R "$PG_SUPERUSER":"$PG_SUPERUSER" /var/lib/postgresql/"$PG_VER" 2>/dev/null || true
      sudo -u "$PG_SUPERUSER" /usr/lib/postgresql/"$PG_VER"/bin/initdb \
        -D /var/lib/postgresql/"$PG_VER"/main >/dev/null
    fi

    run_as_pg "$PSQL" -c 'SELECT 1' >/dev/null 2>&1 || true
  fi

  sleep 2
fi

# pg_hba may still only trust the unix socket — set a password for TCP logins.
run_as_pg "$PSQL" -c "ALTER USER $PG_SUPERUSER WITH PASSWORD 'postgres';" >/dev/null 2>&1 || true

if ! "$PSQL" "postgresql://$PG_SUPERUSER:postgres@127.0.0.1:5432/postgres" -c 'SELECT 1' >/dev/null 2>&1; then
  die "cannot reach PostgreSQL over 127.0.0.1:5432 — check pg_hba.conf and that the cluster is up"
fi

ok "server up and accepting TCP connections on 127.0.0.1:5432"

# ---- 2. optional reset ------------------------------------------------------
SUPER_URL="postgresql://$PG_SUPERUSER:postgres@127.0.0.1:5432/postgres"

if [ "$RESET" -eq 1 ]; then
  step "Dropping existing databases (--reset)"
  "$PSQL" "$SUPER_URL" -c "DROP DATABASE IF EXISTS \"$DB_NAME\";"     >/dev/null
  "$PSQL" "$SUPER_URL" -c "DROP DATABASE IF EXISTS \"$SHADOW_DB\";"   >/dev/null
  ok "dropped $DB_NAME and $SHADOW_DB"
fi

# ---- 3. role ----------------------------------------------------------------
step "Creating role '$DB_USER'"

if [ "$("$PSQL" "$SUPER_URL" -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER';")" = "1" ]; then
  "$PSQL" "$SUPER_URL" -c "ALTER ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASSWORD' CREATEDB;" >/dev/null
  ok "role already existed — password refreshed"
else
  "$PSQL" "$SUPER_URL" -c "CREATE ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASSWORD' CREATEDB;" >/dev/null
  ok "role created with CREATEDB (needed for the Prisma shadow database)"
fi

# ---- 4. databases -----------------------------------------------------------
step "Creating databases"

for db in "$DB_NAME" "$SHADOW_DB"; do
  exists="$("$PSQL" "$SUPER_URL" -tAc "SELECT 1 FROM pg_database WHERE datname='$db';")"
  if [ "$exists" = "1" ]; then
    info "$db already exists"
  else
    "$PSQL" "$SUPER_URL" -c "CREATE DATABASE \"$db\" OWNER \"$DB_USER\";" >/dev/null
    info "created $db"
  fi
done
ok "databases ready"

# ---- 5. write .env if missing ----------------------------------------------
step "Checking .env"

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    # Point the fresh .env at the database we just created.
    sed -i.bak \
      -e "s|^DATABASE_URL=.*|DATABASE_URL=\"postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME?schema=public\"|" \
      -e "s|^SHADOW_DATABASE_URL=.*|SHADOW_DATABASE_URL=\"postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$SHADOW_DB?schema=public\"|" \
      .env
    rm -f .env.bak
    # A missing secret is a hard NextAuth failure — generate one.
    SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
    sed -i.bak "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=\"$SECRET\"|" .env
    rm -f .env.bak
    ok ".env created from .env.example with a generated NEXTAUTH_SECRET"
  else
    die ".env is missing and .env.example is unavailable"
  fi
else
  ok ".env already present — leaving it untouched"
fi

# ---- 6. migrate -------------------------------------------------------------
step "Applying Prisma migrations"

if [ -d prisma/migrations ] && [ -n "$(ls -A prisma/migrations 2>/dev/null | grep -v migration_lock.toml || true)" ]; then
  "$PRISMA" migrate deploy
  ok "migrations applied"
else
  info "no migrations directory — falling back to prisma db push"
  "$PRISMA" db push --skip-generate
  ok "schema synced"
fi

"$PRISMA" generate >/dev/null
ok "Prisma client generated"

# ---- 7. seed ----------------------------------------------------------------
if [ "$SEED" -eq 1 ]; then
  step "Seeding the demo member network"
  ./node_modules/.bin/tsx prisma/seed.ts
  ok "seed complete"
fi

# ---- done -------------------------------------------------------------------
printf '\n%s✔ development database ready%s\n' "$c_grn" "$c_reset"
printf '%s  DATABASE_URL=%s%s\n' "$c_dim" "postgresql://$DB_USER:***@127.0.0.1:5432/$DB_NAME" "$c_reset"
printf '%s  next: npm run dev%s\n\n' "$c_dim" "$c_reset"
