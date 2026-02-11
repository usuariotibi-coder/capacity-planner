"""
Management command to cleanup inactive user sessions.

Marks sessions as inactive if they haven't had any activity in configured timeout.
This should be run periodically (e.g., via cron job or Celery beat).
"""
from django.core.management.base import BaseCommand
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db.utils import OperationalError
from django.utils import timezone
from datetime import timedelta
from capacity.models import UserSession


class Command(BaseCommand):
    help = 'Cleanup inactive user sessions (older than configured inactivity timeout)'

    def add_arguments(self, parser):
        default_minutes = max(
            1,
            int(getattr(settings, 'SESSION_INACTIVITY_TIMEOUT_MINUTES', 20)),
        )
        parser.add_argument(
            '--minutes',
            type=int,
            default=default_minutes,
            help=f'Minutes of inactivity before marking session as inactive (default: {default_minutes})',
        )

    def handle(self, *args, **options):
        minutes = options['minutes']
        inactivity_threshold = timezone.now() - timedelta(minutes=minutes)

        try:
            # Mark inactive sessions
            inactive_sessions = UserSession.objects.filter(
                is_active=True,
                last_activity__lt=inactivity_threshold
            ).update(is_active=False)
        except (OperationalError, ImproperlyConfigured) as exc:
            self.stderr.write(
                self.style.WARNING(
                    f'Skipping cleanup_inactive_sessions: database unavailable/misconfigured ({exc})'
                )
            )
            return

        self.stdout.write(
            self.style.SUCCESS(
                f'Successfully marked {inactive_sessions} inactive sessions as inactive'
            )
        )
