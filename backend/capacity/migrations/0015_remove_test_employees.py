# Generated migration to remove test/placeholder employees

from django.db import migrations


def remove_test_employees(apps, schema_editor):
    """Remove placeholder test employees created by previous migrations"""
    Employee = apps.get_model('capacity', 'Employee')

    # List of test employee names to remove
    test_employee_names = [
        'PM Employee 1',
        'MED Employee 1',
        'HD Employee 1',
        'MFG Employee 1',
        'PRG Employee 1',
        'BUILD Employee 1',
    ]

    # Delete test employees
    deleted_count, _ = Employee.objects.filter(name__in=test_employee_names).delete()
    print(f"Removed {deleted_count} test employees")


def reverse_remove_test_employees(apps, schema_editor):
    """Reverse operation - recreate test employees if needed"""
    Employee = apps.get_model('capacity', 'Employee')

    test_employees = [
        ('PM Employee 1', 'PM', 'Project Manager', 40, False),
        ('MED Employee 1', 'MED', 'Mechanical Engineer', 40, False),
        ('HD Employee 1', 'HD', 'Hardware Designer', 40, False),
        ('MFG Employee 1', 'MFG', 'Manufacturing Engineer', 40, False),
        ('PRG Employee 1', 'PRG', 'Programmer', 40, False),
        ('BUILD Employee 1', 'BUILD', 'Builder', 40, False),
    ]

    for name, dept, role, capacity, is_subcontracted in test_employees:
        Employee.objects.get_or_create(
            name=name,
            defaults={
                'department': dept,
                'role': role,
                'capacity': capacity,
                'is_active': True,
                'is_subcontracted_material': is_subcontracted,
            }
        )


class Migration(migrations.Migration):

    dependencies = [
        ('capacity', '0014_usersession'),
    ]

    operations = [
        migrations.RunPython(remove_test_employees, reverse_remove_test_employees),
    ]
