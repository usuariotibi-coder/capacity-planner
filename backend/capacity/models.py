"""
Models for Team Capacity Planner

This module defines the core data models for managing projects, employees,
assignments, and other capacity planning data.
"""

from django.db import models
from django.contrib.auth.models import User
from django.core.validators import MinValueValidator
import uuid


class Department(models.TextChoices):
    """Department choices for employees and assignments"""
    PM = 'PM', 'Project Manager'
    MED = 'MED', 'Mechanical Design'
    HD = 'HD', 'Hardware Design'
    MFG = 'MFG', 'Manufacturing'
    BUILD = 'BUILD', 'Assembly'
    PRG = 'PRG', 'Programming PLC'


class Facility(models.TextChoices):
    """Facility/location choices for projects"""
    AL = 'AL', 'Facility A'
    MI = 'MI', 'Facility B'
    MX = 'MX', 'Facility C'


class Stage(models.TextChoices):
    """Work stages for assignments"""
    # HD Stages
    SWITCH_LAYOUT_REVISION = 'SWITCH_LAYOUT_REVISION', 'Switch Layout Revision'
    CONTROLS_DESIGN = 'CONTROLS_DESIGN', 'Controls Design'

    # MED Stages
    CONCEPT = 'CONCEPT', 'Concept'
    DETAIL_DESIGN = 'DETAIL_DESIGN', 'Detail Design'

    # BUILD Stages
    CABINETS_FRAMES = 'CABINETS_FRAMES', 'Cabinets/Frames'
    OVERALL_ASSEMBLY = 'OVERALL_ASSEMBLY', 'Overall Assembly'
    FINE_TUNING = 'FINE_TUNING', 'Fine Tuning'
    COMMISSIONING = 'COMMISSIONING', 'Commissioning'

    # PRG Stages
    OFFLINE = 'OFFLINE', 'Offline'
    ONLINE = 'ONLINE', 'Online'
    DEBUG = 'DEBUG', 'Debug'

    # Common stages
    RELEASE = 'RELEASE', 'Release'
    RED_LINES = 'RED_LINES', 'Red Lines'
    SUPPORT = 'SUPPORT', 'Support'
    SUPPORT_MANUALS_FLOW_CHARTS = 'SUPPORT_MANUALS_FLOW_CHARTS', 'Support/Manuals/Flow Charts'
    ROBOT_SIMULATION = 'ROBOT_SIMULATION', 'Robot Simulation'
    STANDARDS_REV_PROGRAMING_CONCEPT = 'STANDARDS_REV_PROGRAMING_CONCEPT', 'Standards Rev/Programming Concept'


class SubcontractCompany(models.TextChoices):
    """Subcontracted company choices for BUILD department"""
    AMI = 'AMI', 'AMI'
    VICER = 'VICER', 'VICER'
    ITAX = 'ITAX', 'ITAX'
    MCI = 'MCI', 'MCI'
    MG_ELECTRICAL = 'MG Electrical', 'MG Electrical'


class Employee(models.Model):
    """Employee/Team member model"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, null=True, blank=True)
    name = models.CharField(max_length=255)
    role = models.CharField(max_length=255)
    department = models.CharField(max_length=10, choices=Department.choices)
    capacity = models.FloatField(validators=[MinValueValidator(0)], help_text="Available hours per week")
    is_active = models.BooleanField(default=True)
    is_subcontracted_material = models.BooleanField(default=False, help_text="Whether this is subcontracted material (BUILD dept only)")
    subcontract_company = models.CharField(max_length=100, null=True, blank=True, help_text="Company/team name if subcontracted")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['department', 'name']
        indexes = [
            models.Index(fields=['department']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f"{self.name} ({self.department})"


class Project(models.Model):
    """Project model"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    client = models.CharField(max_length=255)
    start_date = models.DateField()
    end_date = models.DateField()
    facility = models.CharField(max_length=10, choices=Facility.choices)
    number_of_weeks = models.IntegerField(validators=[MinValueValidator(1)])
    project_manager = models.ForeignKey(Employee, null=True, blank=True, on_delete=models.SET_NULL, related_name='managed_projects')
    visible_in_departments = models.JSONField(default=list, blank=True, help_text="Departments where this project is visible (for quick-created projects)")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['start_date', 'end_date']),
        ]

    def __str__(self):
        return self.name


