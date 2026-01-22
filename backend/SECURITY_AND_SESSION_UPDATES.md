# Security and Session Management Updates

**Version**: 2.0
**Last Updated**: January 2026
**Authors**: Claude Opus 4.5

---

## Recent Updates (Latest Session)

### 1. Route Protection with ProtectedRoute Component

**Date**: January 2026
**Status**: ✅ Implemented and Deployed

#### What Changed
- Created new `ProtectedRoute` component to protect private routes
- All authenticated routes now require valid JWT tokens
- Automatic redirect to login for unauthorized access

#### Files Modified
- `team-capacity-planner/src/components/ProtectedRoute.tsx` (NEW)
- `team-capacity-planner/src/App.tsx`

#### Implementation
```typescript
// ProtectedRoute component checks authentication before rendering
<ProtectedRoute>
  <MainApp />
</ProtectedRoute>
```

#### Protected Routes
- `/change-password` - Change password page
- `/*` - All main application routes (capacity matrix, resources, projects, activity log)

#### Security Benefits
- Prevents unauthorized access via direct URL
- Users cannot access private pages without authentication
- Automatic redirect to login page for unauthenticated users

---

### 2. Auto-Logout on Tab/Browser Close

**Date**: January 2026
**Status**: ✅ Implemented and Deployed

#### What Changed
- Added `beforeunload` event listener to detect tab/window close
- Uses `navigator.sendBeacon()` for reliable logout requests
- Session automatically deactivated on backend when user closes tab
- Prevents "ghost sessions" from accumulating

#### Files Modified
- `team-capacity-planner/src/hooks/useInactivityLogout.ts`

#### Implementation
```typescript
const handleBeforeUnload = () => {
  const refreshToken = localStorage.getItem('refresh_token');
  const accessToken = localStorage.getItem('access_token');

  if (refreshToken && accessToken) {
    navigator.sendBeacon(`${API_URL}/logout/`, JSON.stringify({
      refresh: refreshToken,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
    }));
  }
};

window.addEventListener('beforeunload', handleBeforeUnload);
```

#### Session Lifecycle
1. User logs in → Session created with `is_active=True`
2. User closes tab → `beforeunload` event fires → Logout request sent
3. Backend deactivates session → `is_active=False`
4. User tries to login again → Session count is 0 → Login succeeds

---

### 3. Real Backend Error Messages in Login

**Date**: January 2026
**Status**: ✅ Implemented and Deployed

#### What Changed
- Login now displays actual backend error messages
- Previously showed generic "Credenciales inválidas" for all errors
- Now properly extracts and displays session limit errors
- Better UX with accurate error feedback

#### Files Modified
- `team-capacity-planner/src/services/api.ts`

#### Error Message Handling
```typescript
// Parse backend error and extract meaningful message
if (errorData.non_field_errors && Array.isArray(errorData.non_field_errors)) {
  errorMessage = errorData.non_field_errors.join('. ');
} else if (errorData.detail) {
  errorMessage = errorData.detail;
} else if (errorData.error) {
  errorMessage = errorData.error;
} else {
  // Join all error messages from the response
  const messages = Object.values(errorData).flat();
  if (messages.length > 0) {
    errorMessage = messages.join('. ');
  }
}
```

#### Example Errors Now Displayed
- ❌ "Máximo de dispositivos conectados alcanzado. Por favor, cierre sesión en otro dispositivo."
- ❌ "Usuario o contraseña inválidos"
- ❌ "La cuenta está desactivada"

---

### 4. Proper Session Deactivation on Logout

**Date**: January 2026
**Status**: ✅ Implemented and Deployed

#### What Changed
- Logout now calls backend `/api/logout/` endpoint
- Previously only cleared local tokens without backend notification
- Session is now properly marked as `is_active=False` in database
- Prevents session accumulation bug

#### Files Modified
- `team-capacity-planner/src/services/api.ts`
- `team-capacity-planner/src/context/AuthContext.tsx`

