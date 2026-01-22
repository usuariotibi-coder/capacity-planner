# Session Management System

**Version**: 1.0
**Last Updated**: January 2026
**Authors**: Claude Haiku 4.5

## Overview

The Team Capacity Planner implements a comprehensive session management system that:

- Limits users to a maximum of **2 simultaneous active sessions/devices**
- Tracks user activity with automatic logout after **30 minutes of inactivity**
- Provides both **frontend** and **backend** activity monitoring
- Supports **mobile devices** with special handling for background activity

---

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│                   Frontend (React)                       │
├─────────────────────────────────────────────────────────┤
│  1. useInactivityLogout Hook                             │
│     - Monitors user activity (mouse, keyboard, touch)    │
│     - 30-minute inactivity timeout                       │
│     - Periodic session status checks (every 5 min)       │
│     - Handles app visibility changes (mobile)            │
└──────────────────┬──────────────────────────────────────┘
                   │ HTTP Requests
                   ▼
┌─────────────────────────────────────────────────────────┐
│                   Backend (Django)                       │
├─────────────────────────────────────────────────────────┤
│  1. SessionActivityMiddleware                            │
│     - Updates last_activity on every request             │
│     - Marks sessions inactive after 30 min no activity   │
│                                                          │
│  2. CaseInsensitiveTokenObtainPairSerializer             │
│     - Validates login credentials                        │
│     - Checks active session count (max 2)                │
│     - Creates UserSession record on success              │
│                                                          │
│  3. UserSession Model                                    │
│     - Tracks active sessions per user                    │
│     - Stores device info (User-Agent, IP)                │
│     - Records last activity timestamp                    │
│                                                          │
│  4. Management Commands                                  │
│     - cleanup_inactive_sessions: Manual cleanup          │
│                                                          │
│  5. API Views                                            │
│     - SessionStatusView: Check if session is active      │
│     - LogoutView: Deactivate current session             │
│     - ChangePasswordView: Invalidate all sessions        │
└─────────────────────────────────────────────────────────┘
```

---

## Database Model: UserSession

```python
class UserSession(models.Model):
    id = UUIDField(primary_key=True)
    user = ForeignKey(User, on_delete=CASCADE)
    refresh_token = TextField(unique=True)
    device_info = JSONField()  # {user_agent: str, ip_address: str}
    created_at = DateTimeField(auto_now_add=True)
    last_activity = DateTimeField(auto_now=True)
    is_active = BooleanField(default=True)
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique session identifier |
| `user` | ForeignKey | Reference to Django User |
| `refresh_token` | Text | JWT refresh token for this session |
| `device_info` | JSON | Device info: user_agent, ip_address |
| `created_at` | DateTime | When session was created |
| `last_activity` | DateTime | Last time user made a request |
| `is_active` | Boolean | Whether session is still valid |

---

## Login Flow

### Step 1: User Submits Credentials

```
POST /api/token/
Content-Type: application/json

{
  "username": "user@example.com",
  "password": "password123"
}
```

### Step 2: Backend Validation

```python
# In CaseInsensitiveTokenObtainPairSerializer.validate()

1. Find user with case-insensitive username lookup
2. Verify password is correct
3. Count active sessions: active_sessions = UserSession.objects.filter(
     user=user, is_active=True
   ).count()
4. If active_sessions >= 2:
     Reject login with error message
5. Create JWT tokens (access + refresh)
6. Store UserSession record:
   - user_id: logged-in user
   - refresh_token: JWT refresh token
   - device_info: {user_agent, ip_address}
   - is_active: True
   - created_at: now
   - last_activity: now
```

### Step 3: Return Tokens to Frontend

```json
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "user_id": "12345",
  "username": "user@example.com"
}
```

### Step 4: Frontend Stores Tokens

```typescript
// In AuthContext
localStorage.setItem('access_token', response.access);
localStorage.setItem('refresh_token', response.refresh);
```

---

## Activity Tracking

### Frontend Activity (Browser)

**Events Monitored**:
- `mousedown` - Mouse click
- `keydown` - Keyboard input
- `scroll` - Page scrolling
- `touchstart` - Touch on mobile
- `click` - Click event

**Timer Reset Logic**:
```typescript
Events detected → Reset 30-min inactivity timer → Timer starts again
```

### Backend Activity (API Requests)

**Middleware Execution**:

```python
# SessionActivityMiddleware

For every API request:
1. Extract JWT token from Authorization header
2. Decode token to get user_id
3. Update all active sessions for that user:
   sessions.update(last_activity=timezone.now())
4. Check for inactive sessions:
   - inactive_threshold = now - 30 minutes
   - Mark sessions as inactive if last_activity < threshold
```

