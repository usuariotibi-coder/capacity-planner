# Team Capacity Planner - Local Testing Guide

Complete guide for testing the backend API locally before deployment to Railway.

## 🚀 Quick Start - Run Locally

### 1. Setup Environment

```bash
# Navigate to backend directory
cd backend

# Activate virtual environment
# On Windows:
venv\Scripts\activate

# Install dependencies (if not already done)
pip install -r requirements.txt
```

### 2. Database Setup

```bash
# Run migrations
python manage.py migrate

# Load initial test data (9 employees, 3 projects, 11 assignments)
python manage.py load_initial_data

# Start development server
python manage.py runserver
```

The API will be available at: **http://localhost:8000/api/**

Admin panel: **http://localhost:8000/admin/** (username: admin, password: admin)

## 📋 Initial Test Data

The `load_initial_data` command creates:

### Employees (9 total)
| Name | Role | Department | Capacity |
|------|------|-----------|----------|
| John Smith | Senior PM | PM | 40 hrs/week |
| Maria Garcia | Mechanical Designer | MED | 40 hrs/week |
| Carlos Rodriguez | Hardware Engineer | HD | 40 hrs/week |
| Ana Martinez | Manufacturing Lead | MFG | 40 hrs/week |
| Luis Hernandez | Assembly Technician | BUILD | 40 hrs/week |
| Sofia Lopez | PLC Programmer | PRG | 40 hrs/week |
| Miguel Torres | Junior Programmer | PRG | 40 hrs/week |
| Laura Sanchez | Assembly Technician (Subcontracted - AMI) | BUILD | 40 hrs/week |
| Diego Flores | Quality Inspector | MFG | 40 hrs/week |

### Projects (3 total)
| Project | Client | Facility | Duration | Start Date |
|---------|--------|----------|----------|------------|
| Alpha System | Client A | AL | 8 weeks | Today |
| Beta Platform | Client B | MI | 12 weeks | +2 weeks from today |
| Gamma Module | Client C | MX | 8 weeks | +1 week from today |

### Assignments (11 total)
Distributed across projects and employees with various stages and hours.

## 🔑 Authentication Testing

### Get Access Token

```bash
curl -X POST http://localhost:8000/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin"}'
```

**Response:**
```json
{
  "access": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Use Token in Requests

```bash
# Replace <ACCESS_TOKEN> with your actual token from above
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  http://localhost:8000/api/employees/
```

## 📊 API Endpoint Testing

### Employees Endpoints

```bash
# Get all employees
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:8000/api/employees/

# Get specific employee
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:8000/api/employees/{id}/

# Filter by department
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:8000/api/employees/?department=MED"

# Search by name
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:8000/api/employees/?search=Maria"

# Get employee capacity summary
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:8000/api/employees/{id}/capacity-summary/

# Get 8-week workload forecast
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:8000/api/employees/{id}/workload/
```

### Projects Endpoints

```bash
# Get all projects
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:8000/api/projects/

# Filter by facility
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:8000/api/projects/?facility=AL"

# Get project statistics
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:8000/api/projects/{id}/statistics/

# Get budget report
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:8000/api/projects/{id}/budget-report/
```

### Assignments Endpoints

```bash
# Get all assignments
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:8000/api/assignments/

# Get assignments by week
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:8000/api/assignments/by-week/?week_start_date=2025-01-15"

# Get capacity by department
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:8000/api/assignments/capacity-by-dept/

# Create new assignment
curl -X POST http://localhost:8000/api/assignments/ \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "employee": "EMPLOYEE_ID",
    "project": "PROJECT_ID",
    "week_start_date": "2025-01-15",
    "hours": 30,
    "scio_hours": 20,
    "external_hours": 10,
    "stage": "OFFLINE"
  }'
```

## 🧪 Testing with Postman

### 1. Import Collection

Create a new Postman collection with the following requests:

**Authentication**
- POST `http://localhost:8000/api/token/` - Get token
- POST `http://localhost:8000/api/token/refresh/` - Refresh token

