#!/bin/bash
# Team Capacity Planner - Local Development Quick Start
# This script activates the virtual environment and starts the development server

echo ""
echo "===================================="
echo "Team Capacity Planner - Local Setup"
echo "===================================="
echo ""

# Check if venv exists
if [ ! -f "venv/bin/activate" ]; then
    echo "Error: Virtual environment not found!"
    echo "Please run: python -m venv venv"
    exit 1
fi

# Activate virtual environment
source venv/bin/activate

# Run migrations
echo ""
echo "Running migrations..."
python manage.py migrate

# Check if superuser/data exists
python manage.py shell -c "from django.contrib.auth.models import User; from capacity.models import Employee; print('Database ready' if User.objects.filter(username='admin').exists() else 'Need data')" > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo ""
    echo "Loading initial test data..."
    python manage.py load_initial_data
fi

# Start development server
echo ""
echo "===================================="
echo "Development server starting..."
echo "===================================="
echo ""
echo "API available at: http://localhost:8000/api/"
echo "Admin panel at:   http://localhost:8000/admin/"
echo ""
echo "Default credentials: admin / admin"
echo ""
echo "For testing guide, see: LOCAL_TESTING.md"
echo "Press Ctrl+C to stop the server"
echo ""

python manage.py runserver
