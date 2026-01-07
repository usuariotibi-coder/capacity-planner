# Generated manually for model synchronization

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('capacity', '0002_alter_employee_subcontract_company'),
    ]

    operations = [
        # Add visible_in_departments JSONField to Project
        migrations.AddField(
            model_name='project',
            name='visible_in_departments',
            field=models.JSONField(blank=True, default=list, help_text='Departments where this project is visible (for quick-created projects)'),
        ),
        # Change ProjectBudget.project from OneToOneField to ForeignKey
        migrations.AlterField(
            model_name='projectbudget',
            name='project',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='budgets', to='capacity.project'),
        ),
    ]
