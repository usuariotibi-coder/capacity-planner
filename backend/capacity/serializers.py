"""
Serializers for Team Capacity Planner

This module defines all serializers for the Team Capacity Planner API.
It includes serializers for employees, projects, assignments, departments,
budgets, and activity logs with proper validation and nested relationships.
"""

from rest_framework import serializers
from django.contrib.auth.models import User
from django.utils import timezone
from .models import (
    Employee,
    Project,
    Assignment,
    DepartmentStageConfig,
    ProjectBudget,
    ActivityLog,
    Department,
    Facility,
    Stage,
    SubcontractCompany,
    ScioTeamCapacity,
    SubcontractedTeamCapacity,
    PrgExternalTeamCapacity,
    DepartmentWeeklyTotal,
)


class UserSerializer(serializers.ModelSerializer):
    """
    Serializer for Django User model.
    Used for user information in related serializers.
    """

    class Meta:
        model = User
        fields = ('id', 'username', 'first_name', 'last_name', 'email')
        read_only_fields = ('id',)


class UserRegistrationSerializer(serializers.Serializer):
    """
    Serializer for user registration.

    Validates email domain, password strength, and creates user account
    with email verification requirement.
    """
    email = serializers.EmailField(required=True)
    password = serializers.CharField(
        write_only=True,
        required=True,
        style={'input_type': 'password'},
        min_length=8,
        help_text="Password must be at least 8 characters"
    )
    confirm_password = serializers.CharField(
        write_only=True,
        required=True,
        style={'input_type': 'password'},
        help_text="Must match password"
    )
    first_name = serializers.CharField(required=True, max_length=150)
    last_name = serializers.CharField(required=True, max_length=150)
    department = serializers.ChoiceField(
        choices=Department.choices,
        required=True,
        help_text="Employee department"
    )

    def validate_email(self, value):
        """
        Validate email domain and uniqueness.
        """
        from django.conf import settings

        # Check domain
        if not value.lower().endswith(settings.REGISTRATION_EMAIL_DOMAIN):
            raise serializers.ValidationError(
                f"Email must be from domain {settings.REGISTRATION_EMAIL_DOMAIN}"
            )

        # Check if email already exists
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError(
                "A user with this email already exists."
            )

        return value.lower()

    def validate_password(self, value):
        """
        Validate password using Django's password validators.
        """
        from django.contrib.auth.password_validation import validate_password

        # Use Django's built-in validators (configured in settings.py)
        try:
            validate_password(value)
        except serializers.ValidationError as e:
            raise serializers.ValidationError(str(e))
        return value

    def validate(self, data):
        """
        Validate password confirmation match.
        """
        if data['password'] != data['confirm_password']:
            raise serializers.ValidationError({
                "confirm_password": "Passwords do not match."
            })

        return data

    def create(self, validated_data):
        """
        Create inactive user and send verification email.
        Assign basic permissions for viewing and modifying employees, projects, and assignments.

        Email sending is decoupled from user creation - if email fails, user is still created
        but can retry sending via the resend endpoint.
        """
        from django.contrib.auth.models import Permission
        import secrets
        # Remove confirm_password from data
        validated_data.pop('confirm_password')

        # Extract department (stored as metadata, not used for Employee creation)
        department = validated_data.pop('department')

        # Create ACTIVE user (no email verification required)
        # Domain validation (@na.scio-automation.com) ensures only company employees can register
        user = User.objects.create_user(
            username=validated_data['email'],
            email=validated_data['email'],
            first_name=validated_data['first_name'],
            last_name=validated_data['last_name'],
            password=validated_data['password'],
            is_active=True  # User is active immediately
        )

        # Assign basic permissions: view and change for employees, projects, and assignments
        permissions = Permission.objects.filter(
            codename__in=[
                'view_employee', 'change_employee', 'add_employee',
                'view_project', 'change_project', 'add_project',
                'view_assignment', 'change_assignment', 'add_assignment',
                'view_projectbudget', 'change_projectbudget', 'add_projectbudget',
            ]
        )
        user.user_permissions.set(permissions)

        print(f"[REGISTER] User {user.email} created and activated successfully")

        return user

    def _send_verification_code_email(self, user, code):
        """
        Send 6-digit verification code to user via SendGrid API.
        """
        from django.conf import settings
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail

        sendgrid_api_key = getattr(settings, 'SENDGRID_API_KEY', None)
        from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', None)

        print(f"[SENDGRID] API Key: {'SET (' + sendgrid_api_key[:10] + '...)' if sendgrid_api_key else 'NOT SET'}")
        print(f"[SENDGRID] From Email: {from_email}")
        print(f"[SENDGRID] To Email: {user.email}")

        if not sendgrid_api_key:
            print(f"[SENDGRID] ERROR: API key not configured!")
            return

        if not from_email:
            print(f"[SENDGRID] ERROR: FROM email not configured!")
            return

        subject = "Your verification code - Team Capacity Planner"

        html_content = f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Team Capacity Planner</h2>
            <p>Hello {user.first_name},</p>
            <p>Your verification code is:</p>
            <div style="background-color: #f3f4f6; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1f2937;">{code}</span>
            </div>
            <p>Enter this code in the registration page to verify your email address.</p>
            <p style="color: #6b7280; font-size: 14px;">This code expires in 15 minutes.</p>
            <p style="color: #6b7280; font-size: 14px;">If you didn't request this code, please ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            <p style="color: #9ca3af; font-size: 12px;">Team Capacity Planner</p>
        </div>
        """

        text_content = f"""Hello {user.first_name},

