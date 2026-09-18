"""
Models for Team Capacity Planner

This module defines the core data models for managing projects, employees,
assignments, and other capacity planning data.
"""

from datetime import timedelta

from django.db import models
from django.contrib.auth.models import User
from django.core.validators import MinValueValidator
from django.utils import timezone
import uuid


class Department(models.TextChoices):
    """Department choices for employees and assignments"""
    PM = 'PM', 'Project Manager'
    MED = 'MED', 'Mechanical Design'
    HD = 'HD', 'Hardware Design'
    MFG = 'MFG', 'Manufacturing'
    BUILD = 'BUILD', 'Assembly'
    PRG = 'PRG', 'Programming PLC'
    PURCHASING = 'PURCHASING', 'Purchasing'


class UserDepartment(models.TextChoices):
    """Department choices for user registration/permissions"""
    PM = 'PM', 'Project Manager'
    MED = 'MED', 'Mechanical Design'
    HD = 'HD', 'Hardware Design'
    MFG = 'MFG', 'Manufacturing'
    BUILD = 'BUILD', 'Assembly'
    PRG = 'PRG', 'Programming PLC'
    PURCHASING = 'PURCHASING', 'Purchasing'
    OTHER = 'OTHER', 'Other'


class OtherDepartment(models.TextChoices):
    """Sub-departments for users registered under OTHER"""
    OPERATIONS = 'OPERATIONS', 'Operations'
    FINANCE = 'FINANCE', 'Finance'
    HUMAN_RESOURCES = 'HUMAN_RESOURCES', 'Human Resources'
    BUSINESS_INTELLIGENCE = 'BUSINESS_INTELLIGENCE', 'Business Intelligence'
    HEAD_ENGINEERING = 'HEAD_ENGINEERING', 'Head Engineering'


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
    hire_date = models.DateField(null=True, blank=True, help_text="Fecha de alta: date the employee started working with us")
    termination_date = models.DateField(null=True, blank=True, help_text="Fecha de baja: date the employee stopped working with us")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['department', 'name']
        indexes = [
            models.Index(fields=['department']),
            models.Index(fields=['is_active']),
        ]

    def save(self, *args, **kwargs):
        # A termination date that has already passed always wins: the employee is no
        # longer active. We never flip is_active back to True automatically (e.g. if
        # termination_date is cleared or in the future) so a manual deactivation made
        # elsewhere (admin, etc.) without a termination date isn't silently undone.
        if self.termination_date and self.termination_date <= timezone.now().date():
            self.is_active = False
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} ({self.department})"


class Project(models.Model):
    """Project model"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project_number = models.CharField(
        max_length=30,
        null=True,
        blank=True,
        unique=True,
        db_index=True,
        help_text="Canonical project number/code (e.g. '3268' or '3268-CO01' for a change order treated as its own project). Used to reliably match external reports (e.g. Finance actuals) to this project.",
    )
    name = models.CharField(max_length=255)
    client = models.CharField(max_length=255)
    start_date = models.DateField()
    end_date = models.DateField()
    facility = models.CharField(max_length=10, choices=Facility.choices)
    number_of_weeks = models.IntegerField(validators=[MinValueValidator(1)])
    project_manager = models.ForeignKey(Employee, null=True, blank=True, on_delete=models.SET_NULL, related_name='managed_projects')
    visible_in_departments = models.JSONField(default=list, blank=True, help_text="Departments where this project is visible (for quick-created projects)")
    is_high_probability = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Marks projects with high execution probability for visual prioritization.",
    )
    is_hidden = models.BooleanField(default=False, db_index=True, help_text="Soft-delete flag. Hidden projects are excluded from active UI lists.")
    hidden_at = models.DateTimeField(null=True, blank=True, help_text="Timestamp when project was hidden via soft delete.")
    is_closed = models.BooleanField(default=False, db_index=True, help_text="Marks project as closed/completed. Closed projects are hidden from Capacity Matrix by default.")
    closed_at = models.DateTimeField(null=True, blank=True, help_text="Timestamp when project was marked as closed.")
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
    change_order = models.ForeignKey(
        'ProjectChangeOrder',
        on_delete=models.SET_NULL,
        related_name='assignments',
        null=True,
        blank=True,
        help_text="Optional Change Order this assignment belongs to"
    )
    week_start_date = models.DateField(help_text="Start date of the week (ISO format YYYY-MM-DD)")
    hours = models.FloatField(validators=[MinValueValidator(0)], help_text="Total hours allocated")
    scio_hours = models.FloatField(null=True, blank=True, validators=[MinValueValidator(0)], help_text="Internal SCIO hours (BUILD/PRG only)")
    external_hours = models.FloatField(null=True, blank=True, validators=[MinValueValidator(0)], help_text="External/subcontracted hours (BUILD/PRG only)")
    stage = models.CharField(max_length=50, choices=Stage.choices, null=True, blank=True)
    comment = models.TextField(blank=True, help_text="Optional comment for this assignment")
    department_override = models.CharField(
        max_length=10,
        choices=Department.choices,
        null=True,
        blank=True,
        help_text=(
            "Optional override for which department this assignment's hours count against, "
            "used when the employee is temporarily supporting a department other than their "
            "own (e.g. an HD engineer covering BUILD for a week). Leave empty to use the "
            "employee's home department (Employee.department) — the default, backward-compatible "
            "behavior."
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def effective_department(self):
        """The department this assignment's hours should be counted against."""
        return self.department_override or (self.employee.department if self.employee_id else None)

    class Meta:
        ordering = ['week_start_date', 'employee']
        unique_together = ['employee', 'project', 'week_start_date']
        indexes = [
            models.Index(fields=['week_start_date']),
            models.Index(fields=['employee', 'week_start_date']),
        ]

    def __str__(self):
        return f"{self.employee.name} - {self.project.name} ({self.week_start_date})"


