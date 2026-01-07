#!/bin/bash
set -e

echo "Running migrations..."
python manage.py migrate

echo "Loading initial data..."
python manage.py load_initial_data || echo "Initial data already loaded or error occurred"

echo "Starting Gunicorn..."
gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 4 --threads 2 --worker-class gthread
