#!/bin/bash
set -e

echo "Running migrations..."
python manage.py migrate

echo "Starting Gunicorn on port ${PORT:-8000}..."
gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 2 --threads 2