**Timeline**:
```
Time:
0 min ──────── User makes request ──── last_activity updated
              ↑                        ↑
              Request 1                Request 2

30 min ─────── No requests made ────── Session auto-marked inactive
              (threshold reached)
```

---

## Session Status Checking

### Endpoint: GET /api/session-status/

**Purpose**: Let frontend check if session is still active

**Request**:
```
GET /api/session-status/
Authorization: Bearer ACCESS_TOKEN
```

**Response (Active Session)**:
```
Status: 200 OK
Content: {"status": "active"}
```

**Response (Inactive Session)**:
```
Status: 401 Unauthorized
Content: {"detail": "Session is inactive"}
```

### Frontend Implementation

```typescript
// In useInactivityLogout hook

// Check session status every 5 minutes
const checkSessionStatus = async () => {
  const response = await fetch(`${API_URL}/session-status/`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    // Session is inactive, logout user
    logout();
  }
};

setInterval(checkSessionStatus, 5 * 60 * 1000); // 5 minutes
```

---

## Mobile Device Handling

### Problem
On mobile browsers, JavaScript timers **pause** when the app goes to background.

### Solution

```typescript
// Listen for visibility change event
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // App came back to foreground
    checkSessionStatus();  // Check if still active
    resetTimer();          // Reset 30-min timer
  }
});
```

**Timeline**:
```
User opens app
├─ Timer starts (30 min)
├─ User minimizes app (timer PAUSES)
├─ 20 minutes pass in real time
└─ User opens app again
   ├─ visibilitychange event fires
   ├─ Check backend: "Has it been 30+ min?"
   └─ If yes → logout, if no → reset timer
```

---

## Logout Operations

### Manual Logout: POST /api/logout/

```
POST /api/logout/
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json

{
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc..."
}
```

**Backend Action**:
```python
# Find session by refresh_token
session = UserSession.objects.filter(refresh_token=token).first()

# Mark as inactive
session.is_active = False
session.save()
```

### Password Change: POST /api/change-password/

When user changes password:

1. **Validate** current password
2. **Update** to new password
3. **Invalidate** all sessions for this user:
   ```python
   UserSession.objects.filter(user=user).update(is_active=False)
   ```
4. **Force re-login** - User must login again with new password

---

## Session Cleanup

### Automatic Cleanup (Middleware)

On every API request:
```python
# Mark sessions inactive if no activity in 30 minutes
UserSession.objects.filter(
    is_active=True,
    last_activity__lt=timezone.now() - timedelta(minutes=30)
).update(is_active=False)
```

### Manual Cleanup (Management Command)

For emergency cleanup (e.g., many stuck sessions):

```bash
# Mark all sessions inactive if > 30 min without activity
python manage.py cleanup_inactive_sessions

# Mark all sessions inactive if > 60 min without activity
python manage.py cleanup_inactive_sessions --minutes 60

# Mark ALL sessions inactive immediately (emergency)
python manage.py cleanup_inactive_sessions --minutes 0
```

---

## Error Messages

| Error | Status | Cause | Solution |
|-------|--------|-------|----------|
| "Máximo de dispositivos conectados alcanzado" | 401 | User has 2 active sessions | Logout from another device or wait 30 min for auto-logout |
| "Session is inactive" | 401 | Session marked inactive by backend | Login again |
| "Invalid or expired token" | 401 | Token expired (24 hrs) | Use refresh token or login again |
| "Credenciales inválidas" | 401 | Wrong password or username | Verify credentials |

---

## API Endpoints Summary

### Session Management

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/token/` | Get access + refresh tokens | No |
| POST | `/api/token/refresh/` | Get new access token | No |
| POST | `/api/logout/` | Deactivate current session | Yes |
| GET | `/api/session-status/` | Check if session is active | Yes |
| POST | `/api/change-password/` | Change password + invalidate all sessions | Yes |

---

## Configuration

### Environment Variables

```env
# Session settings (configured in Django settings)
INACTIVITY_TIMEOUT = 30 minutes  # Frontend
SESSION_ACTIVITY_TIMEOUT = 30 minutes  # Backend
MAX_SESSIONS_PER_USER = 2
```

### Django Settings

```python
# Session timeout
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=24),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
}

# Middleware
MIDDLEWARE = [
    ...
    'capacity.middleware.SessionActivityMiddleware',
]
```

---

## Frontend Integration

### React Hooks

```typescript
// app/src/hooks/useInactivityLogout.ts

