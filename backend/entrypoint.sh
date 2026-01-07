#!/bin/bash
set -e

echo "Running migrations..."
python manage.py migrate

echo "Loading initial data..."
python manage.py load_initial_data

echo "Collecting static files..."
python manage.py collectstatic --noinput

echo "Starting Gunicorn..."
gunicorn config.wsgi:application
