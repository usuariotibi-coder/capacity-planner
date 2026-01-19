"""
Middleware for session management and inactivity tracking.
"""
from django.utils import timezone
from datetime import timedelta
from rest_framework_simplejwt.tokens import UntypedToken
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from .models import UserSession


class SessionActivityMiddleware:
    """
    Middleware that:
    1. Updates last_activity timestamp for active sessions
    2. Marks sessions as inactive if they exceed 30 minutes without activity
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.INACTIVITY_TIMEOUT = timedelta(minutes=30)  # 30 minutes

    def __call__(self, request):
        # Process request
        response = self.get_response(request)
        return response

    def process_view(self, request, view_func, view_args, view_kwargs):
        """
        Called just before the view is called.
        Updates session activity and checks for inactive sessions.
        """
        # Skip if this is a login or registration request
        if request.path in ['/api/token/', '/api/register/', '/api/verify-email/', '/api/verify-code/']:
            return None

        # Get the auth header
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')

        if auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
            try:
                # Decode token to get user info
                untyped_token = UntypedToken(token)
                user_id = untyped_token.get('user_id')

                if user_id:
                    # Find and update the session's last_activity
                    sessions = UserSession.objects.filter(
                        user_id=user_id,
                        is_active=True
                    )

                    # Update last_activity for all active sessions
                    sessions.update(last_activity=timezone.now())

                    # Check for inactive sessions and mark them as inactive
                    now = timezone.now()
                    inactive_threshold = now - self.INACTIVITY_TIMEOUT

                    UserSession.objects.filter(
                        is_active=True,
                        last_activity__lt=inactive_threshold
                    ).update(is_active=False)

            except (InvalidToken, TokenError):
                # Invalid token, let the view handle it
                pass

        return None
