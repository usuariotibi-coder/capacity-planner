from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('capacity', '0021_scioteamcapacity_pto_scioteamcapacity_training'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='is_high_probability',
            field=models.BooleanField(
                db_index=True,
                default=False,
                help_text='Marks projects with high execution probability for visual prioritization.',
            ),
        ),
    ]
