from collections import defaultdict

from django.db import migrations


def dedupe_duplicate_assignments(apps, schema_editor):
    """Merge Assignment rows that collide on (employee, project, week_start_date, stage)
    before 0030 enforces that as a unique constraint. Real production data has exact
    duplicates from before this constraint existed; sum their hours into one row."""
    Assignment = apps.get_model('capacity', 'Assignment')
    groups = defaultdict(list)
    for row in Assignment.objects.all().order_by('created_at', 'id'):
        key = (row.employee_id, row.project_id, row.week_start_date, row.stage)
        groups[key].append(row)

    for rows in groups.values():
        if len(rows) <= 1:
            continue
        keeper, extras = rows[0], rows[1:]
        for extra in extras:
            keeper.hours = (keeper.hours or 0) + (extra.hours or 0)
            if extra.scio_hours is not None:
                keeper.scio_hours = (keeper.scio_hours or 0) + extra.scio_hours
            if extra.external_hours is not None:
                keeper.external_hours = (keeper.external_hours or 0) + extra.external_hours
            if not keeper.comment and extra.comment:
                keeper.comment = extra.comment
            if keeper.department_override is None and extra.department_override is not None:
                keeper.department_override = extra.department_override
        keeper.save()
        Assignment.objects.filter(id__in=[extra.id for extra in extras]).delete()


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('capacity', '0029_scioheadcountevent'),
    ]

    operations = [
        migrations.RunPython(dedupe_duplicate_assignments, noop),
    ]
