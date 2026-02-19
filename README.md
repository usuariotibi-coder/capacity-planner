# Team Capacity Planner

## 1. Overview
Team Capacity Planner is a web platform to plan, track, and audit engineering capacity across departments and projects.

It includes:
- A React + TypeScript frontend for operational planning.
- A Django REST API for data, permissions, and security.
- Department-aware workflows for assignments, capacity, budgets, and project visibility.

This README is the main operational reference for the current codebase state.

## 2. Current Scope
The system currently covers:
- Capacity Matrix (global and by department).
- Resources management (employees, department ownership rules).
- Projects management (create, update, soft delete/hide).
- Assignment planning by week, stage, and comments.
- Budget and utilization tracking by department.
- Project import into additional departments.
- Activity log and traceability.
- Registered users management (Business Intelligence scope).
- Session security controls (inactivity timeout and max active devices).

## 3. Architecture
### Frontend
- Stack: React 19, TypeScript, Vite, Tailwind, Zustand.
- Main app: `team-capacity-planner/src/App.tsx`.
- API client: `team-capacity-planner/src/services/api.ts`.
- Auth context and access flags: `team-capacity-planner/src/context/AuthContext.tsx`.

### Backend
- Stack: Django 4.2, Django REST Framework, SimpleJWT.
- Main app: `backend/capacity/`.
- API routing: `backend/config/urls.py`.
- Core business logic: `backend/capacity/views.py`.
- Security/session middleware: `backend/capacity/middleware.py`.

### Data Layer
Core models in `backend/capacity/models.py`:
- `Employee`
- `Project`
- `Assignment`
- `DepartmentStageConfig`
- `ProjectBudget`
- `ProjectChangeOrder`
- `DepartmentWeeklyTotal`
- `ScioTeamCapacity`
- `SubcontractedTeamCapacity`
- `PrgExternalTeamCapacity`
- `ActivityLog`
- `UserProfile`
- `UserSession`

## 4. Access Model and Permissions
Permission behavior is implemented in backend helpers and mirrored in frontend UX controls.

### Full access users
A user has full access when any of these is true:
- `is_superuser`
- `is_staff`
- profile department is `PM`
- profile department is `OTHER` with `other_department = BUSINESS_INTELLIGENCE`

### Read-only users
- profile department is `OTHER` and not `BUSINESS_INTELLIGENCE`

### Department edit scope
For non-full-access users:
- Can edit only their own department.
- Shared edit exception: `BUILD` and `MFG` can edit each other.

### Project creation/import in Capacity Matrix
Current behavior allows department users to create/import projects in their own editable department (not only full-access users).

Backend enforcement was updated to match this behavior:
- Create/update project operations validate department-level scope.
- Cross-department unauthorized edits are blocked.

## 5. Project Visibility and Deletion Behavior
Project deletion is implemented as soft delete in `ProjectViewSet`:
- `DELETE /api/projects/{id}/` marks project as hidden (`is_hidden=true`) instead of hard delete.
- Historical assignments and related calculations are preserved.
- Hidden projects are excluded from default list responses unless `include_hidden=true`.

This supports preserving historical calculations while removing projects from active operational views.

## 6. Session and Security Controls
Session logic combines backend and frontend checks.

### Session limits
- Maximum active sessions per user: `MAX_ACTIVE_SESSIONS_PER_USER` (default `2`).
- Enforced at login (`CaseInsensitiveTokenObtainPairSerializer`).

### Inactivity timeout
- Config: `SESSION_INACTIVITY_TIMEOUT_MINUTES` (default `90`).
- Stale sessions are deactivated in middleware and session status checks.

### Token/session binding
- JWT tokens include `session_id`.
- Backend checks session status via `/api/session-status/`.
- Frontend hook `useInactivityLogout` performs periodic validation and local inactivity logout.

### Relevant endpoints
- `POST /api/token/`
- `POST /api/token/refresh/`
- `POST /api/logout/`
- `GET /api/session-status/`
- `POST /api/change-password/`

## 7. Local Development Setup
### Prerequisites
- Python 3.11+
- Node.js 18+
- npm 9+

### Backend setup (recommended explicit flow)
```bash
cd backend
python -m venv venv
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
copy .env.example .env   # Windows
# cp .env.example .env   # macOS/Linux

python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Notes:
- `run_local.bat` / `run_local.sh` exist, but `load_initial_data` is currently disabled.
- Do not assume default credentials are auto-created.

### Frontend setup
```bash
cd team-capacity-planner
npm install
npm run dev
```

Frontend default URL: `http://localhost:5173` (or next free Vite port).

### Frontend API base URL
Set `VITE_API_URL` to your backend base URL (recommended):

```bash
# team-capacity-planner/.env
VITE_API_URL=http://localhost:8000
```

If not provided, frontend has a fallback base URL defined in `src/utils/apiUrl.ts`.

## 8. Environment Variables
Primary backend variables (see `backend/config/settings.py`):

- `SECRET_KEY`
- `DEBUG`
- `ALLOWED_HOSTS`
- `DATABASE_URL` (preferred in deployment)
- `DB_ENGINE`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` (local/manual DB config)
- `CORS_ALLOWED_ORIGINS`
- `CORS_ALLOW_ALL_ORIGINS`
- `FRONTEND_URL`
- `SESSION_INACTIVITY_TIMEOUT_MINUTES`
- `MAX_ACTIVE_SESSIONS_PER_USER`
- `SENDGRID_API_KEY`
- `DEFAULT_FROM_EMAIL`

## 9. Build, Tests, and Validation
### Backend tests
```bash
cd backend
python manage.py test capacity.tests --verbosity 2
```

### Frontend build
```bash
cd team-capacity-planner
npm run build
```

### Optional lint
```bash
cd team-capacity-planner
npm run lint
```

## 10. Deployment Notes
- Runtime version file: `runtime.txt` and `backend/runtime.txt` (Python 3.11.7).
- Procfile exists at root and backend level.
- Root `Procfile` runs migrations then serves Django via gunicorn.

Reference docs:
- `backend/DEPLOYMENT.md`
- `backend/DEPLOYMENT_ES.md`

## 11. Repository Structure
```text
Capacity/
  README.md
  backend/
    manage.py
    config/
    capacity/
      models.py
      serializers.py
      views.py
      middleware.py
      tests.py
  team-capacity-planner/
    package.json
    src/
      App.tsx
      pages/
      stores/
      services/
      context/
      hooks/
```

## 12. Additional Documentation
Useful detailed references already in repo:
- `backend/API_DOCUMENTATION.md`
- `backend/SESSION_MANAGEMENT.md`
- `backend/SECURITY_AND_SESSION_UPDATES.md`
- `team-capacity-planner/ARCHITECTURE_GUIDE.md`
- `team-capacity-planner/SYSTEM_DOCUMENTATION.md`

## 13. Maintenance Guidelines
- Keep this README aligned with behavior in `views.py`, `serializers.py`, and `AuthContext.tsx`.
- When changing permissions, session policy, or project lifecycle behavior, update this file in the same PR.
- Avoid claims not backed by tests or runtime config.

---
Last update: 2026-02-09
Owner: Capacity engineering team
