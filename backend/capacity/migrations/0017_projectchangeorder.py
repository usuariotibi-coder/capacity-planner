from django.db import migrations, models
import django.db.models.deletion
import django.core.validators
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('capacity', '0016_alter_prgexternalteamcapacity_capacity_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProjectChangeOrder',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('department', models.CharField(choices=[('PM', 'Project Manager'), ('MED', 'Mechanical Design'), ('HD', 'Hardware Design'), ('MFG', 'Manufacturing'), ('BUILD', 'Assembly'), ('PRG', 'Programming PLC')], max_length=10)),
                ('name', models.CharField(help_text='Change order name (e.g., CO01)', max_length=50)),
                ('hours_quoted', models.FloatField(help_text='Quoted hours for this change order', validators=[django.core.validators.MinValueValidator(0)])),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='change_orders', to='capacity.project')),
            ],
            options={
                'ordering': ['project', 'department', 'name'],
                'unique_together': {('project', 'department', 'name')},
            },
        ),
    ]