class TimeEntryType(models.TextChoices):
    """What a DailyTimeEntry's hours were spent on."""
    PROJECT = 'PROJECT', 'Project Work'
    OIL = 'OIL', 'Project Issue Resolution'
    INDIRECT = 'IND', 'Indirect Time'
    VACATION = 'VAC', 'Vacation'


class DailyTimeEntry(models.Model):
    """
    Daily actuals log: how many hours an employee spent, on a given calendar day,
    on a specific project (PROJECT), resolving issues for a project (OIL), on
    non-project indirect work (IND), or on vacation (VAC).

    This is a separate, finer-grained "what actually happened" record from the
    weekly Assignment/Capacity Matrix, which is used for planning. An employee can
    have several entries on the same day (e.g. half day on one project, half day
    of OIL on another).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='daily_time_entries')
    date = models.DateField(help_text="The specific calendar day this entry is for")
    entry_type = models.CharField(max_length=10, choices=TimeEntryType.choices)
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='daily_time_entries',
        help_text="Required for PROJECT and OIL entries (which project the hours belong to). Must be empty for IND/VAC.",
    )
    hours = models.FloatField(validators=[MinValueValidator(0)])
    comment = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['date', 'employee']
        unique_together = ['employee', 'date', 'entry_type', 'project']
        indexes = [
            models.Index(fields=['date']),
            models.Index(fields=['employee', 'date']),
            models.Index(fields=['project']),
        ]

    def clean(self):
        from django.core.exceptions import ValidationError as DjangoValidationError

        requires_project = self.entry_type in (TimeEntryType.PROJECT, TimeEntryType.OIL)
        if requires_project and not self.project_id:
            raise DjangoValidationError({'project': f'{self.entry_type} entries must specify a project.'})
        if not requires_project and self.project_id:
            raise DjangoValidationError({'project': f'{self.entry_type} entries must not specify a project.'})

    def __str__(self):
        project_part = f" ({self.project.name})" if self.project_id else ""
        return f"{self.employee.name} - {self.date} - {self.entry_type}{project_part}: {self.hours}h"


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


class ProjectChangeOrder(models.Model):
    """Change order quoted hours per project and department"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='change_orders')
    department = models.CharField(max_length=10, choices=Department.choices)
    name = models.CharField(max_length=50, help_text="Change order name (e.g., CO01)")
    hours_quoted = models.FloatField(validators=[MinValueValidator(0)], help_text="Quoted hours for this change order")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['project', 'department', 'name']
        unique_together = ['project', 'department', 'name']

    def __str__(self):
        return f"{self.project.name} - {self.department} - {self.name}"


class ScioTeamCapacity(models.Model):
    """SCIO Team capacity per department and week"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    department = models.CharField(max_length=10, choices=Department.choices)
    week_start_date = models.DateField(help_text="Start date of the week (ISO format YYYY-MM-DD)")
    capacity = models.FloatField(validators=[MinValueValidator(0)], help_text="SCIO team capacity for this week")
    pto = models.FloatField(
        default=0,
        validators=[MinValueValidator(0)],
        help_text="PTO adjustment to subtract from SCIO team capacity for this week",
    )
    training = models.FloatField(
        default=0,
        validators=[MinValueValidator(0)],
        help_text="Training adjustment to subtract from SCIO team capacity for this week",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['department', 'week_start_date']
        indexes = [
            models.Index(fields=['department', 'week_start_date']),
        ]
        unique_together = ['department', 'week_start_date']

    def __str__(self):
        return f"{self.department} - {self.week_start_date}: cap={self.capacity}, pto={self.pto}, training={self.training}"


class ScioHeadcountEvent(models.Model):
    """
    A hire or departure event for a department's SCIO Team Members headcount.

    This is a ledger, not a snapshot: instead of a manager typing the SCIO Team
    Members number into every week of the Capacity Matrix by hand, they log
    "+1 as of March 10" or "-2 as of June 1" here (with a free-text comment for
    context, e.g. who/why). Saving an event recomputes the cumulative headcount
    and bulk-writes ScioTeamCapacity.capacity for every week from the earliest
    event's week forward, overwriting whatever was there before (see
    recompute_scio_capacity_from_events). PTO/training stay untouched and
    remain manually edited per week, independent of this ledger.

    Deliberately not linked to Employee: this tracks an anonymous headcount
    delta, not named individuals (Employee/Assignment already cover per-person
    project staffing separately).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    department = models.CharField(max_length=10, choices=Department.choices)
    effective_date = models.DateField(help_text="Calendar date the headcount change takes effect")
    delta = models.FloatField(help_text="Signed headcount change, e.g. +1 for a hire, -2 for two departures")
    comment = models.TextField(blank=True, help_text="Optional context, e.g. who joined/left and why")
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='scio_headcount_events')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['department', 'effective_date']
        indexes = [
            models.Index(fields=['department', 'effective_date']),
        ]

    def __str__(self):
        sign = '+' if self.delta >= 0 else ''
        return f"{self.department} - {self.effective_date}: {sign}{self.delta}"


