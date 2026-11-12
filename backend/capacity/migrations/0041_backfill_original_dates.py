from django.db import migrations
from django.db.models import F


def backfill_original_dates(apps, schema_editor):
    Project = apps.get_model('capacity', 'Project')
    DepartmentStageConfig = apps.get_model('capacity', 'DepartmentStageConfig')

    Project.objects.filter(original_start_date__isnull=True).update(original_start_date=F('start_date'))
    Project.objects.filter(original_end_date__isnull=True).update(original_end_date=F('end_date'))
    DepartmentStageConfig.objects.filter(original_start_date__isnull=True).update(
        original_start_date=F('department_start_date')
    )
    DepartmentStageConfig.objects.filter(original_duration_weeks__isnull=True).update(
        original_duration_weeks=F('duration_weeks')
    )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('capacity', '0040_project_and_stage_config_original_dates'),
    ]

    operations = [
        migrations.RunPython(backfill_original_dates, noop_reverse),
    ]
