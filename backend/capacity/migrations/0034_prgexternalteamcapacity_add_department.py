from django.db import migrations, models


def backfill_department_prg(apps, schema_editor):
    """
    Existing rows predate the `department` field and were all PRG-only (this
    model is only now being generalized to MED/HD/MFG/BUILD/PRG), so every
    existing row is unambiguously PRG.
    """
    PrgExternalTeamCapacity = apps.get_model('capacity', 'PrgExternalTeamCapacity')
    PrgExternalTeamCapacity.objects.filter(department='').update(department='PRG')


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('capacity', '0033_projectbudget_cost_allocated'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='prgexternalteamcapacity',
            options={'ordering': ['department', 'team_name', 'week_start_date']},
        ),
        migrations.RemoveIndex(
            model_name='prgexternalteamcapacity',
            name='capacity_pr_team_na_95168f_idx',
        ),
        migrations.AlterUniqueTogether(
            name='prgexternalteamcapacity',
            unique_together=set(),
        ),
        migrations.AddField(
            model_name='prgexternalteamcapacity',
            name='department',
            field=models.CharField(
                blank=True, default='', max_length=10,
                help_text='Department this external team belongs to',
            ),
        ),
        migrations.RunPython(backfill_department_prg, noop_reverse),
        migrations.AlterField(
            model_name='prgexternalteamcapacity',
            name='department',
            field=models.CharField(
                max_length=10,
                choices=[
                    ('PM', 'Project Manager'), ('MED', 'Mechanical Design'), ('HD', 'Hardware Design'),
                    ('MFG', 'Manufacturing'), ('BUILD', 'Assembly'), ('PRG', 'Programming PLC'),
                    ('PURCHASING', 'Purchasing'),
                ],
                help_text='Department this external team belongs to',
            ),
        ),
        migrations.AlterUniqueTogether(
            name='prgexternalteamcapacity',
            unique_together={('department', 'team_name', 'week_start_date')},
        ),
        migrations.AddIndex(
            model_name='prgexternalteamcapacity',
            index=models.Index(fields=['department', 'team_name', 'week_start_date'], name='capacity_pr_departm_505de9_idx'),
        ),
    ]
