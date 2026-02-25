"""
Middleware for session management and inactivity tracking.
"""
from django.utils import timezone
from django.utils.deprecation import MiddlewareMixin
from django.conf import settings
from datetime import timedelta
from rest_framework_simplejwt.tokens import UntypedToken
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from .models import UserSession


class SessionActivityMiddleware(MiddlewareMixin):
    """
    Middleware that:
    1. Updates last_activity timestamp for active sessions
    2. Marks sessions as inactive if they exceed configured inactivity timeout
    """

    def __init__(self, get_response):
        super().__init__(get_response)
        inactivity_minutes = max(
            1,
            int(getattr(settings, 'SESSION_INACTIVITY_TIMEOUT_MINUTES', 20)),
        )
        self.INACTIVITY_TIMEOUT = timedelta(minutes=inactivity_minutes)

    def __call__(self, request):
        # Process request
        response = self.get_response(request)
        return response

    def process_view(self, request, view_func, view_args, view_kwargs):
        """
        Called just before the view is called.
        Updates session activity and checks for inactive sessions.
        """
        # Skip endpoints that shouldn't count as real activity for extending session lifetime.
        if request.path in [
            '/api/token/',
            '/api/token/refresh/',
            '/api/register/',
            '/api/verify-email/',
            '/api/verify-code/',
            '/api/session-status/',
        ]:
            return None

        # Get the auth header
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')

        if auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
            try:
                # Decode token to get user info
                untyped_token = UntypedToken(token)
                user_id = untyped_token.get('user_id')
                session_id = untyped_token.get('session_id')

                now = timezone.now()
                inactive_threshold = now - self.INACTIVITY_TIMEOUT

                # Always cleanup stale sessions first.
                UserSession.objects.filter(
                    is_active=True,
                    last_activity__lt=inactive_threshold
                ).update(is_active=False)

                if user_id and session_id:
                    # Preferred: update only current device/session.
                    UserSession.objects.filter(
                        id=session_id,
                        user_id=user_id,
                        is_active=True,
                    ).update(last_activity=now)
                elif user_id:
                    # Backward compatibility for tokens minted before `session_id` claim existed.
                    latest_session = (
                        UserSession.objects
                        .filter(user_id=user_id, is_active=True)
                        .order_by('-last_activity')
                        .first()
                    )
                    if latest_session:
                        latest_session.last_activity = now
                        latest_session.save(update_fields=['last_activity'])

            except (InvalidToken, TokenError):
                # Invalid token, let the view handle it
                pass

        return None
