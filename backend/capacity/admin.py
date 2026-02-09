from django.contrib import admin
from .models import Employee, Project, Assignment, DepartmentStageConfig, ProjectBudget, ActivityLog, UserSession


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ['name', 'department', 'role', 'capacity', 'is_active']
    list_filter = ['department', 'is_active', 'is_subcontracted_material']
    search_fields = ['name', 'role']


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ['name', 'client', 'facility', 'start_date', 'end_date', 'project_manager', 'is_hidden', 'hidden_at']
    list_filter = ['facility', 'start_date', 'is_hidden']
    search_fields = ['name', 'client']


@admin.register(Assignment)
class AssignmentAdmin(admin.ModelAdmin):
    list_display = ['employee', 'project', 'week_start_date', 'hours', 'stage']
    list_filter = ['stage', 'week_start_date']
    search_fields = ['employee__name', 'project__name']


@admin.register(DepartmentStageConfig)
class DepartmentStageConfigAdmin(admin.ModelAdmin):
    list_display = ['project', 'department', 'stage', 'week_start', 'week_end']
    list_filter = ['department']


@admin.register(ProjectBudget)
class ProjectBudgetAdmin(admin.ModelAdmin):
    list_display = ['project', 'department', 'hours_allocated', 'hours_utilized']
    list_filter = ['department']


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ['user', 'action', 'model_name', 'created_at']
    list_filter = ['model_name', 'created_at']
    readonly_fields = ['user', 'action', 'model_name', 'object_id', 'changes', 'created_at']


@admin.register(UserSession)
class UserSessionAdmin(admin.ModelAdmin):
    list_display = ['user', 'created_at', 'last_activity', 'is_active']
    list_filter = ['is_active', 'created_at']
    search_fields = ['user__username', 'device_info']
    readonly_fields = ['id', 'refresh_token', 'created_at', 'last_activity']
