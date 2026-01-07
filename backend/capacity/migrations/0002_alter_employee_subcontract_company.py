# Generated manually

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('capacity', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='employee',
            name='subcontract_company',
            field=models.CharField(blank=True, help_text='Company/team name if subcontracted', max_length=100, null=True),
        ),
    ]
