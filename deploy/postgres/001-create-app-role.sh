#!/bin/sh
set -eu

app_password=$(cat /run/secrets/postgres_app_password)
worker_password=$(cat /run/secrets/postgres_worker_password)
export app_password worker_password
psql --set=ON_ERROR_STOP=1 --set=app_password="$app_password" --set=worker_password="$worker_password" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOSQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metricops_app') THEN
    CREATE ROLE metricops_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
SELECT format('ALTER ROLE metricops_app PASSWORD %L', :'app_password') \gexec
ALTER ROLE metricops_app SET statement_timeout = '15s';
ALTER ROLE metricops_app SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE metricops_app SET lock_timeout = '5s';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metricops_worker') THEN
    CREATE ROLE metricops_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
SELECT format('ALTER ROLE metricops_worker PASSWORD %L', :'worker_password') \gexec
ALTER ROLE metricops_worker SET statement_timeout = '30s';
ALTER ROLE metricops_worker SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE metricops_worker SET lock_timeout = '5s';
EOSQL
unset app_password worker_password