class SubcontractedTeamCapacity(models.Model):
    """Subcontracted team capacity per company and week (BUILD department only)"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.CharField(max_length=100, help_text="Company name (e.g., AMI, VICER, ITAX, etc.)")
    week_start_date = models.DateField(help_text="Start date of the week (ISO format YYYY-MM-DD)")
    capacity = models.FloatField(validators=[MinValueValidator(0)], help_text="Number of personnel from this company")
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
    capacity = models.FloatField(validators=[MinValueValidator(0)], help_text="Number of personnel from this team")
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


class ProjectDepartmentWeeklyActual(models.Model):
    """
    Real historical hours per project/department/week, sourced from an external
    Finance report (a cumulative WIP export) rather than from individual Employee
    Assignment records. Finance reports don't break hours down by person, only by
    project and department, so this is intentionally separate from Assignment.

    Weeks covered by this table are treated as closed/locked: the Capacity Matrix
    reads "Used" hours for past weeks from here instead of from Assignment, and the
    UI/API block manual edits to those weeks (see AssignmentViewSet week-lock check).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='weekly_actuals')
    department = models.CharField(max_length=15, choices=Department.choices)
    week_start_date = models.DateField(help_text="Start date of the week (ISO format YYYY-MM-DD)")
    hours = models.FloatField(help_text="Hours worked this week, per the Finance report diff. Can be negative when Finance issues a correction.")
    source_import = models.ForeignKey(
        'FinanceImportLog',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='actuals',
        help_text="The import run that most recently wrote this row",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['project', 'department', 'week_start_date']
        unique_together = ['project', 'department', 'week_start_date']
        indexes = [
            models.Index(fields=['department', 'week_start_date']),
            models.Index(fields=['project', 'department']),
        ]

    def __str__(self):
        return f"{self.project.project_number or self.project.name} - {self.department} - {self.week_start_date}: {self.hours}h"


class FinanceJobCumulative(models.Model):
    """
    Tracks the last cumulative hours value seen for a raw Finance report Job code
    per department column, so the next import can compute a week-over-week diff
    without needing the full report history re-uploaded every time.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job_code = models.CharField(max_length=30, help_text="Raw Job code as it appears in the Finance report, e.g. '3268-A'")
    department = models.CharField(max_length=15, choices=Department.choices)
    cumulative_hours = models.FloatField(default=0, help_text="Last known cumulative hours reported for this job/department")
    last_report_date = models.DateField(help_text="Report date this cumulative value came from")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['job_code', 'department']
        unique_together = ['job_code', 'department']

    def __str__(self):
        return f"{self.job_code} - {self.department}: {self.cumulative_hours}h as of {self.last_report_date}"


class FinanceImportLog(models.Model):
    """Audit trail for each Finance actuals report uploaded."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    file_name = models.CharField(max_length=255, blank=True)
    report_dates_processed = models.JSONField(default=list, blank=True, help_text="List of report dates (ISO) found in the uploaded file")
    new_projects_created = models.JSONField(default=list, blank=True, help_text="Project numbers auto-created by this import")
    weekly_actuals_written = models.IntegerField(default=0)
    job_codes_seeded_only = models.JSONField(default=list, blank=True, help_text="Job codes seen for the first time this run (baseline only, no diff created)")
    warnings = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Finance import {self.created_at} ({self.weekly_actuals_written} weekly rows)"


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


class UserProfile(models.Model):
    """Stores department metadata and access scope for a user."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    department = models.CharField(max_length=20, choices=UserDepartment.choices)
    other_department = models.CharField(max_length=50, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['department', 'user__username']
        indexes = [
            models.Index(fields=['department']),
        ]

    def __str__(self):
        other = f" ({self.other_department})" if self.other_department else ""
        return f"{self.user.username} - {self.department}{other}"