class DepartmentStageConfig(models.Model):
    """Department stage configuration for projects"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='department_stages')
    department = models.CharField(max_length=10, choices=Department.choices)
    stage = models.CharField(max_length=50, choices=Stage.choices, null=True, blank=True)
    week_start = models.IntegerField(validators=[MinValueValidator(1)], help_text="1-based week number")
    week_end = models.IntegerField(validators=[MinValueValidator(1)], help_text="1-based week number")
    department_start_date = models.DateField(null=True, blank=True, help_text="Actual start date for this specific department")
    duration_weeks = models.IntegerField(null=True, blank=True, validators=[MinValueValidator(1)])
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['project', 'department', 'week_start']
        unique_together = ['project', 'department']

    def __str__(self):
        return f"{self.project.name} - {self.department}"


class Assignment(models.Model):
    """Assignment model - hours allocated to project/department/week"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='assignments')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='assignments')
    week_start_date = models.DateField(help_text="Start date of the week (ISO format YYYY-MM-DD)")
    hours = models.FloatField(validators=[MinValueValidator(0)], help_text="Total hours allocated")
    scio_hours = models.FloatField(null=True, blank=True, validators=[MinValueValidator(0)], help_text="Internal SCIO hours (BUILD/PRG only)")
    external_hours = models.FloatField(null=True, blank=True, validators=[MinValueValidator(0)], help_text="External/subcontracted hours (BUILD/PRG only)")
    stage = models.CharField(max_length=50, choices=Stage.choices, null=True, blank=True)
    comment = models.TextField(blank=True, help_text="Optional comment for this assignment")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['week_start_date', 'employee']
        indexes = [
            models.Index(fields=['week_start_date']),
            models.Index(fields=['employee', 'week_start_date']),
        ]

    def __str__(self):
        return f"{self.employee.name} - {self.project.name} ({self.week_start_date})"


class ProjectBudget(models.Model):
    """Project budget/hours allocation per department"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='budgets')
    department = models.CharField(max_length=10, choices=Department.choices)
    hours_allocated = models.FloatField(validators=[MinValueValidator(0)], help_text="Budget hours per department (presupuesto/cotizado)")
    hours_utilized = models.FloatField(default=0, validators=[MinValueValidator(0)], help_text="Hours utilized/used per department")
    hours_forecast = models.FloatField(default=0, validators=[MinValueValidator(0)], help_text="Forecasted hours per department")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['project', 'department']
        unique_together = ['project', 'department']

    def __str__(self):
        return f"{self.project.name} - {self.department}"

    @property
    def utilization_percent(self):
        """Calculate utilization percentage"""
        if self.hours_allocated == 0:
            return 0
        return ((self.hours_utilized + self.hours_forecast) / self.hours_allocated) * 100


class ScioTeamCapacity(models.Model):
    """SCIO Team capacity per department and week"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    department = models.CharField(max_length=10, choices=Department.choices)
    week_start_date = models.DateField(help_text="Start date of the week (ISO format YYYY-MM-DD)")
    capacity = models.FloatField(validators=[MinValueValidator(0)], help_text="SCIO team capacity for this week")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['department', 'week_start_date']
        indexes = [
            models.Index(fields=['department', 'week_start_date']),
        ]
        unique_together = ['department', 'week_start_date']

    def __str__(self):
        return f"{self.department} - {self.week_start_date}: {self.capacity}"


