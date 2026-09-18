# Team Capacity Planner - Backend API Documentation

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Getting Started](#getting-started)
4. [Environment Variables](#environment-variables)
5. [Database Models](#database-models)
6. [Authentication](#authentication)
7. [API Endpoints](#api-endpoints)
8. [Rate Limiting](#rate-limiting)
9. [CORS Configuration](#cors-configuration)
10. [Deployment](#deployment)
11. [Troubleshooting](#troubleshooting)
12. [Error Codes](#error-codes)

---

## Overview

The Team Capacity Planner Backend API is a Django REST Framework-based service designed to manage team capacity planning, project assignments, and resource utilization across multiple departments and facilities.

### Key Features

- **Employee Management**: Track team members across departments with capacity planning
- **Project Management**: Manage projects with budget tracking and timeline planning
- **Assignment Tracking**: Allocate employee hours to projects by week
- **Capacity Analysis**: Monitor team utilization and identify over/under-allocation
- **Department Stage Configuration**: Configure project stages by department
- **Budget Management**: Track project budgets and utilization percentages
- **Activity Logging**: Comprehensive audit trail of all changes
- **Role-Based Access Control**: JWT-based authentication with permissions

### Departments Supported

- **PM** - Project Manager
- **MED** - Mechanical Design
- **HD** - Hardware Design
- **MFG** - Manufacturing
- **BUILD** - Assembly
- **PRG** - Programming PLC

### Facilities

- **AL** - Facility A
- **MI** - Facility B
- **MX** - Facility C

---

## Technology Stack

### Backend Framework
- **Django** 4.2.11 - Web framework
- **Django REST Framework** 3.14.0 - REST API toolkit
- **PostgreSQL** - Primary database (SQLite for development)

### Authentication & Security
- **djangorestframework-simplejwt** 5.5.1 - JWT token authentication
- **django-cors-headers** 4.3.1 - CORS support
- **whitenoise** 6.6.0 - Static file serving

### Utilities
- **gunicorn** 22.0.0 - WSGI application server
- **psycopg2-binary** 2.9.11 - PostgreSQL adapter
- **python-decouple** 3.8 - Environment variable management
- **django-filter** 24.1 - Advanced filtering

---

## Getting Started

### Prerequisites

- Python 3.9+
- PostgreSQL 12+ (or SQLite for development)
- pip package manager

### Local Development Setup

1. **Clone and Navigate to Backend**
   ```bash
   cd Capacity/backend
   ```

2. **Create Virtual Environment**
   ```bash
   python -m venv venv

   # On Windows
   venv\Scripts\activate

   # On macOS/Linux
   source venv/bin/activate
   ```

3. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure Environment Variables**
   ```bash
   # Copy the example file
   cp .env.example .env

   # Edit .env with your configuration
   # For development, you can use default values
   ```

5. **Database Setup**
   ```bash
   # Apply migrations
   python manage.py migrate

   # Create superuser for admin access
   python manage.py createsuperuser
   ```

6. **Load Initial Data (Optional)**
   ```bash
   # Create initial data if needed
   python manage.py shell
   ```

7. **Run Development Server**
   ```bash
   python manage.py runserver
   ```

   The API will be available at `http://localhost:8000/api/`

### Verify Installation

Test the API health:
```bash
curl http://localhost:8000/api/
```

---

## Environment Variables

Create a `.env` file in the backend directory with the following variables:

### Django Configuration

```env
# DEBUG mode (False in production)
DEBUG=False

# Secret key for Django (change in production!)
SECRET_KEY=your-super-secret-key-here-change-this-in-production

# Allowed hosts for the API
ALLOWED_HOSTS=localhost,127.0.0.1,your-railway-domain.railway.app
```

### Database Configuration

```env
# Database type (postgresql recommended for production)
DB_ENGINE=django.db.backends.postgresql

# Database credentials
DB_NAME=capacity_planner
DB_USER=postgres
DB_PASSWORD=your-db-password
DB_HOST=localhost
DB_PORT=5432
```

### CORS Configuration

```env
# Comma-separated list of allowed origins
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000,https://your-frontend-domain.com
```

### JWT Configuration

```env
# Token lifetimes (in seconds)
JWT_ACCESS_TOKEN_LIFETIME=86400    # 24 hours
JWT_REFRESH_TOKEN_LIFETIME=604800  # 7 days
```

### Optional: Email Configuration

```env
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=your-email@gmail.com
EMAIL_HOST_PASSWORD=your-app-password
```

### Optional: AWS S3 Configuration

```env
USE_S3=False
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_STORAGE_BUCKET_NAME=your-bucket
```

---

## Database Models

### Employee

Represents a team member with capacity and department information.

```
Field                      Type           Description
─────────────────────────────────────────────────────────
id                        UUID           Primary key (auto-generated)
user                      ForeignKey     Related Django User (optional)
name                      CharField      Employee name
role                      CharField      Job role/title
department                CharField      Department (PM, MED, HD, MFG, BUILD, PRG)
capacity                  FloatField     Available hours per week (0-168)
is_active                 BooleanField   Active status (default: True)
is_subcontracted_material BooleanField   Whether subcontracted (default: False)
subcontract_company       CharField      Company name if subcontracted
created_at                DateTimeField  Creation timestamp
updated_at                DateTimeField  Last update timestamp
```

### Project

Represents a project with dates, facility, and budget information.

```
Field               Type           Description
────────────────────────────────────────────────────
id                  UUID           Primary key
name                CharField      Project name
client              CharField      Client name
start_date          DateField      Project start date
end_date            DateField      Project end date
facility            CharField      Facility location (AL, MI, MX)
number_of_weeks     IntegerField   Project duration in weeks
project_manager     ForeignKey     Assigned project manager (Employee)
created_at          DateTimeField  Creation timestamp
updated_at          DateTimeField  Last update timestamp
```

### Assignment

Tracks hours allocated to a project-employee combination for a specific week.

```
Field              Type           Description
──────────────────────────────────────────────────────
id                 UUID           Primary key
employee           ForeignKey     Assigned employee
project            ForeignKey     Assigned project
week_start_date    DateField      Monday of the week (ISO format)
hours              FloatField     Total hours allocated (0-168)
scio_hours         FloatField     Internal SCIO hours (BUILD/PRG only)
external_hours     FloatField     External/subcontracted hours
stage              CharField      Work stage (CONCEPT, DESIGN, etc)
comment            TextField      Optional notes
created_at         DateTimeField  Creation timestamp
updated_at         DateTimeField  Last update timestamp
```

### DepartmentStageConfig

Configures project stages and timelines by department.

```
Field                  Type           Description
──────────────────────────────────────────────────────
id                     UUID           Primary key
project                ForeignKey     Associated project
department             CharField      Department code
stage                  CharField      Stage name
week_start             IntegerField   1-based week number start
week_end               IntegerField   1-based week number end
department_start_date  DateField      Actual start date for department
duration_weeks         IntegerField   Duration calculated from weeks
created_at             DateTimeField  Creation timestamp
updated_at             DateTimeField  Last update timestamp
```

### ProjectBudget

Tracks budget allocation and utilization by project and department.

```
Field              Type           Description
──────────────────────────────────────────────────────
id                 UUID           Primary key
project            OneToOneField  Associated project
department         CharField      Department code
hours_allocated    FloatField     Budgeted hours
hours_utilized     FloatField     Hours actually used
hours_forecast     FloatField     Forecasted hours
created_at         DateTimeField  Creation timestamp
updated_at         DateTimeField  Last update timestamp
```

### ActivityLog

Audit trail for all data changes.

```
Field       Type           Description
────────────────────────────────────────────
id          UUID           Primary key
user        ForeignKey     User who made change
action      CharField      Action type (created, updated, deleted, viewed)
model_name  CharField      Model affected
object_id   CharField      UUID of affected object
changes     JSONField      JSON of changes made
created_at  DateTimeField  Timestamp of change
```

---

## Authentication

The API uses **JWT (JSON Web Tokens)** for stateless authentication.

### Getting an Access Token

**Endpoint**: `POST /api/token/`

**Request Body**:
```json
{
  "username": "your_username",
  "password": "your_password"
}
```

**Response**:
```json
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
}
```

**cURL Example**:
```bash
# Replace with your actual credentials
curl -X POST http://localhost:8000/api/token/ \
  -H "Content-Type: application/json" \
  -d '{
    "username": "YOUR_USERNAME",
    "password": "YOUR_PASSWORD"
  }'
```

### Using the Access Token

Include the token in the `Authorization` header:

```
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...
```

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  http://localhost:8000/api/employees/
```

### Refreshing the Token

**Endpoint**: `POST /api/token/refresh/`

**Request Body**:
```json
{
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
}
```

**Response**:
```json
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
}
```

**cURL Example**:
```bash
curl -X POST http://localhost:8000/api/token/refresh/ \
  -H "Content-Type: application/json" \
  -d '{
    "refresh": "YOUR_REFRESH_TOKEN"
  }'
```

### Token Configuration

- **Access Token Lifetime**: 24 hours
- **Refresh Token Lifetime**: 7 days
- **Token Rotation**: Enabled (refresh tokens rotate on use)
- **Blacklist After Rotation**: Enabled

### Session Management

**Key Features**:
- **Maximum Sessions**: 2 active sessions per user (limits device connections)
- **Inactivity Timeout**: 30 minutes (auto-logout both frontend and backend)
- **Device Tracking**: Stores User-Agent and IP address
- **Activity Monitoring**: Updates on every API request

**Session Endpoints**:

#### Check Session Status
**Endpoint**: `GET /api/session-status/`

Verify if the current session is still active.

**Request**:
```
GET /api/session-status/
Authorization: Bearer YOUR_ACCESS_TOKEN
```

**Response (Active)**:
```json
{
  "status": "active",
  "user_id": 123,
  "username": "user@example.com"
}
```

**Response (Inactive)**:
```
Status: 401 Unauthorized
{
  "detail": "Session is inactive"
}
```

#### Logout (Deactivate Session)
**Endpoint**: `POST /api/logout/`

Manually deactivate the current session.

**Request**:
```
POST /api/logout/
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json

{
  "refresh": "YOUR_REFRESH_TOKEN"
}
```

**Response**:
```json
{
  "detail": "Successfully logged out"
}
```

#### Change Password
**Endpoint**: `POST /api/change-password/`

Change user password and invalidate all active sessions (forces re-login on all devices).

**Request**:
```
POST /api/change-password/
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json

{
  "current_password": "old_password",
  "new_password": "new_password",
  "confirm_password": "new_password"
}
```

**Response**:
```json
{
  "detail": "Password changed successfully. All sessions have been invalidated."
}
```

**Error Response (Wrong Current Password)**:
```json
{
  "current_password": ["Current password is incorrect"]
}
```

---

## API Endpoints

All endpoints require authentication via JWT token unless specified otherwise.

### Base URL
```
http://localhost:8000/api/
```

### Response Format

All responses are in JSON format:

**Success Response**:
```json
{
  "id": "uuid-here",
  "name": "John Doe",
  ...
}
```

**Paginated Response**:
```json
{
  "count": 100,
  "next": "http://localhost:8000/api/employees/?page=2",
  "previous": null,
  "results": [...]
}
```

**Error Response**:
```json
{
  "detail": "Not found.",
  "error_code": "NOT_FOUND"
}
```

---

### EMPLOYEES

#### List All Employees

**Request**:
```
GET /api/employees/
```

**Query Parameters**:
- `page` (integer) - Page number (default: 1)
- `page_size` (integer) - Items per page (default: 50, max: 1000)
- `search` (string) - Search by name, role, or department
- `department` (string) - Filter by department code (PM, MED, HD, MFG, BUILD, PRG)
- `is_active` (boolean) - Filter by active status (true/false)
- `is_subcontracted_material` (boolean) - Filter by subcontracted status
- `ordering` (string) - Order by field (-name, capacity, department, etc)

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8000/api/employees/?department=MED&is_active=true&ordering=-capacity"
```

**Response**:
```json
{
  "count": 25,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "user": null,
      "name": "John Doe",
      "role": "Senior Mechanical Engineer",
      "department": "MED",
      "department_display": "Mechanical Design",
      "capacity": 40.0,
      "is_active": true,
      "is_subcontracted": false,
      "is_subcontracted_material": false,
      "subcontract_company": null,
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

#### Create New Employee

**Request**:
```
POST /api/employees/
```

**Required Fields**:
- `name` (string) - Employee name
- `role` (string) - Job role
- `department` (string) - Department code
- `capacity` (float) - Hours per week (0-168)

**Optional Fields**:
- `is_active` (boolean) - Default: true
- `user_id` (integer) - Django User ID
- `is_subcontracted_material` (boolean) - Default: false
- `subcontract_company` (string) - Required if subcontracted

**Request Body**:
```json
{
  "name": "Jane Smith",
  "role": "Hardware Designer",
  "department": "HD",
  "capacity": 40.0,
  "is_active": true,
  "is_subcontracted_material": false
}
```

**cURL Example**:
```bash
curl -X POST http://localhost:8000/api/employees/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "role": "Hardware Designer",
    "department": "HD",
    "capacity": 40.0,
    "is_active": true
  }'
```

**Response** (201 Created):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "user": null,
  "name": "Jane Smith",
  "role": "Hardware Designer",
  "department": "HD",
  "department_display": "Hardware Design",
  "capacity": 40.0,
  "is_active": true,
  "is_subcontracted": false,
  "is_subcontracted_material": false,
  "subcontract_company": null,
  "created_at": "2024-01-20T14:22:00Z",
  "updated_at": "2024-01-20T14:22:00Z"
}
```

#### Get Employee Details

**Request**:
```
GET /api/employees/{id}/
```

**Parameters**:
- `id` (UUID) - Employee ID

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/employees/550e8400-e29b-41d4-a716-446655440000/
```

**Response**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user": null,
  "name": "John Doe",
  "role": "Senior Mechanical Engineer",
  "department": "MED",
  "department_display": "Mechanical Design",
  "capacity": 40.0,
  "is_active": true,
  "is_subcontracted": false,
  "is_subcontracted_material": false,
  "subcontract_company": null,
  "assignments": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440100",
      "employee": "550e8400-e29b-41d4-a716-446655440000",
      "project": {
        "id": "550e8400-e29b-41d4-a716-446655440200",
        "name": "Project Alpha",
        "client": "ACME Corp",
        ...
      },
      "week_start_date": "2024-01-15",
      "hours": 20.0,
      "stage": "DETAIL_DESIGN",
      "stage_display": "Detail Design",
      ...
    }
  ],
  "managed_projects": [],
  "total_capacity": 40.0,
  "total_allocated": 20.0,
  "utilization": 50.0,
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

#### Update Employee

**Request**:
```
PUT /api/employees/{id}/
PATCH /api/employees/{id}/
```

**cURL Example**:
```bash
curl -X PATCH http://localhost:8000/api/employees/550e8400-e29b-41d4-a716-446655440000/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "capacity": 45.0
  }'
```

#### Delete Employee

**Request**:
```
DELETE /api/employees/{id}/
```

**cURL Example**:
```bash
curl -X DELETE http://localhost:8000/api/employees/550e8400-e29b-41d4-a716-446655440000/ \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Get Capacity Summary

**Request**:
```
GET /api/employees/{id}/capacity-summary/
```

**Description**: Returns current and next week allocation for the employee.

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/employees/550e8400-e29b-41d4-a716-446655440000/capacity-summary/
```

**Response**:
```json
{
  "employee_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "John Doe",
  "total_capacity": 40.0,
  "current_week_allocation": 20.0,
  "next_week_allocation": 15.0,
  "utilization_percent": 50.0,
  "available_capacity": 20.0
}
```

#### Get Workload (8 weeks)

**Request**:
```
GET /api/employees/{id}/workload/
```

**Description**: Returns detailed workload for next 8 weeks including project breakdown.

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/employees/550e8400-e29b-41d4-a716-446655440000/workload/
```

**Response**:
```json
{
  "employee_id": "550e8400-e29b-41d4-a716-446655440000",
  "employee_name": "John Doe",
  "capacity": 40.0,
  "workload": [
    {
      "week_start": "2024-01-15",
      "week_end": "2024-01-21",
      "total_hours": 20.0,
      "utilization_percent": 50.0,
      "assignment_count": 1,
      "projects": [
        {
          "project_id": "550e8400-e29b-41d4-a716-446655440200",
          "project_name": "Project Alpha",
          "hours": 20.0,
          "stage": "DETAIL_DESIGN"
        }
      ]
    },
    {
      "week_start": "2024-01-22",
      "week_end": "2024-01-28",
      "total_hours": 15.0,
      "utilization_percent": 37.5,
      "assignment_count": 1,
      "projects": [...]
    }
  ]
}
```

#### Filter by Department

**Request**:
```
GET /api/employees/by-department/?department=MED
```

**Query Parameters**:
- `department` (string) - Required. Department code

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8000/api/employees/by-department/?department=MED"
```

**Response**:
```json
{
  "department": "MED",
  "department_name": "Mechanical Design",
  "employee_count": 5,
  "employees": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "John Doe",
      "role": "Senior Mechanical Engineer",
      "capacity": 40.0,
      "current_week_hours": 20.0,
      "utilization_percent": 50.0,
      "available": 20.0
    }
  ]
}
```

---

### PROJECTS

#### List All Projects

**Request**:
```
GET /api/projects/
```

**Query Parameters**:
- `page` (integer) - Page number
- `page_size` (integer) - Items per page
- `search` (string) - Search by name or client
- `facility` (string) - Filter by facility (AL, MI, MX)
- `start_date` (date) - Filter by start date (YYYY-MM-DD)
- `end_date` (date) - Filter by end date (YYYY-MM-DD)
- `ordering` (string) - Order by field

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8000/api/projects/?facility=AL&ordering=-start_date"
```

**Response**:
```json
{
  "count": 10,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440200",
      "name": "Project Alpha",
      "client": "ACME Corp",
      "start_date": "2024-01-15",
      "end_date": "2024-03-30",
      "facility": "AL",
      "facility_display": "Facility A",
      "number_of_weeks": 11,
      "project_manager": {...},
      "assignment_count": 25,
      "active_assignments": 8,
      "created_at": "2024-01-10T08:00:00Z",
      "updated_at": "2024-01-15T14:30:00Z"
    }
  ]
}
```

#### Create New Project

**Request**:
```
POST /api/projects/
```

**Required Fields**:
- `name` (string) - Project name
- `client` (string) - Client name
- `start_date` (date) - Start date (YYYY-MM-DD)
- `end_date` (date) - End date (YYYY-MM-DD)
- `facility` (string) - Facility code (AL, MI, MX)
- `number_of_weeks` (integer) - Duration in weeks

**Optional Fields**:
- `project_manager_id` (UUID) - Employee UUID of project manager

**cURL Example**:
```bash
curl -X POST http://localhost:8000/api/projects/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Project Beta",
    "client": "XYZ Manufacturing",
    "start_date": "2024-02-01",
    "end_date": "2024-04-30",
    "facility": "MI",
    "number_of_weeks": 13,
    "project_manager_id": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

#### Get Project Details

**Request**:
```
GET /api/projects/{id}/
```

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/projects/550e8400-e29b-41d4-a716-446655440200/
```

**Response**: Includes assignments, budget, and department stages.

#### Get Project Statistics

**Request**:
```
GET /api/projects/{id}/statistics/
```

**Description**: Comprehensive statistics including total hours, assignments by department, and weekly breakdown.

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/projects/550e8400-e29b-41d4-a716-446655440200/statistics/
```

**Response**:
```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440200",
  "project_name": "Project Alpha",
  "total_assignments": 25,
  "total_allocated_hours": 480.5,
  "average_hours_per_assignment": 19.22,
  "by_department": {
    "MED": {
      "count": 8,
      "total_hours": 160.0,
      "employee_count": 3
    },
    "HD": {
      "count": 5,
      "total_hours": 100.0,
      "employee_count": 2
    }
  },
  "by_week": [
    ["2024-01-15", {"hours": 40.0, "assignments": 2}],
    ["2024-01-22", {"hours": 45.0, "assignments": 3}]
  ]
}
```

#### Get Budget Report

**Request**:
```
GET /api/projects/{id}/budget-report/
```

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/projects/550e8400-e29b-41d4-a716-446655440200/budget-report/
```

#### Get Timeline

**Request**:
```
GET /api/projects/{id}/timeline/
```

**Description**: Returns project timeline with department-specific stages.

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/projects/550e8400-e29b-41d4-a716-446655440200/timeline/
```

**Response**:
```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440200",
  "project_name": "Project Alpha",
  "start_date": "2024-01-15",
  "end_date": "2024-03-30",
  "total_weeks": 11,
  "duration_days": 75,
  "timeline": [
    {
      "department": "Mechanical Design",
      "stage": "Concept",
      "week_start": 3,
      "week_end": 5,
      "duration_weeks": 3,
      "start_date": "2024-01-15"
    }
  ]
}
```

#### Filter by Facility

**Request**:
```
GET /api/projects/by-facility/?facility=AL
```

**Query Parameters**:
- `facility` (string) - Required. Facility code

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8000/api/projects/by-facility/?facility=AL"
```

---

### ASSIGNMENTS

#### List All Assignments

**Request**:
```
GET /api/assignments/
```

**Query Parameters**:
- `page` (integer) - Page number
- `page_size` (integer) - Items per page (default: 100)
- `employee` (UUID) - Filter by employee ID
- `project` (UUID) - Filter by project ID
- `week_start_date` (date) - Filter by week date
- `stage` (string) - Filter by work stage
- `start_date` (date) - Filter assignments from date
- `end_date` (date) - Filter assignments to date
- `ordering` (string) - Order by field

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8000/api/assignments/?employee=550e8400-e29b-41d4-a716-446655440000&ordering=-week_start_date"
```

#### Create New Assignment

**Request**:
```
POST /api/assignments/
```

**Required Fields**:
- `employee_id` (UUID) - Employee UUID
- `project_id` (UUID) - Project UUID
- `week_start_date` (date) - Monday of the week (YYYY-MM-DD)
- `hours` (float) - Total hours (0-168)

**Optional Fields**:
- `scio_hours` (float) - Internal hours
- `external_hours` (float) - External/subcontracted hours
- `stage` (string) - Work stage
- `comment` (string) - Notes

**Request Body**:
```json
{
  "employee_id": "550e8400-e29b-41d4-a716-446655440000",
  "project_id": "550e8400-e29b-41d4-a716-446655440200",
  "week_start_date": "2024-01-15",
  "hours": 20.0,
  "stage": "DETAIL_DESIGN",
  "scio_hours": 15.0,
  "external_hours": 5.0,
  "comment": "Working on mechanical drawings"
}
```

**cURL Example**:
```bash
curl -X POST http://localhost:8000/api/assignments/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "employee_id": "550e8400-e29b-41d4-a716-446655440000",
    "project_id": "550e8400-e29b-41d4-a716-446655440200",
    "week_start_date": "2024-01-15",
    "hours": 20.0,
    "stage": "DETAIL_DESIGN"
  }'
```

**Response** (201 Created):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440300",
  "employee": {...},
  "project": {...},
  "week_start_date": "2024-01-15",
  "week_number": 3,
  "hours": 20.0,
  "scio_hours": 15.0,
  "external_hours": 5.0,
  "total_hours": 20.0,
  "stage": "DETAIL_DESIGN",
  "stage_display": "Detail Design",
  "comment": "Working on mechanical drawings",
  "employee_capacity": 40.0,
  "created_at": "2024-01-20T10:00:00Z",
  "updated_at": "2024-01-20T10:00:00Z"
}
```

#### Get Assignments by Week

**Request**:
```
GET /api/assignments/by-week/
```

**Query Parameters**:
- `start_date` (date) - Start week
- `end_date` (date) - End week
- `project_id` (UUID) - Filter by project

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8000/api/assignments/by-week/?start_date=2024-01-01&end_date=2024-01-31"
```

**Response**:
```json
{
  "week_count": 5,
  "total_hours": 1245.5,
  "weeks": [
    {
      "week_start": "2024-01-15",
      "week_end": "2024-01-21",
      "total_hours": 245.5,
      "assignment_count": 12,
      "by_employee": {
        "550e8400-e29b-41d4-a716-446655440000": {
          "name": "John Doe",
          "hours": 20.0,
          "capacity": 40.0,
          "utilization_percent": 50.0
        }
      },
      "by_project": {...},
      "by_department": {
        "MED": 100.0,
        "HD": 80.5
      }
    }
  ]
}
```

#### Get Capacity by Department

**Request**:
```
GET /api/assignments/capacity-by-dept/
```

**Query Parameters**:
- `week_start_date` (date) - Filter by specific week (optional)

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8000/api/assignments/capacity-by-dept/"
```

**Response**:
```json
{
  "period": "all_time",
  "timestamp": "2024-01-20T15:30:00Z",
  "departments": [
    {
      "department": "MED",
      "department_name": "Mechanical Design",
      "total_capacity": 200.0,
      "total_allocated": 120.0,
      "available_capacity": 80.0,
      "utilization_percent": 60.0,
      "employee_count": 5,
      "status": "normal"
    },
    {
      "department": "HD",
      "department_name": "Hardware Design",
      "total_capacity": 120.0,
      "total_allocated": 105.0,
      "available_capacity": 15.0,
      "utilization_percent": 87.5,
      "employee_count": 3,
      "status": "high"
    }
  ]
}
```

#### Get Utilization Report

**Request**:
```
GET /api/assignments/utilization-report/
```

**Query Parameters**:
- `start_date` (date) - Report start date
- `end_date` (date) - Report end date

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8000/api/assignments/utilization-report/?start_date=2024-01-01&end_date=2024-01-31"
```

**Response**:
```json
{
  "period_start": "2024-01-15",
  "period_end": "2024-01-21",
  "total_employees": 8,
  "underutilized_count": 2,
  "overallocated_count": 1,
  "summary": [
    {
      "employee_id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "John Doe",
      "department": "Mechanical Design",
      "capacity": 40.0,
      "allocated": 35.0,
      "utilization_percent": 87.5,
      "assignment_count": 2
    }
  ],
  "underutilized": [...],
  "overallocated": [...]
}
```

---

### DEPARTMENT STAGES

#### List Department Stage Configurations

**Request**:
```
GET /api/department-stages/
```

**Query Parameters**:
- `project` (UUID) - Filter by project
- `department` (string) - Filter by department
- `ordering` (string) - Order by field

#### Create Department Stage Configuration

**Request**:
```
POST /api/department-stages/
```

**Required Fields**:
- `project_id` (UUID) - Project UUID
- `department` (string) - Department code
- `week_start` (integer) - Start week number (1-53)
- `week_end` (integer) - End week number (1-53)

**Optional Fields**:
- `stage` (string) - Stage name
- `department_start_date` (date) - Actual start date

**cURL Example**:
```bash
curl -X POST http://localhost:8000/api/department-stages/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "550e8400-e29b-41d4-a716-446655440200",
    "department": "MED",
    "stage": "CONCEPT",
    "week_start": 3,
    "week_end": 5,
    "department_start_date": "2024-01-15"
  }'