**Employees**
- GET `http://localhost:8000/api/employees/` - List all
- GET `http://localhost:8000/api/employees/{id}/` - Get one
- POST `http://localhost:8000/api/employees/` - Create
- PUT `http://localhost:8000/api/employees/{id}/` - Update
- DELETE `http://localhost:8000/api/employees/{id}/` - Delete

**Projects**
- GET `http://localhost:8000/api/projects/` - List all
- GET `http://localhost:8000/api/projects/{id}/` - Get one
- POST `http://localhost:8000/api/projects/` - Create
- PUT `http://localhost:8000/api/projects/{id}/` - Update
- DELETE `http://localhost:8000/api/projects/{id}/` - Delete

**Assignments**
- GET `http://localhost:8000/api/assignments/` - List all
- GET `http://localhost:8000/api/assignments/{id}/` - Get one
- POST `http://localhost:8000/api/assignments/` - Create
- PUT `http://localhost:8000/api/assignments/{id}/` - Update
- DELETE `http://localhost:8000/api/assignments/{id}/` - Delete

### 2. Configure Bearer Token

1. In Postman, go to the **Authorization** tab
2. Select **Bearer Token** type
3. Paste your access token from `/api/token/` response
4. This will be included in all requests

## 🔄 Testing Workflow

### Step 1: Verify API is Running

```bash
curl http://localhost:8000/api/
```

Should return `{"detail":"Authentication credentials were not provided."}` - this is expected.

### Step 2: Create and Test Token

```bash
# Get token
TOKEN=$(curl -s -X POST http://localhost:8000/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | grep -o '"access":"[^"]*' | cut -d'"' -f4)

echo "Token: $TOKEN"
```

### Step 3: Test Each Resource

```bash
# Test employees
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/employees/ | jq

# Test projects
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/projects/ | jq

# Test assignments
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/assignments/ | jq
```

### Step 4: Test Create, Update, Delete

```bash
# Get an employee ID from the list
EMPLOYEE_ID="<ID from list>"

# Get a project ID from the list
PROJECT_ID="<ID from list>"

# Create assignment
curl -X POST http://localhost:8000/api/assignments/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"employee\": \"$EMPLOYEE_ID\",
    \"project\": \"$PROJECT_ID\",
    \"week_start_date\": \"2025-01-20\",
    \"hours\": 25,
    \"stage\": \"CONCEPT\"
  }"
```

## 🐛 Common Issues & Troubleshooting

### Issue: "relation does not exist"
```
ProgrammingError: relation "capacity_employee" does not exist
```
**Solution:** Run migrations
```bash
python manage.py migrate
```

### Issue: "No such table: auth_user"
```
ProgrammingError: no such table: auth_user
```
**Solution:** Run all migrations
```bash
python manage.py migrate
python manage.py load_initial_data
```

### Issue: "Authentication credentials were not provided"
```
{"detail":"Authentication credentials were not provided."}
```
**Solution:** This is expected when no token is provided. Include `Authorization: Bearer <TOKEN>` header.

### Issue: "Token is invalid or expired"
```
{"detail":"Given token not valid for any token type","code":"token_not_valid"}
```
**Solution:** Refresh your token
```bash
curl -X POST http://localhost:8000/api/token/refresh/ \
  -H "Content-Type: application/json" \
  -d '{"refresh": "YOUR_REFRESH_TOKEN"}'
```

### Issue: Port 8000 already in use

```bash
# Kill process on port 8000
# On Windows:
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# On macOS/Linux:
lsof -i :8000
kill -9 <PID>

# Or use different port
python manage.py runserver 8001
```

## 📝 Test Cases Checklist

### Authentication
- [ ] POST /api/token/ returns access and refresh tokens
- [ ] Using invalid credentials returns 401
- [ ] Using expired token returns 401
- [ ] Refresh token returns new access token

### Employees
- [ ] GET /api/employees/ returns paginated list
- [ ] GET /api/employees/{id}/ returns single employee
- [ ] POST /api/employees/ creates new employee
- [ ] PUT /api/employees/{id}/ updates employee
- [ ] DELETE /api/employees/{id}/ deletes employee
- [ ] Filter by department works
- [ ] Search by name works

