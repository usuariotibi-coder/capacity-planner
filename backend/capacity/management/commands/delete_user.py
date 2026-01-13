from django.core.management.base import BaseCommand
from django.contrib.auth.models import User

class Command(BaseCommand):
    help = 'Delete a user by email'

    def add_arguments(self, parser):
        parser.add_argument('email', type=str, help='Email of the user to delete')

    def handle(self, *args, **options):
        email = options['email']
        try:
            user = User.objects.get(email=email)
            username = user.username
            user.delete()
            self.stdout.write(self.style.SUCCESS(f'[OK] Usuario "{username}" ({email}) eliminado correctamente'))
        except User.DoesNotExist:
            self.stdout.write(self.style.WARNING(f'[NOT FOUND] Usuario con email "{email}" no encontrado'))