```

---

### PROJECT BUDGETS

#### List Project Budgets

**Request**:
```
GET /api/project-budgets/
```

**Query Parameters**:
- `project` (UUID) - Filter by project
- `department` (string) - Filter by department

#### Create Project Budget

**Request**:
```
POST /api/project-budgets/
```

**Required Fields**:
- `project_id` (UUID) - Project UUID
- `department` (string) - Department code
- `hours_allocated` (float) - Budgeted hours

**Optional Fields**:
- `hours_utilized` (float) - Default: 0
- `hours_forecast` (float) - Default: 0

**cURL Example**:
```bash
curl -X POST http://localhost:8000/api/project-budgets/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "550e8400-e29b-41d4-a716-446655440200",
    "department": "MED",
    "hours_allocated": 300.0,
    "hours_utilized": 120.0,
    "hours_forecast": 50.0
  }'
```

**Response**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440400",
  "project": {...},
  "department": "MED",
  "department_display": "Mechanical Design",
  "hours_allocated": 300.0,
  "hours_utilized": 120.0,
  "hours_forecast": 50.0,
  "utilization_percent": 56.67,
  "available_hours": 130.0,
  "budget_status": "within",
  "created_at": "2024-01-20T10:00:00Z",
  "updated_at": "2024-01-20T10:00:00Z"
}
```

