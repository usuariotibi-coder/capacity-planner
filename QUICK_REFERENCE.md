# Team Capacity Planner - Quick Reference Card

## 🚀 START HERE (90 seconds)

### Step 1: Run Backend (Windows)
```bash
cd backend
run_local.bat
```

### Step 2: Open Browser
- **API**: http://localhost:8000/api/
- **Admin**: http://localhost:8000/admin/
- **Credentials**: admin / admin

### Step 3: Test API
```bash
# Get token
curl -X POST http://localhost:8000/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'

# List employees (replace TOKEN)
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:8000/api/employees/
```

---

## 📚 Documentation Map

| Need | File | Lines |
|------|------|-------|
| **First steps** | [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) | 300 |
| **Setup guide** | [backend/README.md](./backend/README.md) | 350 |
| **Test API** | [backend/LOCAL_TESTING.md](./backend/LOCAL_TESTING.md) | 400 |
| **API Reference** | [backend/API_DOCUMENTATION.md](./backend/API_DOCUMENTATION.md) | 1000+ |
| **Deploy** | [backend/DEPLOYMENT.md](./backend/DEPLOYMENT.md) | 300 |
| **Integrate Frontend** | [INTEGRATION_CHECKLIST.md](./INTEGRATION_CHECKLIST.md) | 300 |

---

## 🔑 Default Credentials

| Component | Username | Password |
|-----------|----------|----------|
| Admin Panel | admin | admin |
| API (if needed) | admin | admin |

---

## 🌐 API Endpoints Quick List

```
Authentication:
POST   /api/token/           Get token
POST   /api/token/refresh/   Refresh token

Resources (all support GET, POST, PUT, DELETE):
/api/employees/             9 test employees
/api/projects/              3 test projects
/api/assignments/           11 test assignments
/api/department-stages/     Department config
/api/project-budgets/       Budget tracking
/api/activity-logs/         Audit trail (read-only)
```

---

## 🧪 Quick Test Commands

```bash
# Get token
TOKEN=$(curl -s -X POST http://localhost:8000/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' \
  | grep -o '"access":"[^"]*' | cut -d'"' -f4)

# List employees
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/employees/ | jq

# List projects
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/projects/ | jq

# List assignments
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/assignments/ | jq
```

---

## 📊 What You Have

| Component | Status | Files |
|-----------|--------|-------|
| **Backend Code** | ✅ | config/, capacity/ |
| **Database** | ✅ | PostgreSQL models |
| **API** | ✅ | 50+ endpoints |
| **Auth** | ✅ | JWT tokens |
| **Docker** | ✅ | Dockerfile ready |
| **Railway** | ✅ | Procfile, railway.toml |
| **Docs** | ✅ | 1500+ lines |
| **Test Data** | ✅ | 9 emp, 3 proj, 11 assign |

---

## ⏱️ Time Guide

| Task | Time |
|------|------|
| Run backend | 2 min |
| Test endpoints | 5 min |
| Full test suite | 30 min |
| Frontend integration | 2-4 hours |
| Deploy to Railway | 30 min |

---

## 🎯 Next Steps

### Today
1. `cd backend && run_local.bat`
2. Test endpoints
3. Review [backend/LOCAL_TESTING.md](./backend/LOCAL_TESTING.md)

### Tomorrow
1. Frontend integration
2. Follow [INTEGRATION_CHECKLIST.md](./INTEGRATION_CHECKLIST.md)

### Next Week
1. Deploy to Railway
2. Follow [backend/DEPLOYMENT.md](./backend/DEPLOYMENT.md)

---

## 🆘 Troubleshooting

### "Port 8000 already in use"
```bash
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# macOS/Linux
lsof -i :8000
kill -9 <PID>
```

### "Database not found"
```bash
cd backend
python manage.py migrate
python manage.py load_initial_data
```

### "Token not working"
- Verify token is in Authorization header
- Format: `Authorization: Bearer <TOKEN>`
- Not: `Authorization: Token <TOKEN>`

### "CORS error"
Check backend is running and API URL is correct in frontend config.

---

## 📁 Project Structure

```
Capacity/
├── backend/                  ← Start here
│   ├── run_local.bat        ← Click this
│   ├── README.md            ← Read this
│   └── LOCAL_TESTING.md     ← Then read this
├── team-capacity-planner/    ← Frontend
├── PROJECT_OVERVIEW.md       ← Guide
└── INTEGRATION_CHECKLIST.md  ← For frontend work
```

---

## 🔐 Security

- ✅ JWT authentication
- ✅ CORS configured
- ✅ DEBUG=False in production
- ✅ Secret key protected
- ✅ SSL/TLS on Railway
- ✅ Rate limiting enabled

---

## 📞 Resources

- **Quick Help**: This file
- **Setup**: [backend/README.md](./backend/README.md)
- **Testing**: [backend/LOCAL_TESTING.md](./backend/LOCAL_TESTING.md)
- **Full API**: [backend/API_DOCUMENTATION.md](./backend/API_DOCUMENTATION.md)
- **Deploy**: [backend/DEPLOYMENT.md](./backend/DEPLOYMENT.md)
- **Integrate**: [INTEGRATION_CHECKLIST.md](./INTEGRATION_CHECKLIST.md)

---

## ✅ Verification Checklist

- [ ] Backend runs without errors
- [ ] Can login at http://localhost:8000/admin/
- [ ] Can get token from /api/token/
- [ ] Can list employees, projects, assignments
- [ ] No red errors in terminal

---

**Status**: ✅ Production Ready
**Version**: 1.0.0
**Ready**: Yes, start now! 🚀

👉 **Next action**: `cd backend && run_local.bat`