class SubcontractedTeamCapacity(models.Model):
    """Subcontracted team capacity per company and week (BUILD department only)"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.CharField(max_length=100, help_text="Company name (e.g., AMI, VICER, ITAX, etc.)")
    week_start_date = models.DateField(help_text="Start date of the week (ISO format YYYY-MM-DD)")
    capacity = models.IntegerField(validators=[MinValueValidator(0)], help_text="Number of personnel from this company")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['company', 'week_start_date']
        indexes = [
            models.Index(fields=['company', 'week_start_date']),
        ]
        unique_together = ['company', 'week_start_date']

    def __str__(self):
        return f"{self.company} - {self.week_start_date}: {self.capacity}"


class PrgExternalTeamCapacity(models.Model):
    """External team capacity for PRG department per week"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    team_name = models.CharField(max_length=100, help_text="External team name")
    week_start_date = models.DateField(help_text="Start date of the week (ISO format YYYY-MM-DD)")
    capacity = models.IntegerField(validators=[MinValueValidator(0)], help_text="Number of personnel from this team")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['team_name', 'week_start_date']
        indexes = [
            models.Index(fields=['team_name', 'week_start_date']),
        ]
        unique_together = ['team_name', 'week_start_date']

    def __str__(self):
        return f"{self.team_name} - {self.week_start_date}: {self.capacity}"


class DepartmentWeeklyTotal(models.Model):
    """Weekly occupancy total hours per department and week"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    department = models.CharField(max_length=10, choices=Department.choices)
    week_start_date = models.DateField(help_text="Start date of the week (ISO format YYYY-MM-DD)")
    total_hours = models.FloatField(validators=[MinValueValidator(0)], help_text="Total hours assigned for this department/week")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['department', 'week_start_date']
        indexes = [
            models.Index(fields=['department', 'week_start_date']),
        ]
        unique_together = ['department', 'week_start_date']

    def __str__(self):
        return f"{self.department} - {self.week_start_date}: {self.total_hours}h"


class ActivityLog(models.Model):
    """Activity log for audit trail"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    action = models.CharField(max_length=255, help_text="Action performed")
    model_name = models.CharField(max_length=50, help_text="Model affected")
    object_id = models.CharField(max_length=36, help_text="UUID of affected object")
    changes = models.JSONField(null=True, blank=True, help_text="JSON of changes made")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'created_at']),
        ]

    def __str__(self):
        return f"{self.user} - {self.action} ({self.created_at})"


class EmailVerification(models.Model):
    """Email verification codes for user registration"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='email_verification')
    token = models.CharField(max_length=64, unique=True)  # Keep for backwards compatibility
    code = models.CharField(max_length=6, null=True, blank=True)  # 6-digit verification code
    created_at = models.DateTimeField(auto_now_add=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    attempts = models.IntegerField(default=0)  # Track failed attempts

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"EmailVerification for {self.user.email}"

    def is_expired(self):
        """Check if code is expired (15 minutes for code, 48 hours for token)"""
        from django.conf import settings
        from django.utils import timezone
        # Code expires in 15 minutes
        code_expiry = self.created_at + timedelta(minutes=15)
        return timezone.now() > code_expiry

    def is_verified(self):
        """Check if email is already verified"""
        return self.verified_at is not None

    def max_attempts_reached(self):
        """Check if max verification attempts reached (5 attempts)"""
        return self.attempts >= 5

    @staticmethod
    def generate_code():
        """Generate a random 6-digit verification code"""
        import random
        return str(random.randint(100000, 999999))


class UserSession(models.Model):
    """
    Model to track active user sessions.

    Limits users to a maximum of 2 simultaneous sessions/devices.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sessions')
    refresh_token = models.TextField(unique=True, help_text="JWT refresh token for this session")
    device_info = models.JSONField(default=dict, blank=True, help_text="Device information (user agent, IP, etc.)")
    created_at = models.DateTimeField(auto_now_add=True, help_text="Session creation timestamp")
    last_activity = models.DateTimeField(auto_now=True, help_text="Last activity timestamp")
    is_active = models.BooleanField(default=True, help_text="Whether this session is still active")

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'is_active']),
            models.Index(fields=['refresh_token']),
        ]

    def __str__(self):
        return f"Session for {self.user.username} - Created: {self.created_at}"