---

### ACTIVITY LOGS (Read-Only)

#### List Activity Logs

**Request**:
```
GET /api/activity-logs/
```

**Query Parameters**:
- `user` (integer) - Filter by user ID
- `model_name` (string) - Filter by model name
- `action` (string) - Filter by action (created, updated, deleted, viewed)
- `start_date` (date) - Filter from date
- `end_date` (date) - Filter to date
- `ordering` (string) - Order by field (default: -created_at)

**cURL Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8000/api/activity-logs/?model_name=Assignment&ordering=-created_at"
```

**Response**:
```json
{
  "count": 150,
  "next": "http://localhost:8000/api/activity-logs/?page=2",
  "previous": null,
  "results": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440500",
      "user": {
        "id": 1,
        "username": "admin",
        "first_name": "Admin",
        "last_name": "User",
        "email": "admin@example.com"
      },
      "action": "created",
      "model_name": "Assignment",
      "object_id": "550e8400-e29b-41d4-a716-446655440300",
      "changes": {
        "hours": 20.0,
        "week_start_date": "2024-01-15"
      },
      "created_at": "2024-01-20T10:00:00Z",
      "formatted_created_at": "2024-01-20T10:00:00+00:00"
    }
  ]
}
```

---

## Rate Limiting

The API implements rate limiting to protect against abuse:

### Limits

| User Type | Limit | Window |
|-----------|-------|--------|
| Anonymous Users | 100 requests | 1 hour |
| Authenticated Users | 1000 requests | 1 hour |

### Rate Limit Headers

Response headers include rate limit information:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 950
X-RateLimit-Reset: 1705776000
```

