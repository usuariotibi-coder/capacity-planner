from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from capacity.models import Employee, Project, Assignment, DepartmentStageConfig
from datetime import datetime, timedelta
import uuid


class Command(BaseCommand):
    help = 'Load initial mock data for testing'

    def handle(self, *args, **options):
        self.stdout.write('Loading initial data...')

        # Create superuser if not exists
        if not User.objects.filter(username='admin').exists():
            User.objects.create_superuser('admin', 'admin@example.com', 'admin')
            self.stdout.write(self.style.SUCCESS('[OK] Created superuser: admin/admin'))

        # Create Employees
        employees_data = [
            {'name': 'John Smith', 'role': 'Senior PM', 'department': 'PM', 'capacity': 40, 'is_active': True},
            {'name': 'Maria Garcia', 'role': 'Mechanical Designer', 'department': 'MED', 'capacity': 40, 'is_active': True},
            {'name': 'Carlos Rodriguez', 'role': 'Hardware Engineer', 'department': 'HD', 'capacity': 40, 'is_active': True},
            {'name': 'Ana Martinez', 'role': 'Manufacturing Lead', 'department': 'MFG', 'capacity': 40, 'is_active': True},
            {'name': 'Luis Hernandez', 'role': 'Assembly Technician', 'department': 'BUILD', 'capacity': 40, 'is_active': True},
            {'name': 'Sofia Lopez', 'role': 'PLC Programmer', 'department': 'PRG', 'capacity': 40, 'is_active': True},
            {'name': 'Miguel Torres', 'role': 'Junior Programmer', 'department': 'PRG', 'capacity': 40, 'is_active': True},
            {'name': 'Laura Sanchez', 'role': 'Assembly Technician', 'department': 'BUILD', 'capacity': 40, 'is_active': True, 'is_subcontracted_material': True, 'subcontract_company': 'AMI'},
            {'name': 'Diego Flores', 'role': 'Quality Inspector', 'department': 'MFG', 'capacity': 40, 'is_active': True},
        ]

        employees = {}
        for emp_data in employees_data:
            emp, created = Employee.objects.get_or_create(
                name=emp_data['name'],
                defaults=emp_data
            )
            employees[emp_data['name']] = emp
            if created:
                self.stdout.write(f'[OK] Created employee: {emp_data["name"]}')

        # Create Projects
        today = datetime.now().date()
        project_manager = employees['John Smith']

        projects_data = [
            {
                'name': 'Alpha System',
                'client': 'Client A',
                'start_date': today,
                'end_date': today + timedelta(days=56),
                'facility': 'AL',
                'number_of_weeks': 8,
                'project_manager': project_manager
            },
            {
                'name': 'Beta Platform',
                'client': 'Client B',
                'start_date': today + timedelta(days=14),
                'end_date': today + timedelta(days=98),
                'facility': 'MI',
                'number_of_weeks': 12,
                'project_manager': project_manager
            },
            {
                'name': 'Gamma Module',
                'client': 'Client C',
                'start_date': today + timedelta(days=7),
                'end_date': today + timedelta(days=63),
                'facility': 'MX',
                'number_of_weeks': 8,
                'project_manager': project_manager
            },
        ]

        projects = {}
        for proj_data in projects_data:
            proj, created = Project.objects.get_or_create(
                name=proj_data['name'],
                defaults=proj_data
            )
            projects[proj_data['name']] = proj
            if created:
                self.stdout.write(f'[OK] Created project: {proj_data["name"]}')

        # Create Assignments
        assignments_data = [
            # Alpha System
            {'employee': 'Maria Garcia', 'project': 'Alpha System', 'week_offset': 0, 'hours': 30, 'stage': 'CONCEPT'},
            {'employee': 'Maria Garcia', 'project': 'Alpha System', 'week_offset': 1, 'hours': 35, 'stage': 'DETAIL_DESIGN'},
            {'employee': 'Carlos Rodriguez', 'project': 'Alpha System', 'week_offset': 0, 'hours': 25, 'stage': 'SWITCH_LAYOUT_REVISION'},
            {'employee': 'Carlos Rodriguez', 'project': 'Alpha System', 'week_offset': 2, 'hours': 40, 'stage': 'CONTROLS_DESIGN'},
            {'employee': 'Sofia Lopez', 'project': 'Alpha System', 'week_offset': 3, 'hours': 30, 'scio_hours': 20, 'external_hours': 10, 'stage': 'OFFLINE'},

            # Beta Platform
            {'employee': 'Ana Martinez', 'project': 'Beta Platform', 'week_offset': 2, 'hours': 35, 'stage': 'CONCEPT'},
            {'employee': 'Luis Hernandez', 'project': 'Beta Platform', 'week_offset': 4, 'hours': 30, 'scio_hours': 25, 'external_hours': 5, 'stage': 'CABINETS_FRAMES'},
            {'employee': 'Sofia Lopez', 'project': 'Beta Platform', 'week_offset': 5, 'hours': 40, 'scio_hours': 30, 'external_hours': 10, 'stage': 'ONLINE'},

            # Gamma Module
            {'employee': 'Carlos Rodriguez', 'project': 'Gamma Module', 'week_offset': 1, 'hours': 20, 'stage': 'RELEASE'},
            {'employee': 'Miguel Torres', 'project': 'Gamma Module', 'week_offset': 2, 'hours': 35, 'scio_hours': 25, 'external_hours': 10, 'stage': 'DEBUG'},
            {'employee': 'Laura Sanchez', 'project': 'Gamma Module', 'week_offset': 3, 'hours': 40, 'scio_hours': 20, 'external_hours': 20, 'stage': 'OVERALL_ASSEMBLY'},
        ]

        for assign_data in assignments_data:
            week_start = today + timedelta(weeks=assign_data['week_offset'])

            assign, created = Assignment.objects.get_or_create(
                employee=employees[assign_data['employee']],
                project=projects[assign_data['project']],
                week_start_date=week_start,
                stage=assign_data['stage'],
                defaults={
                    'hours': assign_data['hours'],
                    'scio_hours': assign_data.get('scio_hours'),
                    'external_hours': assign_data.get('external_hours'),
                    'comment': f'Test assignment for {assign_data["employee"]}'
                }
            )
            if created:
                self.stdout.write(f'[OK] Created assignment: {assign_data["employee"]} -> {assign_data["project"]} (Week {assign_data["week_offset"]})')

        self.stdout.write(self.style.SUCCESS('[OK] All initial data loaded successfully!'))
        self.stdout.write('\nYou can now test the API:')
        self.stdout.write('  1. Login: POST /api/token/ with username=admin, password=admin')
        self.stdout.write('  2. Get employees: GET /api/employees/')
        self.stdout.write('  3. Get projects: GET /api/projects/')
        self.stdout.write('  4. Get assignments: GET /api/assignments/')
