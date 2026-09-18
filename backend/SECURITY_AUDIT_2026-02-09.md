# Security Audit Report

Date: 2026-02-09
Scope: `backend/` (Django API) + `team-capacity-planner/` (React frontend)
Auditor: Codex (automated + manual review)

## 1. Executive Summary
Current posture: **At Risk**

High-impact findings were confirmed in authentication/registration and dependency hygiene.
The most critical issue is that registration currently activates accounts immediately without proving email ownership, which allows impersonation of any address under the allowed corporate domain.

## 2. Methodology
The following tests were executed:

1. Django hardening checks
- `python manage.py check --deploy`

2. Static analysis (Python)
- `bandit -r capacity config manage.py -f json -o bandit-report.json`

3. Dependency vulnerability audit (Python)
- `pip-audit -r requirements.txt`

4. Dependency vulnerability audit (Frontend)
- `npm audit --json`

5. Dynamic authorization/session tests
- Hidden data access checks for non-privileged users (`include_hidden=true`)
- Login throttling behavior under repeated failed attempts
- Registration throttling behavior under repeated attempts
- Registration/login flow validation

6. Security headers/CORS behavior
- Header inspection on API responses
- CORS preflight from arbitrary origin

## 3. Findings (Prioritized)

## CRITICAL
### C1. Account activation bypass on registration
Evidence:
- `backend/capacity/serializers.py:260` sets `is_active=True` on user creation.
- Registration response still claims email verification is required: `backend/capacity/views.py:2293`.
- Dynamic test: registered `security_probe_fake_user@na.scio-automation.com` and logged in immediately (HTTP 200 token issued).

Risk:
- Any attacker who can guess/choose an unregistered corporate email under `@na.scio-automation.com` can create that identity and gain platform access.

Recommendation:
- Set `is_active=False` at registration.
- Create and enforce mandatory verification flow before first login.
- Block token issuance for unverified users.

## HIGH
### H1. Known CVEs in core backend dependencies
Evidence (pip-audit):
- `django==4.2.11` flagged with multiple advisories and CVEs (including 2025/2026 entries); fixed versions include up to `4.2.28`.
- `djangorestframework==3.14.0` flagged with `CVE-2024-21520`; fix `3.15.2`.

Risk:
- Publicly known vulnerabilities with available patches increase exploitability.

Recommendation:
- Upgrade:
  - Django to latest patched 4.2 LTS (minimum `4.2.28` per scan output).
  - DRF to at least `3.15.2`.
- Re-run full regression suite after upgrade.

### H2. Known CVE in frontend direct dependency
Evidence (npm audit):
- `axios` high severity advisory: DoS via `__proto__` merge path (range `<=1.13.4`).

Risk:
- Client-side DoS risk in affected request handling path.

Recommendation:
- Upgrade `axios` to patched version above affected range.

### H3. Hidden project/assignment exposure to non-privileged users
Evidence:
- `backend/capacity/views.py:607` and `backend/capacity/views.py:1283` accept `include_hidden` from querystring with no privilege gate.
- Dynamic test using read-only OTHER/OPERATIONS user:
  - `/api/projects/?include_hidden=true` returned hidden project.
  - `/api/assignments/?include_hidden=true` returned assignment for hidden project.

Risk:
- Confidential historical/archived data is accessible by users who should not see it.

Recommendation:
- Restrict `include_hidden=true` to full-access roles only (staff/superuser/PM/BI as per your policy).

## MEDIUM
### M1. Registration throttle scope is configured but not effectively enforced
Evidence:
- Views define `throttle_scope = 'registration'` (`backend/capacity/views.py:2274`, `2424`, `2546`).
- DRF settings use only `AnonRateThrottle` and `UserRateThrottle` (`backend/config/settings.py:144`), but no `ScopedRateThrottle`.
- Dynamic test: 11 rapid registration attempts produced only `400`, no `429`.

Risk:
- Registration abuse and enumeration pressure are easier than intended.

Recommendation:
- Add `rest_framework.throttling.ScopedRateThrottle` to `DEFAULT_THROTTLE_CLASSES`.
- Keep/validate `registration: 5/hour` policy.

### M2. Overly permissive CORS policy
Evidence:
- `CORS_ALLOW_ALL_ORIGINS` configurable default true (`backend/config/settings.py:185`).
- `CORS_ALLOW_CREDENTIALS = True` (`backend/config/settings.py:196`).
- Dynamic preflight from `https://evil.example` returned allow-origin and credentials=true.

Risk:
- Broadens cross-origin exposure surface; dangerous when combined with credentialed contexts and browser/session auth usage.

Recommendation:
- In production, disable allow-all and use strict `CORS_ALLOWED_ORIGINS` allowlist.
- Reassess necessity of credentialed CORS.

### M3. Password change endpoint bypasses Django password validators
Evidence:
- `backend/capacity/views.py:2830` only checks minimum length 8, not full configured validators.

Risk:
- Weak passwords may be accepted during change-password even if registration path enforces stronger policy.

Recommendation:
- Apply `django.contrib.auth.password_validation.validate_password` in change-password endpoint.

## LOW
### L1. Security hardening warnings on `check --deploy`
Observed warnings:
- Missing HSTS (`SECURE_HSTS_SECONDS`)
- `SECURE_SSL_REDIRECT` false
- `SESSION_COOKIE_SECURE` / `CSRF_COOKIE_SECURE` depending runtime mode
- `DEBUG` true in active local environment

Recommendation:
- Enforce production env config and edge HTTPS policy.
- Set HSTS carefully after validation.

### L2. Tokens stored in localStorage (XSS theft risk model)
Evidence:
- `team-capacity-planner/src/services/api.ts:149-159` persists access/refresh tokens in localStorage.

Recommendation:
- Keep strict XSS hygiene and consider migration to HttpOnly cookie strategy if feasible.

## 4. Positive Controls Verified
- Device/session cap behavior present and tested (`SessionControlTests` pass).
- Inactivity timeout logic present (backend middleware + frontend hook).
- Login endpoint anonymous throttle active (429 after 101 failed attempts under `100/hour` default).
- Registered users endpoint correctly denied for PRG role in dynamic check.

## 5. Remediation Plan

## Immediate (24-48h)
1. Fix registration activation flow (`is_active=False` + mandatory verification).
2. Patch dependencies (Django, DRF, axios).
3. Restrict `include_hidden` access by role.

## Short term (1 week)
1. Enable `ScopedRateThrottle` for registration/verification endpoints.
2. Harden CORS for production allowlist only.
3. Apply Django password validators in password change endpoint.

## Medium term (2-4 weeks)
1. Add CI security gates:
   - `pip-audit`
   - `npm audit` (or `audit-ci`)
   - `bandit`
2. Add regression tests for hidden-data authorization and registration verification enforcement.

## 6. Artifacts Generated
The scans produced machine-readable JSON artifacts during execution (`bandit`, `pip-audit`, `npm audit`).
Those temporary files were not committed to git to avoid repository noise; regenerate them with the commands listed in Section 2 when needed.

