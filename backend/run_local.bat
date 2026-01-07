@echo off
REM Team Capacity Planner - Local Development Quick Start
REM This script activates the virtual environment and starts the development server

echo.
echo ====================================
echo Team Capacity Planner - Local Setup
echo ====================================
echo.

REM Check if venv exists
if not exist "venv\Scripts\activate.bat" (
    echo Error: Virtual environment not found!
    echo Please run: python -m venv venv
    pause
    exit /b 1
)

REM Activate virtual environment
call venv\Scripts\activate.bat

REM Run migrations
echo.
echo Running migrations...
python manage.py migrate

REM Check if superuser/data exists
python manage.py shell -c "from django.contrib.auth.models import User; from capacity.models import Employee; print('Database ready' if User.objects.filter(username='admin').exists() else 'Need data')" > nul 2>&1

if errorlevel 1 (
    echo.
    echo Loading initial test data...
    python manage.py load_initial_data
)

REM Start development server
echo.
echo ====================================
echo Development server starting...
echo ====================================
echo.
echo API available at: http://localhost:8000/api/
echo Admin panel at:   http://localhost:8000/admin/
echo.
echo Default credentials: admin / admin
echo.
echo For testing guide, see: LOCAL_TESTING.md
echo Press Ctrl+C to stop the server
echo.

python manage.py runserver

pause