export const useInactivityLogout = () => {
  const { logout, isLoggedIn } = useAuth();

  // Monitors inactivity and checks session status
  // Auto-logout after 30 min of no activity
  // Works on web and mobile
};
```

### Usage in App

```typescript
// In main App component
import { useInactivityLogout } from './hooks/useInactivityLogout';

export function App() {
  useInactivityLogout(); // Automatically monitors sessions
  // ... rest of app
}
```

---

## Testing

### Manual Testing

```bash
# 1. Login
curl -X POST http://localhost:8000/api/token/ \
  -d '{"username":"user@example.com","password":"password"}'

# 2. Check session status
curl -H "Authorization: Bearer ACCESS_TOKEN" \
  http://localhost:8000/api/session-status/

# 3. Try to login from another device (should fail after 2nd session)
curl -X POST http://localhost:8000/api/token/ \
  -d '{"username":"user@example.com","password":"password"}'

# 4. Logout manually
curl -X POST http://localhost:8000/api/logout/ \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -d '{"refresh":"REFRESH_TOKEN"}'

# 5. Try to logout again (should fail - session already inactive)
curl -H "Authorization: Bearer ACCESS_TOKEN" \
  http://localhost:8000/api/session-status/
```

### Automated Testing

```python
# tests/test_session_management.py

def test_max_two_sessions():
    # Login from device 1
    # Login from device 2
    # Try login from device 3 -> should fail

def test_auto_logout_after_30_minutes():
    # Login
    # Wait 30+ minutes
    # Try to access API -> should fail

def test_session_status_endpoint():
    # Login
    # Check session status -> should return 200
    # Mark session as inactive
    # Check session status again -> should return 401
```

---

## Troubleshooting

### User Can't Login: "Máximo de dispositivos..."

**Cause**: User has 2 active sessions already

**Solutions**:
1. **Manual**: User logs out from another device
2. **Automatic**: Wait 30 minutes for auto-logout
3. **Admin**: Run cleanup command:
   ```bash
   python manage.py cleanup_inactive_sessions --minutes 0
   ```

### Session Expires Immediately After Login

**Cause**: `visibilitychange` event fires immediately + session marked inactive

**Fix**: Check `SessionActivityMiddleware` is updating `last_activity`

### 404 on /session-status/ in Production

**Cause**: API_URL configured incorrectly in frontend

**Fix**: Ensure both frontend and backend use same URL:
```typescript
// ✓ Correct
const BASE_URL = 'https://capacity-planner-production.up.railway.app';
const API_URL = `${BASE_URL}/api`;

// ✗ Wrong
const API_URL = 'http://localhost:8000/api';
```

---

## Security Considerations

### Token Storage

- ✅ **Frontend**: Stored in `localStorage` (XSS vulnerable but no alternative)
- ✅ **Backend**: JWT stored in `UserSession.refresh_token`
- ✅ **Transfer**: Always use HTTPS in production

### Session Limits

- ✅ Max 2 sessions per user prevents account sharing
- ✅ 30-min timeout prevents abandoned sessions
- ✅ Auto-deactivation on inactivity protects shared devices

### Device Tracking

- ✅ IP address + User-Agent stored for audit trail
- ✅ Can be used to detect suspicious activity
- ✅ Admin can view all active sessions per user

---

## Recent Updates (January 2026)

### ✅ Route Protection
- Created `ProtectedRoute` component to guard private routes
- All authenticated pages require valid JWT tokens
- Automatic redirect to login for unauthorized users

### ✅ Auto-Logout on Tab Close
- Added `beforeunload` event listener
- Uses `navigator.sendBeacon()` for reliable logout
- Session deactivated immediately when user closes tab

### ✅ Real Error Messages
- Login now displays actual backend errors
- Shows "Máximo de dispositivos conectados" instead of generic error
- Improved error parsing in frontend

### ✅ Proper Session Deactivation
- Logout now calls `/api/logout/` endpoint
- Session marked as `is_active=False` in database
- Prevents session accumulation bug

### ✅ Activity Log Improvements
- Shows user full name instead of email
- 2-column grid layout for better visibility
- Removed technical details (Object ID, Timestamp)
- Debug logging for troubleshooting

**See**: `SECURITY_AND_SESSION_UPDATES.md` for detailed changelog

---

## Future Enhancements

- [ ] Device fingerprinting (WebGL, screen resolution, etc)
- [ ] Geographic location tracking (IP geolocation)
- [ ] Session management UI (view/kill active sessions)
- [ ] Suspicious activity alerts
- [ ] Push notifications on new login
- [ ] Session activity audit log
- [ ] WebSocket real-time session invalidation
