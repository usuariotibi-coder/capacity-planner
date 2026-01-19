"""
Management command to cleanup inactive user sessions.

Marks sessions as inactive if they haven't had any activity in 30 minutes.
This should be run periodically (e.g., via cron job or Celery beat).
"""
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from capacity.models import UserSession


class Command(BaseCommand):
    help = 'Cleanup inactive user sessions (older than 30 minutes)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--minutes',
            type=int,
            default=30,
            help='Minutes of inactivity before marking session as inactive (default: 30)',
        )

    def handle(self, *args, **options):
        minutes = options['minutes']
        inactivity_threshold = timezone.now() - timedelta(minutes=minutes)

        # Mark inactive sessions
        inactive_sessions = UserSession.objects.filter(
            is_active=True,
            last_activity__lt=inactivity_threshold
        ).update(is_active=False)

        self.stdout.write(
            self.style.SUCCESS(
                f'✓ Successfully marked {inactive_sessions} inactive sessions as inactive'
            )
        )