#### Logout Flow
```typescript
logout: async () => {
  // 1. Call backend to deactivate session
  const refreshToken = getRefreshToken();
  const accessToken = getAccessToken();

  if (refreshToken && accessToken) {
    await fetch(`${API_URL}/api/logout/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ refresh: refreshToken }),
    });
  }

  // 2. Clear local tokens
  clearTokens();

  // 3. Clear cached data
  localStorage.removeItem('employees');
  localStorage.removeItem('projects');
  localStorage.removeItem('assignments');
};
```

---

### 5. Improved Activity Log UI

**Date**: January 2026
**Status**: ✅ Implemented and Deployed

#### What Changed
- Changed from email to user's full name in Activity Log
- 2-column grid layout for better visibility (1 column on mobile)
- User names displayed as pill/badge for visual clarity
- Removed Object ID and Timestamp from expanded view (already in header)
- Added debug logging to console for troubleshooting

#### Files Modified
- `team-capacity-planner/src/pages/ActivityLogPage.tsx`

#### User Display
```typescript
// Shows full name instead of email
{log.user?.first_name && log.user?.last_name
  ? `${log.user.first_name} ${log.user.last_name}`
  : log.user?.username || log.user?.email || 'Unknown'}
```

#### Layout Improvements
- Badge-style user name display
- 2-column grid: `grid-cols-1 lg:grid-cols-2`
- Better spacing with consistent gaps
- Conditional rendering of summary info

---

## Backend Session Management

### UserSession Model
```python
class UserSession(models.Model):
    id = UUIDField(primary_key=True, default=uuid.uuid4)
    user = ForeignKey(User, on_delete=models.CASCADE, related_name='sessions')
    refresh_token = TextField(unique=True)
    device_info = JSONField()  # {user_agent, ip_address}
    created_at = DateTimeField(auto_now_add=True)
    last_activity = DateTimeField(auto_now=True)
    is_active = BooleanField(default=True)
```

### Session Status Flow
```
┌──────────────────────────────────────────────────────┐
│          Session Status Lifecycle                    │
├──────────────────────────────────────────────────────┤
│                                                      │
│  [Login] → is_active=True (session created)          │
│      ↓                                               │
│  [Activity Detected] → last_activity updated         │
│      ↓                                               │
│  [30min inactivity] → is_active=False (backend)      │
│      ↓                                               │
│  [User Logout/Tab Close] → is_active=False           │
│      ↓                                               │
│  [Next Login] → Check: active_sessions < 2           │
│      └─ YES → Create new session                     │
│      └─ NO → Reject with "Máximo de dispositivos"    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Login Endpoint
```http
POST /api/token/
Content-Type: application/json

{
  "username": "user@example.com",
  "password": "password123"
}

# Response (200 OK)
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "user_id": 1,
  "username": "user@example.com",
  "email": "user@example.com",
  "first_name": "John",
  "last_name": "Doe"
}

# Response (400 Bad Request - Max sessions reached)
{
  "non_field_errors": [
    "Máximo de dispositivos conectados alcanzado. Por favor, cierre sesión en otro dispositivo."
  ]
}
```

### Logout Endpoint
```http
POST /api/logout/
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "refresh": "<refresh_token>"
}

# Response (200 OK)
{
  "detail": "Sesión cerrada exitosamente."
}
```

### Session Status Endpoint
```http
GET /api/session-status/
Authorization: Bearer <access_token>

# Response (200 OK - Session Active)
{
  "status": "active",
  "detail": "Sesión activa",
  "user": "user@example.com"
}

# Response (401 Unauthorized - Session Inactive)
{
  "status": "inactive",
  "detail": "Sesión inactiva o ha sido cerrada."
}
```

---

## Frontend Hooks

### useInactivityLogout Hook

**Location**: `team-capacity-planner/src/hooks/useInactivityLogout.ts`

**Features**:
- 30-minute inactivity timeout
- Activity detection: mouse, keyboard, scroll, touch
- Mobile support: `visibilitychange` event
- 5-minute periodic session status checks
- Auto-logout on tab/window close