Your verification code is: {code}

Enter this code in the registration page to verify your email address.

This code expires in 15 minutes.

If you didn't request this code, please ignore this email.

- Team Capacity Planner"""

        message = Mail(
            from_email=from_email,
            to_emails=user.email,
            subject=subject,
            plain_text_content=text_content,
            html_content=html_content
        )

        print(f"[SENDGRID] Sending email...")
        sg = SendGridAPIClient(sendgrid_api_key)
        response = sg.send(message)
        print(f"[SENDGRID] Response status: {response.status_code}")


class EmployeeSerializer(serializers.ModelSerializer):
    """
    Serializer for Employee model.

    Provides basic employee information including department, capacity,
    and active status. Includes validation for employee data.
    """

    user = UserSerializer(read_only=True)
    user_id = serializers.IntegerField(
        write_only=True,
        required=False,
        allow_null=True,
        help_text="User ID to associate with employee"
    )
    department_display = serializers.CharField(
        source='get_department_display',
        read_only=True,
        help_text="Human-readable department name"
    )

    class Meta:
        model = Employee
        fields = (
            'id',
            'user',
            'user_id',
            'name',
            'role',
            'department',
            'department_display',
            'capacity',
            'is_active',
            'is_subcontracted_material',
            'subcontract_company',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('id', 'created_at', 'updated_at')
        extra_kwargs = {
            'is_subcontracted_material': {'required': False, 'default': False},
            'subcontract_company': {'required': False, 'allow_blank': True, 'allow_null': True},
            'is_active': {'required': False, 'default': True},
        }

    def validate_capacity(self, value):
        """
        Validate that capacity is a non-negative number.

        Args:
            value: The capacity value to validate

        Returns:
            The validated capacity value

        Raises:
            ValidationError: If capacity is negative
        """
        if value < 0:
            raise serializers.ValidationError(
                "Capacity cannot be negative."
            )
        if value > 168:  # Maximum hours in a week
            raise serializers.ValidationError(
                "Capacity cannot exceed 168 hours per week."
            )
        return value

    def validate_subcontract_company(self, value):
        """
        Validate subcontract company field.
        Accepts any text value for flexible team/company names.

        Args:
            value: The subcontract company value

        Returns:
            The validated value (or empty string if None)
        """
        return value or ''

    def validate_department(self, value):
        """
        Validate department selection.

        Args:
            value: The department value

        Returns:
            The validated department value

        Raises:
            ValidationError: If invalid department
        """
        valid_departments = [dept[0] for dept in Department.choices]
        if value not in valid_departments:
            raise serializers.ValidationError(
                f"Invalid department. Must be one of: {', '.join(valid_departments)}"
            )
        return value

    def create(self, validated_data):
        """
        Create a new employee instance.

        Args:
            validated_data: Validated data from serializer

        Returns:
            Created Employee instance
        """
        user_id = validated_data.pop('user_id', None)
        if user_id:
            try:
                validated_data['user_id'] = user_id
            except User.DoesNotExist:
                raise serializers.ValidationError(
                    {"user_id": "User with this ID does not exist."}
                )
        return super().create(validated_data)

    def update(self, instance, validated_data):
        """
        Update an existing employee instance.

        Args:
            instance: The employee instance to update
            validated_data: Validated data from serializer

        Returns:
            Updated Employee instance
        """
        validated_data.pop('user_id', None)
        return super().update(instance, validated_data)


class ProjectSerializer(serializers.ModelSerializer):
    """
    Serializer for Project model.

    Includes project details with related manager information
    and basic statistics. Handles complex relationships with
    departments and assignments.
    """

    project_manager = EmployeeSerializer(read_only=True)
    project_manager_id = serializers.SerializerMethodField(
        help_text="UUID of project manager employee"
    )
    facility_display = serializers.CharField(
        source='get_facility_display',
        read_only=True,
        help_text="Human-readable facility name"
    )
    assignment_count = serializers.SerializerMethodField(
        help_text="Total number of assignments for this project"
    )
    active_assignments = serializers.SerializerMethodField(
        help_text="Number of assignments in current week"
    )
    department_stages = serializers.SerializerMethodField(
        help_text="Department stages as Record<Department, DepartmentStageConfig[]>"
    )
    department_hours_allocated = serializers.SerializerMethodField(
        help_text="Budget hours per department as Record<Department, number>"
    )
    department_hours_utilized = serializers.SerializerMethodField(
        help_text="Utilized hours per department as Record<Department, number>"
    )
    department_hours_forecast = serializers.SerializerMethodField(
        help_text="Forecast hours per department as Record<Department, number>"
    )
    visible_in_departments = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        default=list,
        help_text="Departments where this project is visible"
    )

    class Meta:
        model = Project
        fields = (
            'id',
            'name',
            'client',
            'start_date',
            'end_date',
            'facility',
            'facility_display',
            'number_of_weeks',
            'project_manager',
            'project_manager_id',
            'assignment_count',
            'active_assignments',
            'department_stages',
            'department_hours_allocated',
            'department_hours_utilized',
            'department_hours_forecast',
            'visible_in_departments',
            'created_at',
            'updated_at',
        )
        read_only_fields = (
            'id', 'created_at', 'updated_at', 'assignment_count',
            'active_assignments', 'department_stages',
            'department_hours_allocated', 'department_hours_utilized',
            'department_hours_forecast', 'project_manager_id'
        )

    def get_project_manager_id(self, obj):
        """
        Get project manager ID as string.

        Args:
            obj: The Project instance

        Returns:
            UUID string of project manager or None
        """
        return str(obj.project_manager.id) if obj.project_manager else None

    def get_assignment_count(self, obj):
        """
        Get total number of assignments for the project.

        Args:
            obj: The Project instance

        Returns:
            Total count of assignments
        """
        return obj.assignments.count()

    def get_active_assignments(self, obj):
        """
        Get number of assignments in the current week.

        Args:
            obj: The Project instance

        Returns:
            Count of assignments in current week
        """
        from datetime import datetime, timedelta
        today = datetime.now().date()
        week_start = today - timedelta(days=today.weekday())
        return obj.assignments.filter(week_start_date=week_start).count()

    def get_department_stages(self, obj):
        """
        Get department stages as Record<Department, DepartmentStageConfig[]>.
        Groups DepartmentStageConfig by department.

        Args:
            obj: The Project instance

        Returns:
            Dict with department keys and list of stage configs as values
        """
        result = {}
        for config in obj.department_stages.all():
            dept = config.department
            if dept not in result:
                result[dept] = []
            result[dept].append({
                'stage': config.stage,
                'weekStart': config.week_start,
                'weekEnd': config.week_end,
                'departmentStartDate': config.department_start_date.isoformat() if config.department_start_date else None,
                'durationWeeks': config.duration_weeks or (config.week_end - config.week_start + 1),
            })
        return result

    def get_department_hours_allocated(self, obj):
        """
        Get allocated budget hours per department as Record<Department, number>.

        Args:
            obj: The Project instance

        Returns:
            Dict with department keys and allocated hours as values
        """
        result = {}
        for budget in obj.budgets.all():
            result[budget.department] = budget.hours_allocated
        return result

    def get_department_hours_utilized(self, obj):
        """
        Get utilized hours per department as Record<Department, number>.

        Args:
            obj: The Project instance

        Returns:
            Dict with department keys and utilized hours as values
        """
        result = {}
        for budget in obj.budgets.all():
            result[budget.department] = budget.hours_utilized
        return result

    def get_department_hours_forecast(self, obj):
        """
        Get forecast hours per department as Record<Department, number>.

        Args:
            obj: The Project instance

        Returns:
            Dict with department keys and forecast hours as values
        """
        result = {}
        for budget in obj.budgets.all():
            result[budget.department] = budget.hours_forecast
        return result

    def validate(self, data):
        """
        Validate project data.
        Ensures end_date is after start_date.

        Args:
            data: Data dictionary from serializer

        Returns:
            Validated data

        Raises:
            ValidationError: If dates are invalid
        """
        start_date = data.get('start_date')
        end_date = data.get('end_date')

        if start_date and end_date and start_date >= end_date:
            raise serializers.ValidationError(
                {"end_date": "End date must be after start date."}
            )
        return data

    def validate_number_of_weeks(self, value):
        """
        Validate number of weeks.

        Args:
            value: The number of weeks value

        Returns:
            The validated value

        Raises:
            ValidationError: If weeks is invalid
        """
        if value < 1:
            raise serializers.ValidationError(
                "Number of weeks must be at least 1."
            )
        if value > 260:  # Max 5 years
            raise serializers.ValidationError(
                "Number of weeks cannot exceed 260 (5 years)."
            )
        return value

    def create(self, validated_data):
        """
        Create a new project instance.

        Args:
            validated_data: Validated data from serializer

        Returns:
            Created Project instance
        """
        # Get project_manager_id from initial_data since it's not in validated_data
        manager_id = self.initial_data.get('project_manager_id')
        if manager_id:
            try:
                validated_data['project_manager_id'] = manager_id
            except Employee.DoesNotExist:
                raise serializers.ValidationError(
                    {"project_manager_id": "Employee with this ID does not exist."}
                )

        project = super().create(validated_data)

        # Process department_stages if provided
        department_stages = self.initial_data.get('department_stages')
        if department_stages and isinstance(department_stages, dict):
            self._save_department_stages(project, department_stages)

        # Process department_hours_allocated if provided
        department_hours = self.initial_data.get('department_hours_allocated')
        if department_hours and isinstance(department_hours, dict):
            self._save_department_budgets(project, department_hours)

        return project

    def _save_department_stages(self, project, department_stages):
        """
        Save department stage configurations for a project.

        Args:
            project: The Project instance
            department_stages: Dict with department keys and list of stage configs
        """
        # Delete existing department stages for this project
        project.department_stages.all().delete()

        for dept, stages in department_stages.items():
            if not stages or not isinstance(stages, list):
                continue

            for stage_config in stages:
                if not isinstance(stage_config, dict):
                    continue

                # Get week_start and week_end (required)
                week_start = stage_config.get('weekStart') or stage_config.get('week_start')
                week_end = stage_config.get('weekEnd') or stage_config.get('week_end')

                if not week_start or not week_end:
                    continue

                # Get optional fields
                stage = stage_config.get('stage')
                dept_start_date = stage_config.get('departmentStartDate') or stage_config.get('department_start_date')
                duration_weeks = stage_config.get('durationWeeks') or stage_config.get('duration_weeks')

                DepartmentStageConfig.objects.create(
                    project=project,
                    department=dept,
                    stage=stage if stage else None,
                    week_start=week_start,
                    week_end=week_end,
                    department_start_date=dept_start_date if dept_start_date else None,
                    duration_weeks=duration_weeks if duration_weeks else None,
                )

    def _save_department_budgets(self, project, department_hours):
        """
        Save department budget allocations for a project.

        Args:
            project: The Project instance
            department_hours: Dict with department keys and hours values
        """
        for dept, hours in department_hours.items():
            if hours is None:
                hours = 0

            # Update or create budget for this department
            ProjectBudget.objects.update_or_create(
                project=project,
                department=dept,
                defaults={'hours_allocated': float(hours)}
            )

    def update(self, instance, validated_data):
        """
        Update an existing project instance.

        Args:
            instance: The project instance to update
            validated_data: Validated data from serializer

        Returns:
            Updated Project instance
        """
        # Get project_manager_id from initial_data since it's not in validated_data
        manager_id = self.initial_data.get('project_manager_id')
        if manager_id is not None:
            try:
                validated_data['project_manager_id'] = manager_id
            except Employee.DoesNotExist:
                raise serializers.ValidationError(
                    {"project_manager_id": "Employee with this ID does not exist."}
                )

        project = super().update(instance, validated_data)

        # Process department_stages if provided
        department_stages = self.initial_data.get('department_stages')
        if department_stages and isinstance(department_stages, dict):
            self._save_department_stages(project, department_stages)

        # Process department_hours_allocated if provided
        department_hours = self.initial_data.get('department_hours_allocated')
        if department_hours and isinstance(department_hours, dict):
            self._save_department_budgets(project, department_hours)

        return project


class AssignmentSerializer(serializers.ModelSerializer):
    """
    Serializer for Assignment model.

    Handles employee-project assignments with hours tracking.
    Includes validation for hours allocation and related data.
    Supports both READ and WRITE operations with appropriate
    read-only fields.
    """

    employee = EmployeeSerializer(read_only=True)
    employee_id = serializers.SerializerMethodField(
        help_text="UUID of the employee"
    )
    project = ProjectSerializer(read_only=True)
    project_id = serializers.SerializerMethodField(
        help_text="UUID of the project"
    )
    stage_display = serializers.CharField(
        source='get_stage_display',
        read_only=True,
        required=False,
        help_text="Human-readable stage name"
    )
    employee_capacity = serializers.SerializerMethodField(
        help_text="Employee's total capacity (hours per week)"
    )
    week_number = serializers.SerializerMethodField(
        help_text="ISO week number for the assignment week"
    )
    total_hours = serializers.SerializerMethodField(
        help_text="Total hours (scio + external)"
    )

    class Meta:
        model = Assignment
        fields = (
            'id',
            'employee',
            'employee_id',
            'project',
            'project_id',
            'week_start_date',
            'week_number',
            'hours',
            'scio_hours',
            'external_hours',
            'total_hours',
            'stage',
            'stage_display',
            'comment',
            'employee_capacity',
            'created_at',
            'updated_at',
        )
        read_only_fields = (
            'id',
            'created_at',
            'updated_at',
            'employee_capacity',
            'week_number',
            'total_hours',
            'stage_display',
            'employee_id',
            'project_id',
        )

    def get_employee_id(self, obj):
        """
        Get employee ID as string.

        Args:
            obj: The Assignment instance

        Returns:
            UUID string of employee
        """
        return str(obj.employee.id) if obj.employee else None

    def get_project_id(self, obj):
        """
        Get project ID as string.

        Args:
            obj: The Assignment instance

        Returns:
            UUID string of project
        """
        return str(obj.project.id) if obj.project else None

    def get_employee_capacity(self, obj):
        """
        Get the employee's total capacity.

        Args:
            obj: The Assignment instance

        Returns:
            Employee's capacity in hours per week
        """
        return obj.employee.capacity if obj.employee else None

    def get_week_number(self, obj):
        """
        Get ISO week number for the assignment.

        Args:
            obj: The Assignment instance

        Returns:
            ISO week number (1-53)
        """
        return obj.week_start_date.isocalendar()[1]

    def get_total_hours(self, obj):
        """
        Calculate total hours from scio and external hours.
        Falls back to main hours field if breakdown not available.

        Args:
            obj: The Assignment instance

        Returns:
            Total hours allocated
        """
        if obj.scio_hours is not None and obj.external_hours is not None:
            return obj.scio_hours + obj.external_hours
        return obj.hours

    def validate(self, data):
        """
        Validate assignment data.
        Ensures hours allocation is consistent and valid.

        Args:
            data: Data dictionary from serializer

        Returns:
            Validated data

        Raises:
            ValidationError: If data is invalid
        """
        hours = data.get('hours')
        scio_hours = data.get('scio_hours')
        external_hours = data.get('external_hours')

        # If scio_hours and external_hours are both provided,
        # their sum should equal total hours
        if scio_hours is not None and external_hours is not None:
            total = scio_hours + external_hours
            if hours != total:
                raise serializers.ValidationError(
                    {
                        "hours": (
                            f"Total hours ({hours}) must equal "
                            f"scio_hours ({scio_hours}) + "
                            f"external_hours ({external_hours})"
                        )
                    }
                )

        return data

    def validate_hours(self, value):
        """
        Validate total hours allocation.

        Args:
            value: The hours value

        Returns:
            The validated value

        Raises:
            ValidationError: If hours is invalid
        """
        if value < 0:
            raise serializers.ValidationError(
                "Hours cannot be negative."
            )
        # No maximum hours limit - allow any positive value for flexibility
        return value

    def validate_scio_hours(self, value):
        """
        Validate SCIO hours (internal hours).

        Args:
            value: The scio_hours value

        Returns:
            The validated value
        """
        if value is not None and value < 0:
            raise serializers.ValidationError(
                "SCIO hours cannot be negative."
            )
        return value

    def validate_external_hours(self, value):
        """
        Validate external/subcontracted hours.

        Args:
            value: The external_hours value

        Returns:
            The validated value
        """
        if value is not None and value < 0:
            raise serializers.ValidationError(
                "External hours cannot be negative."
            )
        return value

    def validate_week_start_date(self, value):
        """
        Validate week start date.
        Should be a Monday (ISO week start).

        Args:
            value: The week_start_date value

        Returns:
            The validated value
        """
        # ISO weekday: 1=Monday, 7=Sunday
        if value.weekday() != 0:  # 0 = Monday
            raise serializers.ValidationError(
                "Week start date must be a Monday."
            )
        return value

    def create(self, validated_data):
        """
        Create a new assignment instance.

        Args:
            validated_data: Validated data from serializer

        Returns:
            Created Assignment instance
        """
        # Get employee_id and project_id from initial_data
        employee_id = self.initial_data.get('employee_id')
        project_id = self.initial_data.get('project_id')

        if employee_id:
            validated_data['employee_id'] = employee_id
        if project_id:
            validated_data['project_id'] = project_id

        return super().create(validated_data)

    def update(self, instance, validated_data):
        """
        Update an existing assignment instance.

        Args:
            instance: The assignment instance to update
            validated_data: Validated data from serializer

        Returns:
            Updated Assignment instance
        """
        # Get employee_id and project_id from initial_data if provided
        employee_id = self.initial_data.get('employee_id')
        project_id = self.initial_data.get('project_id')

        if employee_id is not None:
            validated_data['employee_id'] = employee_id
        if project_id is not None:
            validated_data['project_id'] = project_id

        return super().update(instance, validated_data)


class DepartmentStageConfigSerializer(serializers.ModelSerializer):
    """
    Serializer for DepartmentStageConfig model.

    Manages department-specific stage configurations for projects.
    Includes validation for week ranges and date consistency.
    """

    project = ProjectSerializer(read_only=True)
    project_id = serializers.UUIDField(
        write_only=True,
        help_text="UUID of the project"
    )
    department_display = serializers.CharField(
        source='get_department_display',
        read_only=True,
        help_text="Human-readable department name"
    )
    stage_display = serializers.CharField(
        source='get_stage_display',
        read_only=True,
        required=False,
        help_text="Human-readable stage name"
    )
    duration_weeks = serializers.SerializerMethodField(
        help_text="Duration in weeks calculated from week_start to week_end"
    )

    class Meta:
        model = DepartmentStageConfig
        fields = (
            'id',
            'project',
            'project_id',
            'department',
            'department_display',
            'stage',
            'stage_display',
            'week_start',
            'week_end',
            'department_start_date',
            'duration_weeks',
            'created_at',
            'updated_at',
        )
        read_only_fields = (
            'id',
            'created_at',
            'updated_at',
            'department_display',
            'stage_display',
            'duration_weeks',
        )

    def get_duration_weeks(self, obj):
        """
        Calculate duration in weeks from week_start to week_end.

        Args:
            obj: The DepartmentStageConfig instance

        Returns:
            Duration in weeks (inclusive)
        """
        return obj.week_end - obj.week_start + 1

    def validate(self, data):
        """
        Validate department stage configuration.
        Ensures week ranges are valid and dates are consistent.

        Args:
            data: Data dictionary from serializer

        Returns:
            Validated data

        Raises:
            ValidationError: If data is invalid
        """
        week_start = data.get('week_start')
        week_end = data.get('week_end')
        department_start_date = data.get('department_start_date')
        duration_weeks = data.get('duration_weeks')

        # Validate week range
        if week_start and week_end and week_start > week_end:
            raise serializers.ValidationError(
                {
                    "week_end": (
                        "End week must be greater than or equal to start week."
                    )
                }
            )

        # Validate duration_weeks against week range
        if week_start and week_end and duration_weeks:
            calculated_duration = week_end - week_start + 1
            if duration_weeks != calculated_duration:
                raise serializers.ValidationError(
                    {
                        "duration_weeks": (
                            f"Duration weeks ({duration_weeks}) does not match "
                            f"calculated duration from week_start to "
                            f"week_end ({calculated_duration})"
                        )
                    }
                )

        return data

    def validate_week_start(self, value):
        """
        Validate week start number.

        Args:
            value: The week_start value

        Returns:
            The validated value

        Raises:
            ValidationError: If week number is invalid
        """
        if value < 1 or value > 53:
            raise serializers.ValidationError(
                "Week number must be between 1 and 53."
            )
        return value

    def validate_week_end(self, value):
        """
        Validate week end number.

        Args:
            value: The week_end value

        Returns:
            The validated value
        """
        if value < 1 or value > 53:
            raise serializers.ValidationError(
                "Week number must be between 1 and 53."
            )
        return value


class ProjectBudgetSerializer(serializers.ModelSerializer):
    """
    Serializer for ProjectBudget model.

    Handles budget tracking and utilization calculations.
    Provides read-only computed fields for analysis.
    """

    project = ProjectSerializer(read_only=True)
    project_id = serializers.UUIDField(
        write_only=True,
        help_text="UUID of the project"
    )
    department_display = serializers.CharField(
        source='get_department_display',
        read_only=True,
        help_text="Human-readable department name"
    )
    utilization_percent = serializers.SerializerMethodField(
        help_text="Utilization percentage (utilized + forecast / allocated * 100)"
    )
    available_hours = serializers.SerializerMethodField(
        help_text="Remaining available hours (allocated - utilized - forecast)"
    )
    budget_status = serializers.SerializerMethodField(
        help_text="Budget status: 'within', 'near', or 'exceeded'"
    )

    class Meta:
        model = ProjectBudget
        fields = (
            'id',
            'project',
            'project_id',
            'department',
            'department_display',
            'hours_allocated',
            'hours_utilized',
            'hours_forecast',
            'utilization_percent',
            'available_hours',
            'budget_status',
            'created_at',
            'updated_at',
        )
        read_only_fields = (
            'id',
            'created_at',
            'updated_at',
            'utilization_percent',
            'available_hours',
            'budget_status',
            'department_display',
        )

    def get_utilization_percent(self, obj):
        """
        Calculate utilization percentage.
        Formula: (utilized + forecast) / allocated * 100

        Args:
            obj: The ProjectBudget instance

        Returns:
            Utilization percentage (0-100+)
        """
        if obj.hours_allocated == 0:
            return 0
        total_used = obj.hours_utilized + obj.hours_forecast
        return round((total_used / obj.hours_allocated) * 100, 2)

    def get_available_hours(self, obj):
        """
        Calculate available/remaining hours.
        Formula: allocated - utilized - forecast

        Args:
            obj: The ProjectBudget instance

        Returns:
            Available hours (can be negative if over budget)
        """
        total_used = obj.hours_utilized + obj.hours_forecast
        available = obj.hours_allocated - total_used
        return round(available, 2)

    def get_budget_status(self, obj):
        """
        Determine budget status based on utilization.

        Returns budget status:
        - 'within': Less than 80% utilized
        - 'near': 80-100% utilized
        - 'exceeded': Over 100% utilized

        Args:
            obj: The ProjectBudget instance

        Returns:
            Status string: 'within', 'near', or 'exceeded'
        """
        utilization = self.get_utilization_percent(obj)
        if utilization >= 100:
            return 'exceeded'
        elif utilization >= 80:
            return 'near'
        else:
            return 'within'

    def validate_hours_allocated(self, value):
        """
        Validate allocated hours.

        Args:
            value: The hours_allocated value

        Returns:
            The validated value

        Raises:
            ValidationError: If hours is invalid
        """
        if value < 0:
            raise serializers.ValidationError(
                "Allocated hours cannot be negative."
            )
        return value

    def validate_hours_utilized(self, value):
        """
        Validate utilized hours.

        Args:
            value: The hours_utilized value

        Returns:
            The validated value
        """
        if value < 0:
            raise serializers.ValidationError(
                "Utilized hours cannot be negative."
            )
        return value

    def validate_hours_forecast(self, value):
        """
        Validate forecasted hours.

        Args:
            value: The hours_forecast value

        Returns:
            The validated value
        """
        if value < 0:
            raise serializers.ValidationError(
                "Forecast hours cannot be negative."
            )
        return value

    def validate(self, data):
        """
        Validate budget data consistency.

        Args:
            data: Data dictionary from serializer

        Returns:
            Validated data

        Raises:
            ValidationError: If data is inconsistent
        """
        hours_allocated = data.get('hours_allocated', self.instance.hours_allocated if self.instance else None)
        hours_utilized = data.get('hours_utilized', self.instance.hours_utilized if self.instance else 0)
        hours_forecast = data.get('hours_forecast', self.instance.hours_forecast if self.instance else 0)

        if hours_allocated is not None and hours_utilized + hours_forecast > hours_allocated * 1.5:
            raise serializers.ValidationError(
                {
                    "hours_utilized": (
                        "Combined utilized and forecast hours exceed "
                        "150% of allocated hours. Please review."
                    )
                }
            )

        return data


class ActivityLogSerializer(serializers.ModelSerializer):
    """
    Serializer for ActivityLog model.

    Provides audit trail information for tracking changes.
    Includes user and timestamp information for compliance.
    """

    user = UserSerializer(read_only=True)
    user_id = serializers.IntegerField(
        write_only=True,
        required=False,
        allow_null=True,
        help_text="User ID performing the action"
    )
    changes = serializers.JSONField(
        required=False,
        allow_null=True,
        help_text="JSON object describing changes made"
    )
    formatted_created_at = serializers.SerializerMethodField(
        help_text="Human-readable timestamp"
    )

    class Meta:
        model = ActivityLog
        fields = (
            'id',
            'user',
            'user_id',
            'action',
            'model_name',
            'object_id',
            'changes',
            'created_at',
            'formatted_created_at',
        )
        read_only_fields = (
            'id',
            'created_at',
            'user',
            'formatted_created_at',
        )

    def get_formatted_created_at(self, obj):
        """
        Get human-readable timestamp.
        Formats as ISO format with timezone information.

        Args:
            obj: The ActivityLog instance

        Returns:
            Formatted timestamp string
        """
        return obj.created_at.isoformat()

    def validate_action(self, value):
        """
        Validate action description.

        Args:
            value: The action value

        Returns:
            The validated value

        Raises:
            ValidationError: If action is invalid
        """
        valid_actions = ['created', 'updated', 'deleted', 'viewed']
        if value.lower() not in valid_actions:
            raise serializers.ValidationError(
                f"Action must be one of: {', '.join(valid_actions)}"
            )
        return value

    def validate_model_name(self, value):
        """
        Validate model name.
        Must correspond to an actual model.

        Args:
            value: The model_name value

        Returns:
            The validated value

        Raises:
            ValidationError: If model name is invalid
        """
        valid_models = [
            'Employee',
            'Project',
            'Assignment',
            'DepartmentStageConfig',
            'ProjectBudget',
            'ScioTeamCapacity',
            'SubcontractedTeamCapacity',
            'PrgExternalTeamCapacity',
            'DepartmentWeeklyTotal',
        ]
        if value not in valid_models:
            raise serializers.ValidationError(
                f"Model must be one of: {', '.join(valid_models)}"
            )
        return value

    def validate_object_id(self, value):
        """
        Validate object ID format.
        Should be a valid UUID string.

        Args:
            value: The object_id value

        Returns:
            The validated value

        Raises:
            ValidationError: If UUID format is invalid
        """
        import uuid
        try:
            uuid.UUID(value)
        except ValueError:
            raise serializers.ValidationError(
                "Object ID must be a valid UUID."
            )
        return value


class EmployeeDetailSerializer(EmployeeSerializer):
    """
    Extended serializer for Employee details.
    Includes related assignments and projects.
    Used for detailed employee views.
    """

    assignments = AssignmentSerializer(many=True, read_only=True)
    managed_projects = ProjectSerializer(many=True, read_only=True)
    total_capacity = serializers.SerializerMethodField()
    total_allocated = serializers.SerializerMethodField()
    utilization = serializers.SerializerMethodField()

    class Meta(EmployeeSerializer.Meta):
        fields = EmployeeSerializer.Meta.fields + (
            'assignments',
            'managed_projects',
            'total_capacity',
            'total_allocated',
            'utilization',
        )
        read_only_fields = EmployeeSerializer.Meta.read_only_fields + (
            'assignments',
            'managed_projects',
            'total_capacity',
            'total_allocated',
            'utilization',
        )

    def get_total_capacity(self, obj):
        """
        Get employee's total weekly capacity.

        Args:
            obj: The Employee instance

        Returns:
            Weekly capacity in hours
        """
        return obj.capacity

    def get_total_allocated(self, obj):
        """
        Get total hours allocated this week.

        Args:
            obj: The Employee instance

        Returns:
            Total allocated hours for current week
        """
        from datetime import datetime, timedelta
        today = datetime.now().date()
        week_start = today - timedelta(days=today.weekday())
        return sum(
            a.hours for a in obj.assignments.filter(week_start_date=week_start)
        )

    def get_utilization(self, obj):
        """
        Get current week utilization percentage.

        Args:
            obj: The Employee instance

        Returns:
            Utilization percentage
        """
        from datetime import datetime, timedelta
        today = datetime.now().date()
        week_start = today - timedelta(days=today.weekday())
        total_allocated = sum(
            a.hours for a in obj.assignments.filter(week_start_date=week_start)
        )
        if obj.capacity == 0:
            return 0
        return round((total_allocated / obj.capacity) * 100, 2)


class ProjectDetailSerializer(ProjectSerializer):
    """
    Extended serializer for Project details.
    Includes assignments, budgets, and department configurations.
    Used for detailed project views and comprehensive data.
    """

    assignments = AssignmentSerializer(many=True, read_only=True)
    budgets = ProjectBudgetSerializer(many=True, read_only=True)
    total_hours_allocated = serializers.SerializerMethodField()
    total_hours_utilized = serializers.SerializerMethodField()
    overall_utilization = serializers.SerializerMethodField()

    class Meta(ProjectSerializer.Meta):
        fields = ProjectSerializer.Meta.fields + (
            'assignments',
            'budgets',
            'total_hours_allocated',
            'total_hours_utilized',
            'overall_utilization',
        )
        read_only_fields = ProjectSerializer.Meta.read_only_fields + (
            'assignments',
            'budgets',
            'total_hours_allocated',
            'total_hours_utilized',
            'overall_utilization',
        )

    def get_total_hours_allocated(self, obj):
        """
        Get total allocated hours across all budgets.

        Args:
            obj: The Project instance

        Returns:
            Sum of all budget hours allocated
        """
        return sum(b.hours_allocated for b in obj.budgets.all())

    def get_total_hours_utilized(self, obj):
        """
        Get total utilized hours from budget tracking.

        Args:
            obj: The Project instance

        Returns:
            Total utilized hours across all departments
        """
        return sum(b.hours_utilized for b in obj.budgets.all())

    def get_overall_utilization(self, obj):
        """
        Get overall project utilization percentage.

        Args:
            obj: The Project instance

        Returns:
            Overall utilization percentage
        """
        total_allocated = sum(b.hours_allocated for b in obj.budgets.all())
        if total_allocated == 0:
            return 0
        total_used = sum(b.hours_utilized + b.hours_forecast for b in obj.budgets.all())
        return round((total_used / total_allocated) * 100, 2)


class ScioTeamCapacitySerializer(serializers.ModelSerializer):
    """
    Serializer for SCIO Team Capacity model.

    Represents team capacity per department and week.
    Unique validation is disabled here because the ViewSet handles upsert logic.
    """

    class Meta:
        model = ScioTeamCapacity
        fields = ('id', 'department', 'week_start_date', 'capacity', 'created_at', 'updated_at')
        read_only_fields = ('id', 'created_at', 'updated_at')

    def get_validators(self):
        """Remove unique_together validators to allow upsert behavior in ViewSet"""
        return []


class SubcontractedTeamCapacitySerializer(serializers.ModelSerializer):
    """
    Serializer for Subcontracted Team Capacity model.

    Represents subcontracted team capacity per company and week (BUILD department).
    Unique validation is disabled here because the ViewSet handles upsert logic.
    """

    class Meta:
        model = SubcontractedTeamCapacity
        fields = ('id', 'company', 'week_start_date', 'capacity', 'created_at', 'updated_at')
        read_only_fields = ('id', 'created_at', 'updated_at')

    def get_validators(self):
        """Remove unique_together validators to allow upsert behavior in ViewSet"""
        return []


class PrgExternalTeamCapacitySerializer(serializers.ModelSerializer):
    """
    Serializer for PRG External Team Capacity model.

    Represents external team capacity for PRG department per week.
    Unique validation is disabled here because the ViewSet handles upsert logic.
    """

    class Meta:
        model = PrgExternalTeamCapacity
        fields = ('id', 'team_name', 'week_start_date', 'capacity', 'created_at', 'updated_at')
        read_only_fields = ('id', 'created_at', 'updated_at')

    def get_validators(self):
        """Remove unique_together validators to allow upsert behavior in ViewSet"""
        return []


class DepartmentWeeklyTotalSerializer(serializers.ModelSerializer):
    """
    Serializer for Department Weekly Total model.

    Represents the total hours allocated per department and week (Weekly Occupancy).
    """

    class Meta:
        model = DepartmentWeeklyTotal
        fields = ('id', 'department', 'week_start_date', 'total_hours', 'created_at', 'updated_at')
        read_only_fields = ('id', 'created_at', 'updated_at')


class CaseInsensitiveTokenObtainPairSerializer(serializers.Serializer):
    """
    Custom serializer for token obtain that accepts case-insensitive username.

    This allows users to login with username in any case (e.g., MARCO.SOTO or marco.soto).
    Limits users to maximum 2 simultaneous sessions/devices.
    """
    username = serializers.CharField(required=True)
    password = serializers.CharField(required=True, write_only=True)

    def validate(self, attrs):
        from rest_framework_simplejwt.tokens import RefreshToken
        from django.contrib.auth import authenticate
        from capacity.models import UserSession

        username = attrs.get('username')
        password = attrs.get('password')

        # Try case-insensitive username lookup
        user = User.objects.filter(username__iexact=username).first()

        if user and user.check_password(password):
            try:
                # Check active sessions for this user (limit to 2)
                active_sessions = UserSession.objects.filter(user=user, is_active=True).count()

                if active_sessions >= 2:
                    # Reject login if user already has 2 active sessions
                    raise serializers.ValidationError(
                        'Máximo de dispositivos conectados alcanzado. Por favor, cierre sesión en otro dispositivo.'
                    )

                refresh = RefreshToken.for_user(user)
                # Add custom claims to the access token
                refresh['username'] = user.username
                refresh['email'] = user.email
                refresh['first_name'] = user.first_name
                refresh['last_name'] = user.last_name
                refresh.access_token['username'] = user.username
                refresh.access_token['email'] = user.email
                refresh.access_token['first_name'] = user.first_name
                refresh.access_token['last_name'] = user.last_name

                # Create a new session record (safely handle missing request context)
                try:
                    request = self.context.get('request')
                    if request:
                        device_info = {
                            'user_agent': request.META.get('HTTP_USER_AGENT', ''),
                            'ip_address': self.get_client_ip(request),
                        }
                    else:
                        device_info = {}
                except Exception:
                    device_info = {}

                UserSession.objects.create(
                    user=user,
                    refresh_token=str(refresh),
                    device_info=device_info,
                    is_active=True
                )

                attrs['refresh'] = str(refresh)
                attrs['access'] = str(refresh.access_token)
                attrs['user_id'] = user.id
                attrs['username'] = user.username
                attrs['email'] = user.email
                attrs['first_name'] = user.first_name
                attrs['last_name'] = user.last_name
                return attrs
            except serializers.ValidationError:
                # Re-raise validation errors (like max sessions reached)
                raise
            except Exception as e:
                # Log the error and return generic message
                print(f"Error during login: {str(e)}")
                raise serializers.ValidationError('Error al procesar el login. Por favor, intente nuevamente.')
        else:
            raise serializers.ValidationError('Credenciales inválidas')

    def get_client_ip(self, request):
        """Get client IP address from request"""
        if not request:
            return ''
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip
