#!/usr/bin/env bash
set -euo pipefail

# Allow deploys to tolerate transient DB startup/network delays on Railway.
MAX_ATTEMPTS="${DB_MIGRATE_MAX_ATTEMPTS:-12}"
SLEEP_SECONDS="${DB_MIGRATE_RETRY_SECONDS:-5}"

attempt=1
until python manage.py migrate --noinput; do
  if [ "${attempt}" -ge "${MAX_ATTEMPTS}" ]; then
    echo "Migrations failed after ${attempt} attempts. Exiting."
    exit 1
  fi

  echo "Migration attempt ${attempt}/${MAX_ATTEMPTS} failed. Retrying in ${SLEEP_SECONDS}s..."
  attempt=$((attempt + 1))
  sleep "${SLEEP_SECONDS}"
done

echo "Starting Gunicorn on port ${PORT:-8000}..."
exec gunicorn config.wsgi:application --bind "0.0.0.0:${PORT:-8000}"