### Projects
- [ ] GET /api/projects/ returns list
- [ ] POST /api/projects/ creates project
- [ ] PUT /api/projects/{id}/ updates project
- [ ] DELETE /api/projects/{id}/ deletes project
- [ ] Filter by facility works
- [ ] Statistics endpoint works

### Assignments
- [ ] GET /api/assignments/ returns list
- [ ] POST /api/assignments/ creates assignment
- [ ] PUT /api/assignments/{id}/ updates assignment
- [ ] DELETE /api/assignments/{id}/ deletes assignment
- [ ] by-week filter works
- [ ] capacity-by-dept works
- [ ] scio_hours and external_hours tracked separately

### Data Integrity
- [ ] Total hours = scio_hours + external_hours
- [ ] Employee capacity not exceeded in assignments
- [ ] Deleted employees cascade correctly
- [ ] Deleted projects cascade correctly
- [ ] Timestamps update correctly

## 🚀 Frontend Integration Testing

Once backend is working locally:

### 1. Update Frontend API URL

In [team-capacity-planner/src/config/api.ts](../../team-capacity-planner/src/config/api.ts):

```typescript
export const API_BASE_URL = 'http://localhost:8000/api';
export const API_TOKEN_ENDPOINT = 'http://localhost:8000/api/token';
```

### 2. Update Frontend Stores

Replace localStorage-based stores with API calls:

```typescript
// Old: useEmployeeStore.ts (local)
const employees = JSON.parse(localStorage.getItem('employees') || '[]');

// New: useEmployeeStore.ts (API)
const response = await fetch(`${API_BASE_URL}/employees/`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
const employees = await response.json();
```

### 3. Test Full Integration

- [ ] Login with admin/admin credentials
- [ ] View all employees from API
- [ ] View all projects from API
- [ ] View all assignments from API
- [ ] Create new employee via form
- [ ] Create new project via form
- [ ] Create new assignment via form
- [ ] Update existing records
- [ ] Delete records
- [ ] Weekly capacity calculations match

## 📊 Performance Testing

### Test with Load

```bash
# Install Apache Bench (if not already installed)
# On Windows: https://httpd.apache.org/docs/2.4/programs/ab.html
# On macOS: brew install httpd
# On Linux: sudo apt-get install apache2-utils

# Benchmark 100 requests with 10 concurrent
ab -n 100 -c 10 \
  -H "Authorization: Bearer <TOKEN>" \
  http://localhost:8000/api/employees/

# Expected: ~500-1000ms total time for 100 requests
# Response time should be <50ms per request
```

### Check Query Optimization

Use Django Debug Toolbar (optional):

```bash
pip install django-debug-toolbar
```

Then add to `config/settings.py`:

```python
INSTALLED_APPS = [
    ...
    'debug_toolbar',
]

MIDDLEWARE = [
    'debug_toolbar.middleware.DebugToolbarMiddleware',
    ...
]

INTERNAL_IPS = ['127.0.0.1']
```

Restart server and access http://localhost:8000/ - you'll see a debug panel showing SQL queries.

## ✅ Deployment Checklist

Before deploying to Railway:

- [ ] All migrations run successfully locally
- [ ] Authentication works with tokens
- [ ] All CRUD operations work
- [ ] Pagination works
- [ ] Filtering and searching work
- [ ] Custom actions work (statistics, capacity-summary, etc)
- [ ] Assignment scio_hours and external_hours track correctly
- [ ] Test data loads successfully
- [ ] No 500 errors in logs
- [ ] Response times are acceptable
- [ ] Frontend ready to integrate with API

## 📞 Next Steps

1. **Local Testing**: Run through all test cases above
2. **Frontend Integration**: Update frontend to use backend API
3. **Railway Deployment**: Follow [DEPLOYMENT.md](./DEPLOYMENT.md)
4. **Production Testing**: Verify API on Railway
5. **Load Testing**: Test with 50+ concurrent users
6. **Monitoring**: Set up logging and alerts

---

**Last Updated**: January 6, 2026
**Version**: 1.0.0