**Configuration**:
```typescript
const INACTIVITY_TIMEOUT = 30 * 60 * 1000;      // 30 minutes
const SESSION_CHECK_INTERVAL = 5 * 60 * 1000;   // 5 minutes
```

---

## Security Features Implemented

✅ **Route Protection**
- ProtectedRoute component guards all private pages
- Automatic redirect to login for unauthorized users

✅ **Session Limits**
- Maximum 2 simultaneous sessions per user
- Enforced at login time in serializer

✅ **Activity Tracking**
- Backend middleware tracks `last_activity` on every request
- Frontend detects user activity (mouse, keyboard, touch)
- Mobile optimized with visibility detection

✅ **Automatic Logout**
- 30-minute inactivity timeout
- Tab/window close triggers immediate logout
- Session status verified every 5 minutes

✅ **Error Transparency**
- Real backend error messages displayed to user
- Clear feedback on session limit exceeded

✅ **Token Management**
- Secure JWT token storage in localStorage
- Refresh token rotation on access token expiry
- Proper token cleanup on logout

---

## Migration & Deployment

### Database Migration
```bash
python manage.py migrate capacity
```

### Pre-Deployment Checklist
```bash
# 1. Run cleanup of inactive sessions
python manage.py cleanup_inactive_sessions --minutes=30

# 2. Build frontend
cd team-capacity-planner
npm run build

# 3. Collect static files
python manage.py collectstatic --noinput

# 4. Deploy to production
# (via Railway, Vercel, or your deployment method)
```

---

## Testing & Verification

### Manual Testing Checklist

- [ ] Login with valid credentials → Session created
- [ ] Login from 2 devices → Both successful
- [ ] Try login from 3rd device → "Máximo de dispositivos" error
- [ ] Logout from one device → 3rd device login succeeds
- [ ] Close tab/browser → Session deactivated
- [ ] Check DevTools Console → `[ActivityLog]` logs visible
- [ ] Activity Log page → Shows user names, not emails
- [ ] Activity Log layout → 2 columns on desktop, 1 on mobile

### Console Debugging

Open DevTools (F12) and check:
```javascript
// Login debug info
[LOGIN] Response status: 200
[LOGIN] Success! Token received

// Logout debug info
[LOGOUT] Session deactivated on backend

// Inactivity check
[useInactivityLogout] User inactive for 30 minutes, logging out...

// Tab close
[useInactivityLogout] Tab/window closing, logging out...

// Activity Log data
[ActivityLog] Raw data from API: [...]
[ActivityLog] User object: { first_name: "John", last_name: "Doe", ... }
```

---

## Known Issues & Resolutions

### Issue: Users see email instead of name in Activity Log
**Cause**: Backend not returning `first_name` and `last_name`
**Solution**: Check `UserSerializer` fields and API response in console
**Debug**: Open DevTools → Console → Look for `[ActivityLog] User object:`

### Issue: Session accumulates even after logout
**Cause**: Logout not calling backend endpoint
**Status**: ✅ FIXED - Logout now calls `/api/logout/`

### Issue: Login shows generic error message
**Cause**: Error parsing not extracting backend message
**Status**: ✅ FIXED - Now extracts `non_field_errors` properly

---

## Performance Considerations

- Session checks every 5 minutes (non-blocking)
- Activity detection uses debounced event listeners
- `navigator.sendBeacon()` doesn't block page unload
- Database queries indexed on user + created_at
- Session cleanup runs during off-peak hours

---

## Future Improvements

- [ ] WebSocket-based real-time session invalidation
- [ ] Device management UI (view/revoke sessions)
- [ ] Login attempt tracking and rate limiting
- [ ] Email notifications for new logins
- [ ] Biometric authentication support
- [ ] Risk-based authentication challenges

---

## References

- Session Management Documentation: `SESSION_MANAGEMENT.md`
- API Documentation: `API_DOCUMENTATION.md`
- Backend README: `README.md`
