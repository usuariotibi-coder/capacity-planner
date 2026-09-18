"""
Load Initial Data Command

This command is deprecated and disabled. It was used for development/testing only.
In production, no initial data should be loaded automatically.
"""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'DEPRECATED: Initial data loading is disabled for production'

    def handle(self, *args, **options):
        """Do nothing - this command is disabled in production."""
        self.stdout.write(
            self.style.WARNING(
                'load_initial_data command is disabled. '
                'Manual data management is required in production.'
            )
        )