### Handling Rate Limit Errors

When rate limit is exceeded, the API returns a 429 (Too Many Requests) response:

```json
{
  "detail": "Request was throttled. Expected available in 1234 seconds."
}
```

**Best Practices**:
- Implement exponential backoff for retries
- Cache frequently accessed data
- Use pagination to reduce request volume
- Filter results server-side rather than fetching all data

---

## CORS Configuration

### Allowed Origins

The API allows requests from configured origins. Configure in `.env`:

```env
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000,https://your-frontend-domain.com
```

### Allowed Methods

- GET
- HEAD
- OPTIONS
- POST
- PUT
- PATCH
- DELETE

### Allowed Headers

- Authorization
- Content-Type
- Accept
- X-Requested-With
- Access-Control-Allow-Origin

### Credentials

Credentials (cookies, authorization headers) are allowed:

```
Access-Control-Allow-Credentials: true
```

### Preflight Requests

Browsers automatically send OPTIONS preflight requests. The API handles these automatically.

**Example Preflight**:
```bash
curl -X OPTIONS http://localhost:8000/api/employees/ \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST"
```

---

## Deployment

### Railway Deployment

The application is configured for deployment on Railway.

#### Prerequisites

- Railway account (https://railway.app)
- GitHub repository linked to Railway
- PostgreSQL database on Railway

#### Environment Setup

1. **Create Railway Project**
   - Connect your GitHub repository
   - Select Django template

2. **Configure Environment Variables**

   In Railway dashboard, set:
   ```
   DEBUG=False
   SECRET_KEY=your-production-secret-key
   ALLOWED_HOSTS=your-app.railway.app

   DB_ENGINE=django.db.backends.postgresql
   DB_NAME=capacity_planner
   DB_USER=postgres
   DB_PASSWORD=railway-generated-password
   DB_HOST=railway-postgres-host
   DB_PORT=5432

   CORS_ALLOWED_ORIGINS=https://your-frontend.railway.app,https://your-domain.com
   ```

3. **Database URL**

   Railway provides `DATABASE_URL`. Update `settings.py` if needed:
   ```python
   import dj_database_url
   DATABASES['default'] = dj_database_url.config(
       default='postgresql://...',
       conn_max_age=600
   )
   ```

4. **Run Migrations**

   Add to `Procfile`:
   ```
   release: python manage.py migrate
   web: gunicorn config.wsgi
   ```

5. **Deploy**
   - Push to main branch
   - Railway automatically deploys

#### Health Check

After deployment, verify:
```bash
curl https://your-app.railway.app/api/
```

#### Static Files

WhiteNoise handles static files automatically. No additional S3 configuration needed unless storing large files.

#### Monitoring

Railway provides logs and metrics in dashboard. Check for:
- Database connection errors
- Migration failures
- Token generation issues

---

## Troubleshooting

### Common Issues and Solutions

#### 401 Unauthorized

**Problem**: "Authentication credentials were not provided."

**Solutions**:
1. Verify token is included in header:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8000/api/employees/
   ```
2. Check token hasn't expired (24 hours)
3. Refresh token:
   ```bash
   curl -X POST http://localhost:8000/api/token/refresh/ \
     -H "Content-Type: application/json" \
     -d '{"refresh": "YOUR_REFRESH_TOKEN"}'
   ```

#### 403 Forbidden

**Problem**: "You do not have permission to perform this action."

**Solutions**:
1. Verify user is staff/admin for write operations
2. Check `is_staff` flag on user account
3. Only staff can create/update/delete resources

#### 404 Not Found

**Problem**: "Not found."

**Solutions**:
1. Verify resource ID is correct
2. Check resource exists in database
3. Ensure ID format is valid UUID

#### 400 Bad Request

**Problem**: "Invalid input."

**Solutions**:
1. Check request body format (must be valid JSON)
2. Verify all required fields are present
3. Ensure field values match expected types:
   - `capacity` should be float
   - `hours` should be float
   - Dates should be YYYY-MM-DD format
   - UUIDs should be valid format

#### Database Connection Errors

**Problem**: "could not connect to server: Connection refused"

**Solutions**:
1. Verify PostgreSQL is running
2. Check database credentials in `.env`
3. Verify database exists
4. Check network connectivity

**For local development**:
```bash
# Test PostgreSQL connection
psql -U postgres -d capacity_planner -h localhost
```

#### Migration Errors

**Problem**: "table already exists" or migration issues

**Solutions**:
```bash
# Check migration status
python manage.py showmigrations

# Rollback migrations (careful!)
python manage.py migrate capacity 0001

# Re-run migrations
python manage.py migrate
```

#### CORS Errors

**Problem**: "No 'Access-Control-Allow-Origin' header is present"

**Solutions**:
1. Verify frontend domain is in `CORS_ALLOWED_ORIGINS`
2. Check `.env` file is loaded
3. Restart development server
4. Clear browser cache

#### Token Expiration

**Problem**: "Token is invalid or expired"

**Solutions**:
1. Get new token via `/api/token/`
2. Use refresh token to get new access token
3. Implement token refresh in frontend

### Debug Mode

Enable debug for development:

```env
DEBUG=True
```

This shows detailed error messages and Django debug toolbar.

**Warning**: Never use `DEBUG=True` in production.

### Checking Service Health

```bash
# API health
curl http://localhost:8000/api/

# Admin panel (requires superuser)
curl http://localhost:8000/admin/

# Browsable API
# Open in browser: http://localhost:8000/api/
```

### Viewing Logs

**Development**:
```bash
# Logs print to console where Django runs
python manage.py runserver
```

**Production (Railway)**:
- View in Railway dashboard under "Deployments" > "Logs"

### Database Inspection

```bash
python manage.py dbshell

# List tables
\dt

# Inspect table structure
\d capacity_employee

# Sample queries
SELECT COUNT(*) FROM capacity_employee;
SELECT * FROM capacity_project LIMIT 5;
```

---

## Error Codes

### HTTP Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | OK | Successful GET request |
| 201 | Created | Successful POST request |
| 204 | No Content | Successful DELETE request |
| 400 | Bad Request | Invalid input data |
| 401 | Unauthorized | Missing/invalid token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Internal server error |

### API Error Response Format

```json
{
  "detail": "Error message",
  "error_code": "ERROR_CODE"
}
```

### Common Error Responses

**Authentication Error**:
```json
{
  "detail": "Authentication credentials were not provided.",
  "error_code": "NOT_AUTHENTICATED"
}
```

**Validation Error**:
```json
{
  "name": ["This field may not be blank."],
  "department": ["Invalid department. Must be one of: PM, MED, HD, MFG, BUILD, PRG"]
}
```

**Not Found Error**:
```json
{
  "detail": "Not found.",
  "error_code": "NOT_FOUND"
}
```

**Rate Limit Error**:
```json
{
  "detail": "Request was throttled. Expected available in 1234 seconds."
}
```

---

## Additional Resources

### API Testing

- **Postman**: Import API endpoints for testing
- **cURL**: Command-line testing (examples throughout this doc)
- **Insomnia**: REST client alternative
- **Thunder Client**: VS Code extension

### Django REST Framework Documentation

- https://www.django-rest-framework.org/
- https://www.django-rest-framework.org/api-guide/authentication/
- https://www.django-rest-framework.org/api-guide/permissions/

### Security Best Practices

1. Keep `SECRET_KEY` secure and unique per environment
2. Use HTTPS in production
3. Implement rate limiting (already configured)
4. Validate all input data (Django/DRF handles)
5. Use environment variables for sensitive data
6. Implement CSRF protection (enabled by default)
7. Regular security updates for dependencies

### Performance Tips

1. Use pagination for large result sets
2. Filter before ordering
3. Use `select_related()` for foreign keys
4. Use `prefetch_related()` for reverse relations
5. Cache frequently accessed data
6. Monitor query performance

### Monitoring and Logging

In production, implement:
- Request/response logging
- Error tracking (Sentry, etc.)
- Performance monitoring (New Relic, etc.)
- Database query logging
- API usage metrics

---

## Support and Contact

For issues or questions:
1. Check this documentation
2. Review error messages and HTTP status codes
3. Check Django/DRF logs
4. Consult Railway deployment docs
5. Contact development team

**Last Updated**: 2024-01-20
**API Version**: 1.0.0
**Django Version**: 4.2.11
**DRF Version**: 3.14.0
