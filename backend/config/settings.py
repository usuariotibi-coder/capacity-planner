"""
Django settings for Team Capacity Planner API.

Production-ready configuration for deployment on Railway.
Uses environment variables for sensitive configuration.
"""

from pathlib import Path
import os
from urllib.parse import urlparse
from decouple import config

# Build paths inside the project
BASE_DIR = Path(__file__).resolve().parent.parent

# SECURITY: Secret key from environment
SECRET_KEY = config('SECRET_KEY', default='django-insecure-development-key-change-in-production')

# DEBUG: Control from environment variable
DEBUG = config('DEBUG', default=False, cast=bool)

def _strip_wrapping_quotes(value: str) -> str:
    text = (value or '').strip()
    if len(text) >= 2 and ((text[0] == '"' and text[-1] == '"') or (text[0] == "'" and text[-1] == "'")):
        return text[1:-1].strip()
    return text


def _csv_env(name: str, default: str) -> list[str]:
    raw = _strip_wrapping_quotes(config(name, default=default))
    return [item.strip().strip('"').strip("'") for item in raw.split(',') if item and item.strip()]


# ALLOWED_HOSTS: Accept from environment or use defaults
ALLOWED_HOSTS = _csv_env('ALLOWED_HOSTS', 'localhost,127.0.0.1,.railway.app')

# Application definition
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'whitenoise.runserver_nostatic',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework_simplejwt',
    'corsheaders',
    'capacity',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'capacity.middleware.SessionActivityMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'


# Database Configuration - PostgreSQL for production, SQLite for development
# Railway provides DATABASE_URL automatically, otherwise use individual variables
import dj_database_url

database_url = _strip_wrapping_quotes(os.environ.get('DATABASE_URL', ''))

if database_url:
    # Railway and other platforms provide DATABASE_URL
    try:
        parsed_db_config = dj_database_url.parse(database_url, conn_max_age=600)
    except ValueError:
        parsed_db_config = {}

    if parsed_db_config:
        if 'postgresql' in parsed_db_config.get('ENGINE', '') and not parsed_db_config.get('NAME'):
            parsed_path_name = urlparse(database_url).path.lstrip('/')
            parsed_db_config['NAME'] = (
                parsed_path_name
                or _strip_wrapping_quotes(os.environ.get('PGDATABASE', ''))
                or _strip_wrapping_quotes(config('DB_NAME', default=''))
                or 'railway'
            )

        DATABASES = {'default': parsed_db_config}
    else:
        # Invalid DATABASE_URL should not break startup; fallback to explicit DB_* vars.
        DATABASES = {
            'default': {
                'ENGINE': config('DB_ENGINE', default='django.db.backends.sqlite3'),
                'NAME': config('DB_NAME', default='db.sqlite3'),
                'USER': config('DB_USER', default='postgres'),
                'PASSWORD': config('DB_PASSWORD', default=''),
                'HOST': config('DB_HOST', default='localhost'),
                'PORT': config('DB_PORT', default='5432'),
            }
        }
else:
    # Local development
    DATABASES = {
        'default': {
            'ENGINE': config('DB_ENGINE', default='django.db.backends.sqlite3'),
            'NAME': config('DB_NAME', default='db.sqlite3'),
            'USER': config('DB_USER', default='postgres'),
            'PASSWORD': config('DB_PASSWORD', default=''),
            'HOST': config('DB_HOST', default='localhost'),
            'PORT': config('DB_PORT', default='5432'),
        }
    }

# Connection pooling for Railway
if not DEBUG:
    DATABASES['default']['CONN_MAX_AGE'] = 0

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# Internationalization
LANGUAGE_CODE = 'es'  # Spanish as default
TIME_ZONE = 'America/Mexico_City'
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# REST Framework Configuration
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_FILTER_BACKENDS': (
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ),
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
    'DEFAULT_RENDERER_CLASSES': (
        'rest_framework.renderers.JSONRenderer',
        'rest_framework.renderers.BrowsableAPIRenderer',
    ),
    'DEFAULT_THROTTLE_CLASSES': (
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
        'rest_framework.throttling.ScopedRateThrottle',
    ),
    'DEFAULT_THROTTLE_RATES': {
        'anon': '100/hour',
        'user': '1000/hour',
        'registration': '5/hour',
    },
}

# JWT Configuration
from datetime import timedelta

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=24),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
}

# Session Management
SESSION_INACTIVITY_TIMEOUT_MINUTES = config(
    'SESSION_INACTIVITY_TIMEOUT_MINUTES',
    default=20,
    cast=int,
)
MAX_ACTIVE_SESSIONS_PER_USER = config(
    'MAX_ACTIVE_SESSIONS_PER_USER',
    default=2,
    cast=int,
)

# CORS Configuration for frontend access
CORS_ALLOWED_ORIGINS = config(
    'CORS_ALLOWED_ORIGINS',
    default='http://localhost:5173,http://localhost:3000',
    cast=lambda v: [item.strip().strip('"').strip("'") for item in _strip_wrapping_quotes(v).split(',') if item and item.strip()]
)

# Allow all origins (useful for Railway preview/frontends)
CORS_ALLOW_ALL_ORIGINS = config(
    'CORS_ALLOW_ALL_ORIGINS',
    default=True,
    cast=bool
)

# Allow all railway.app subdomains
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^https://.*\.railway\.app$",
]

CORS_ALLOW_CREDENTIALS = True

# Security Settings
if not DEBUG:
    # Railway handles SSL termination, so we don't need Django to redirect
    SECURE_SSL_REDIRECT = False
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_BROWSER_XSS_FILTER = True

# Email Configuration (Resend/SendGrid/SMTP fallback)
RESEND_API_KEY = config('RESEND_API_KEY', default='')
SENDGRID_API_KEY = config('SENDGRID_API_KEY', default='')
DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', default='noreply@example.com')
EMAIL_BACKEND = config('EMAIL_BACKEND', default='django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST = config('EMAIL_HOST', default='')
EMAIL_PORT = config('EMAIL_PORT', default=587, cast=int)
EMAIL_USE_TLS = config('EMAIL_USE_TLS', default=True, cast=bool)
EMAIL_USE_SSL = config('EMAIL_USE_SSL', default=False, cast=bool)
EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')

# Registration Configuration
# Leave empty to allow any email domain.
# Example to restrict: REGISTRATION_EMAIL_DOMAIN='@na.scio-automation.com'
REGISTRATION_EMAIL_DOMAIN = config('REGISTRATION_EMAIL_DOMAIN', default='')
EMAIL_VERIFICATION_TOKEN_LIFETIME = timedelta(hours=48)
FRONTEND_URL = config('FRONTEND_URL', default='http://localhost:5173')
