"""
ViewSets for Team Capacity Planner API

This module provides comprehensive REST API endpoints for the Team Capacity Planner.
It includes custom permissions, filtering, pagination, and specialized actions for
capacity management, utilization tracking, and reporting.

Production-ready implementation with:
- Custom permission classes for role-based access control
- Advanced filtering, search, and ordering
- Pagination for large datasets
- Custom actions for reporting and analytics
- Activity logging for audit trail
- Comprehensive error handling
- Performance optimization with select_related and prefetch_related

Designed to handle 50+ concurrent users efficiently.

Version: 1.1.0 - Added upsert support for team capacity endpoints
"""

from datetime import datetime, timedelta
from functools import reduce
from operator import or_
import uuid
import logging

from django.contrib.auth.models import User
from django.db.models import (
    Q, Sum, Count, F, Value, Case, When, CharField, FloatField,
    Avg, Max, Min, ExpressionWrapper, Prefetch
)
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.conf import settings
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.permissions import (
    BasePermission, IsAuthenticated, IsAuthenticatedOrReadOnly,
    SAFE_METHODS
)
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from rest_framework.exceptions import ValidationError, PermissionDenied
from django_filters.rest_framework import DjangoFilterBackend

from .models import (
    Employee, Project, Assignment, DepartmentStageConfig,
    ProjectBudget, ProjectChangeOrder, ActivityLog, Department, Facility, Stage,
    ScioTeamCapacity, SubcontractedTeamCapacity, PrgExternalTeamCapacity,
    DepartmentWeeklyTotal, EmailVerification, UserDepartment, OtherDepartment
)
from .serializers import (
    EmployeeSerializer, EmployeeDetailSerializer,
    ProjectSerializer, ProjectDetailSerializer,
    AssignmentSerializer, AssignmentListSerializer, DepartmentStageConfigSerializer,
    ProjectBudgetSerializer, ProjectChangeOrderSerializer, ActivityLogSerializer,
    ScioTeamCapacitySerializer, SubcontractedTeamCapacitySerializer,
    PrgExternalTeamCapacitySerializer, DepartmentWeeklyTotalSerializer,
    UserRegistrationSerializer, RegisteredUserSerializer
)


# ==================== CUSTOM PERMISSIONS ====================

class IsOwnerOrReadOnly(BasePermission):
    """
    Custom permission class for owner-based access control.

    Allows owner of an object to modify it, but all users can read.
    Used for resource-level permissions in the API.

    - Any user can perform safe methods (GET, HEAD, OPTIONS)
    - Only object owner or superuser can modify
    """

    def has_object_permission(self, request, view, obj):
        """
        Check if user has permission to access the object.

        Args:
            request: HTTP request object
            view: APIView instance
            obj: Model instance being accessed

        Returns:
            bool: True if user has permission, False otherwise
        """
        # Read permissions allowed to any request (safe methods)
        if request.method in SAFE_METHODS:
            return True

        # Write permissions only to superuser or object owner
        return (request.user and request.user.is_superuser)


class IsAdminOrReadOnly(BasePermission):
    """
    Custom permission class for admin-based access control.

    Allows admin users to modify objects, but all users can read.
    More restrictive than IsOwnerOrReadOnly.

    - Any user can perform safe methods (GET, HEAD, OPTIONS)
    - Only admin users can create, update, delete
    """

    def has_permission(self, request, view):
        """
        Check if user has permission to access the view.

        Args:
            request: HTTP request object
            view: APIView instance

        Returns:
            bool: True if user has permission, False otherwise
        """
        if request.method in SAFE_METHODS:
            return True
        return request.user and request.user.is_staff


# ==================== USER ACCESS HELPERS ====================

def _resolve_user_department(user):
    """Return (department, other_department) for a user, if available."""
    try:
        profile = getattr(user, 'profile', None)
        if profile:
            return profile.department, profile.other_department
    except Exception:
        pass

    # Fallback: if user is linked to an Employee record, use that department
    try:
        employee = getattr(user, 'employee', None)
        if employee:
            return employee.department, None
    except Exception:
        pass

    return None, None


def _has_full_access(user):
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if user.is_superuser or user.is_staff:
        return True

    department, other_department = _resolve_user_department(user)
    if department == UserDepartment.PM:
        return True
    if department == UserDepartment.OTHER and other_department == OtherDepartment.BUSINESS_INTELLIGENCE:
        return True
    return False


def _is_read_only_user(user):
    department, other_department = _resolve_user_department(user)
    return department == UserDepartment.OTHER and other_department != OtherDepartment.BUSINESS_INTELLIGENCE


def _can_edit_department(user, department_code):
    if _has_full_access(user):
        return True
    if _is_read_only_user(user):
        return False
    user_department, _ = _resolve_user_department(user)
    if not user_department:
        return False
    shared_departments = {UserDepartment.BUILD, UserDepartment.MFG}
    if user_department in shared_departments and department_code in shared_departments:
        return True
    return user_department == department_code


def _has_bi_management_access(user):
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if user.is_superuser:
        return True
    department, other_department = _resolve_user_department(user)
    return (
        department == UserDepartment.OTHER
        and other_department == OtherDepartment.BUSINESS_INTELLIGENCE
    )


def _query_param_as_bool(value, default=False):
    """
    Parse common query-string boolean representations.
    Returns `default` when value is missing or unrecognized.
    """
    if value is None:
        return default
    if isinstance(value, bool):
        return value

    normalized = str(value).strip().lower()
    if normalized in {'1', 'true', 'yes', 'y', 'on'}:
        return True
    if normalized in {'0', 'false', 'no', 'n', 'off'}:
        return False
    return default


class CanViewActivityLog(BasePermission):
    """
    Permission for viewing activity logs.

    - Staff members can view all logs
    - Regular users can view logs for their own actions
    - Superusers can view everything
    """

    def has_permission(self, request, view):
        """Check if user can view activity logs."""
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        """Check if user can view specific activity log entry."""
        if request.user.is_superuser or request.user.is_staff:
            return True
        # Regular users can only view their own logs
        return obj.user == request.user


class IsBusinessIntelligenceManager(BasePermission):
    """Allow access only to Business Intelligence users (or superuser)."""

    def has_permission(self, request, view):
        return _has_bi_management_access(request.user)


# ==================== PAGINATION ====================

class StandardResultsSetPagination(PageNumberPagination):
    """
    Standard pagination for API responses.

    Provides consistent pagination across all endpoints:
    - Default page size: 50 items
    - Max page size: 1000 items (configurable per request)
    - Includes page count and total count in response

    Usage:
        - Add ?page=1 to query
        - Add ?page_size=100 to override (max 1000)
    """
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 1000
    page_size_template = (
        'Current page has {count} results. '
        'Use ?page_size=N to set page size (max {max_page_size}).'
    )


class LargeResultsSetPagination(PageNumberPagination):
    """
    Pagination for endpoints that return larger result sets.

    Used for reports and analytics:
    - Default page size: 200 items
    - Max page size: 500 items
    """
    page_size = 200
    page_size_query_param = 'page_size'
    max_page_size = 500


# ==================== FILTER BACKENDS ====================

class EmployeeFilter(filters.SearchFilter):
    """Custom search filter for employees."""
    search_fields = ['name', 'role', 'department']


class ProjectFilter(filters.SearchFilter):
    """Custom search filter for projects."""
    search_fields = ['name', 'client', 'facility']


# ==================== VIEWSETS ====================

class EmployeeViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Employee model.

    Provides CRUD operations for employees with:
    - Filtering by department and active status
    - Search by name, role, department
    - Ordering by name, department, capacity
    - Pagination
    - Detailed view with assignments and utilization
    - Capacity analysis actions

    Endpoints:
        GET /api/employees/ - List all employees
        POST /api/employees/ - Create new employee
        GET /api/employees/{id}/ - Get employee details
        PUT /api/employees/{id}/ - Update employee
        DELETE /api/employees/{id}/ - Delete employee
        GET /api/employees/{id}/capacity-summary/ - Get capacity summary
        GET /api/employees/{id}/workload/ - Get employee workload
        GET /api/employees/by-department/{dept}/ - Filter by department

    Permissions:
        - IsAuthenticated: User must be logged in

    Query Parameters:
        - search: Search by name, role, or department
        - department: Filter by department code
        - is_active: Filter by active status (true/false)
        - ordering: Order by field (-name, -capacity, etc)
        - page: Page number for pagination
        - page_size: Items per page
    """
    queryset = Employee.objects.all().select_related('user')
    serializer_class = EmployeeSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['department', 'is_active', 'is_subcontracted_material']
    search_fields = ['name', 'role', 'department']
    ordering_fields = ['name', 'department', 'capacity', 'created_at']
    ordering = ['department', 'name']

    def get_serializer_class(self):
        """
        Return appropriate serializer based on action.

        Returns detailed serializer for retrieve action,
        standard serializer for other actions.
        """
        if self.action == 'retrieve':
            return EmployeeDetailSerializer
        return EmployeeSerializer

    def get_queryset(self):
        """
        Optimize queryset based on action.

        Returns prefetch_related optimized queryset for
        actions that need related assignment data.
        """
        queryset = super().get_queryset()

        if self.action == 'retrieve':
            # Optimize for detail view with assignments
            assignment_prefetch = Prefetch(
                'assignments',
                Assignment.objects.select_related('project').order_by('-week_start_date')
            )
            queryset = queryset.prefetch_related(
                assignment_prefetch,
                'managed_projects'
            )

        return queryset

    def _ensure_employee_edit_permission(self, department):
        if _has_full_access(self.request.user):
            return
        if _is_read_only_user(self.request.user):
            raise PermissionDenied("Read-only access.")
        if not department or not _can_edit_department(self.request.user, department):
            raise PermissionDenied("No permission to modify this department.")

    def perform_create(self, serializer):
        department = serializer.validated_data.get('department') or self.request.data.get('department')
        self._ensure_employee_edit_permission(department)
        serializer.save()

    def perform_update(self, serializer):
        department = serializer.validated_data.get('department') or serializer.instance.department
        self._ensure_employee_edit_permission(department)
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_employee_edit_permission(instance.department)
        instance.delete()

    @action(detail=True, methods=['get'])
    def capacity_summary(self, request, pk=None):
        """
        Get employee capacity summary.

        Returns:
            - Total capacity (hours per week)
            - Current week allocation
            - Next week allocation
            - Utilization percentage
            - Available capacity

        Example:
            GET /api/employees/{id}/capacity-summary/
        """
        employee = self.get_object()
        today = timezone.now().date()
        week_start = today - timedelta(days=today.weekday())
        next_week_start = week_start + timedelta(days=7)

        current_week_hours = sum(
            a.hours for a in employee.assignments.filter(
                week_start_date=week_start
            )
        )
        next_week_hours = sum(
            a.hours for a in employee.assignments.filter(
                week_start_date=next_week_start
            )
        )

        utilization = (
            (current_week_hours / employee.capacity * 100)
            if employee.capacity > 0 else 0
        )

        return Response({
            'employee_id': str(employee.id),
            'name': employee.name,
            'total_capacity': employee.capacity,
            'current_week_allocation': current_week_hours,
            'next_week_allocation': next_week_hours,
            'utilization_percent': round(utilization, 2),
            'available_capacity': max(0, employee.capacity - current_week_hours),
        })

    @action(detail=True, methods=['get'])
    def workload(self, request, pk=None):
        """
        Get detailed employee workload for next 8 weeks.

        Returns:
            List of weeks with:
            - Week start date
            - Total hours allocated
            - Projects assigned
            - Utilization percentage

        Example:
            GET /api/employees/{id}/workload/
        """
        employee = self.get_object()
        today = timezone.now().date()
        week_start = today - timedelta(days=today.weekday())

        workload_data = []
        for week_offset in range(8):
            current_week = week_start + timedelta(days=week_offset * 7)
            assignments = employee.assignments.filter(
                week_start_date=current_week
            ).select_related('project')

            total_hours = sum(a.hours for a in assignments)
            utilization = (
                (total_hours / employee.capacity * 100)
                if employee.capacity > 0 else 0
            )

            workload_data.append({
                'week_start': current_week.isoformat(),
                'week_end': (current_week + timedelta(days=6)).isoformat(),
                'total_hours': total_hours,
                'utilization_percent': round(utilization, 2),
                'assignment_count': len(assignments),
                'projects': [
                    {
                        'project_id': str(a.project.id),
                        'project_name': a.project.name,
                        'hours': a.hours,
                        'stage': a.stage,
                    }
                    for a in assignments
                ],
            })

        return Response({
            'employee_id': str(employee.id),
            'employee_name': employee.name,
            'capacity': employee.capacity,
            'workload': workload_data,
        })

    @action(detail=False, methods=['get'])
    def by_department(self, request):
        """
        Get all active employees by department with summary stats.

        Query Parameters:
            - department: Department code (PM, MED, HD, etc)

        Returns:
            List of employees grouped by role with:
            - Employee name and capacity
            - Current week utilization
            - Projects assigned

        Example:
            GET /api/employees/by-department/?department=MED
        """
        department = request.query_params.get('department')

        if not department:
            return Response(
                {'error': 'department parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        employees = self.get_queryset().filter(
            department=department,
            is_active=True
        ).select_related('user')

        today = timezone.now().date()
        week_start = today - timedelta(days=today.weekday())

        dept_data = []
        for emp in employees:
            week_hours = sum(
                a.hours for a in emp.assignments.filter(
                    week_start_date=week_start
                )
            )
            utilization = (
                (week_hours / emp.capacity * 100)
                if emp.capacity > 0 else 0
            )

            dept_data.append({
                'id': str(emp.id),
                'name': emp.name,
                'role': emp.role,
                'capacity': emp.capacity,
                'current_week_hours': week_hours,
                'utilization_percent': round(utilization, 2),
                'available': max(0, emp.capacity - week_hours),
            })

        return Response({
            'department': department,
            'department_name': dict(Department.choices).get(department, department),
            'employee_count': len(dept_data),
            'employees': dept_data,
        })


class ProjectViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Project model.

    Provides CRUD operations for projects with:
    - Filtering by facility and date range
    - Search by name and client
    - Ordering by dates and creation
    - Pagination
    - Detailed view with assignments and budget
    - Statistics and reporting actions

    Endpoints:
        GET /api/projects/ - List all projects
        POST /api/projects/ - Create new project
        GET /api/projects/{id}/ - Get project details
        PUT /api/projects/{id}/ - Update project
        DELETE /api/projects/{id}/ - Delete project
        GET /api/projects/{id}/statistics/ - Get project statistics
        GET /api/projects/{id}/budget-report/ - Get budget utilization
        GET /api/projects/{id}/timeline/ - Get project timeline
        GET /api/projects/by-facility/{facility}/ - Filter by facility

    Permissions:
        - IsAuthenticated: User must be logged in
        - IsAdminOrReadOnly: Only staff can create/modify

    Query Parameters:
        - search: Search by name or client
        - facility: Filter by facility code
        - start_date: Filter by start date (YYYY-MM-DD)
        - end_date: Filter by end date (YYYY-MM-DD)
        - ordering: Order by field (-start_date, -created_at, etc)
        - page: Page number
        - page_size: Items per page
    """
    queryset = Project.objects.all().select_related('project_manager')
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['facility']
    search_fields = ['name', 'client']
    ordering_fields = ['start_date', 'end_date', 'created_at', 'name']
    ordering = ['-created_at']

    def get_serializer_class(self):
        """Return detailed serializer for retrieve action."""
        if self.action == 'retrieve':
            return ProjectDetailSerializer
        return ProjectSerializer

    def get_queryset(self):
        """Optimize queryset with related data."""
        queryset = super().get_queryset()
        include_hidden = _query_param_as_bool(
            self.request.query_params.get('include_hidden'),
            default=False,
        )

        if include_hidden and not _has_full_access(self.request.user):
            raise PermissionDenied('No tienes permiso para consultar proyectos ocultos.')

        if not include_hidden:
            queryset = queryset.filter(is_hidden=False)

        # Filter by date range if provided
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')

        if start_date:
            try:
                start = datetime.strptime(start_date, '%Y-%m-%d').date()
                queryset = queryset.filter(start_date__gte=start)
            except ValueError:
                pass

        if end_date:
            try:
                end = datetime.strptime(end_date, '%Y-%m-%d').date()
                queryset = queryset.filter(end_date__lte=end)
            except ValueError:
                pass

        if self.action == 'retrieve':
            # Optimize for detail view
            assignment_prefetch = Prefetch(
                'assignments',
                Assignment.objects.select_related('employee').order_by('week_start_date')
            )
            queryset = queryset.prefetch_related(
                assignment_prefetch,
                'department_stages'
            )

        return queryset

    @staticmethod
    def _department_codes():
        return {code for code, _ in Department.choices}

    @classmethod
    def _normalize_department_code(cls, value):
        if not isinstance(value, str):
            return None
        code = value.strip().upper()
        return code if code in cls._department_codes() else None

    @staticmethod
    def _get_first_present_value(data, keys):
        for key in keys:
            if key in data:
                return data.get(key), True
        return None, False

    @staticmethod
    def _coerce_float(value, default=0.0):
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _as_comparable(value):
        if value in {'', None}:
            return None
        if hasattr(value, 'isoformat'):
            return value.isoformat()
        if isinstance(value, bool):
            return str(value).lower()
        return str(value)

    @classmethod
    def _normalize_stage_entry(cls, stage_data):
        if not isinstance(stage_data, dict):
            return None

        stage = stage_data.get('stage') or None
        week_start = stage_data.get('week_start', stage_data.get('weekStart'))
        week_end = stage_data.get('week_end', stage_data.get('weekEnd'))
        department_start = stage_data.get(
            'department_start_date',
            stage_data.get('departmentStartDate'),
        )

        if week_start in {None, ''} or week_end in {None, ''}:
            return None

        try:
            normalized_start = int(week_start)
            normalized_end = int(week_end)
        except (TypeError, ValueError):
            return None

        if hasattr(department_start, 'isoformat'):
            department_start = department_start.isoformat()
        department_start = None if department_start in {'', None} else str(department_start)

        return stage, normalized_start, normalized_end, department_start

    @classmethod
    def _normalize_stage_entries(cls, stage_entries):
        if not isinstance(stage_entries, list):
            return tuple()

        normalized = []
        for entry in stage_entries:
            signature = cls._normalize_stage_entry(entry)
            if signature is not None:
                normalized.append(signature)
        normalized.sort()
        return tuple(normalized)

    def _extract_create_scope_departments(self, data):
        scope_departments = set()

        visible_departments, has_visible = self._get_first_present_value(
            data,
            ('visible_in_departments', 'visibleInDepartments'),
        )
        if has_visible and isinstance(visible_departments, list):
            for raw_department in visible_departments:
                department = self._normalize_department_code(raw_department)
                if department:
                    scope_departments.add(department)

        stage_payload, has_stage_payload = self._get_first_present_value(
            data,
            ('department_stages', 'departmentStages'),
        )
        if has_stage_payload and isinstance(stage_payload, dict):
            for raw_department, stages in stage_payload.items():
                department = self._normalize_department_code(raw_department)
                if department and isinstance(stages, list) and len(stages) > 0:
                    scope_departments.add(department)

        if scope_departments:
            return scope_departments

        hours_payload, has_hours_payload = self._get_first_present_value(
            data,
            ('department_hours_allocated', 'departmentHoursAllocated'),
        )
        if has_hours_payload and isinstance(hours_payload, dict):
            for raw_department, raw_hours in hours_payload.items():
                department = self._normalize_department_code(raw_department)
                if not department:
                    continue
                if abs(self._coerce_float(raw_hours, default=0.0)) > 1e-6:
                    scope_departments.add(department)

        return scope_departments

    def _changed_departments_from_payload(self, project, data):
        changed_departments = set()

        stage_payload, has_stage_payload = self._get_first_present_value(
            data,
            ('department_stages', 'departmentStages'),
        )
        if has_stage_payload and isinstance(stage_payload, dict):
            existing_stages = {}
            for config in project.department_stages.all():
                existing_stages.setdefault(config.department, []).append(
                    (
                        config.stage or None,
                        int(config.week_start),
                        int(config.week_end),
                        config.department_start_date.isoformat()
                        if config.department_start_date
                        else None,
                    )
                )
            existing_stage_signatures = {
                dept: tuple(sorted(entries))
                for dept, entries in existing_stages.items()
            }

            payload_stage_signatures = {}
            for raw_department, entries in stage_payload.items():
                department = self._normalize_department_code(raw_department)
                if not department:
                    continue
                payload_stage_signatures[department] = self._normalize_stage_entries(entries)

            existing_departments = set(existing_stage_signatures.keys())
            payload_departments = set(payload_stage_signatures.keys())

            # department_stages is treated as full replacement by serializer.update
            changed_departments.update(existing_departments - payload_departments)

            for department in payload_departments:
                if payload_stage_signatures.get(department) != existing_stage_signatures.get(
                    department,
                    tuple(),
                ):
                    changed_departments.add(department)

        hours_payload, has_hours_payload = self._get_first_present_value(
            data,
            ('department_hours_allocated', 'departmentHoursAllocated'),
        )
        if has_hours_payload and isinstance(hours_payload, dict):
            existing_hours = {
                budget.department: float(budget.hours_allocated)
                for budget in project.budgets.all()
            }
            for raw_department, raw_hours in hours_payload.items():
                department = self._normalize_department_code(raw_department)
                if not department:
                    continue
                incoming_value = self._coerce_float(raw_hours, default=0.0)
                existing_value = self._coerce_float(existing_hours.get(department), default=0.0)
                if abs(incoming_value - existing_value) > 1e-6:
                    changed_departments.add(department)

        visible_departments, has_visible = self._get_first_present_value(
            data,
            ('visible_in_departments', 'visibleInDepartments'),
        )
        if has_visible and isinstance(visible_departments, list):
            incoming_visible = {
                dept for dept in (
                    self._normalize_department_code(raw_department)
                    for raw_department in visible_departments
                )
                if dept
            }
            current_visible = {
                dept for dept in (
                    self._normalize_department_code(raw_department)
                    for raw_department in (project.visible_in_departments or [])
                )
                if dept
            }
            changed_departments.update(incoming_visible.symmetric_difference(current_visible))

        return changed_departments

    def _shared_project_fields_modified(self, project, data):
        shared_field_specs = (
            (('name',), project.name),
            (('client',), project.client),
            (('start_date', 'startDate'), project.start_date),
            (('end_date', 'endDate'), project.end_date),
            (('facility',), project.facility),
            (('number_of_weeks', 'numberOfWeeks'), project.number_of_weeks),
            (('project_manager_id', 'projectManagerId'), project.project_manager_id),
        )

        for keys, current_value in shared_field_specs:
            incoming_value, is_present = self._get_first_present_value(data, keys)
            if not is_present:
                continue
            if self._as_comparable(incoming_value) != self._as_comparable(current_value):
                return True

        return False

    def _ensure_project_create_permission(self):
        if _has_full_access(self.request.user):
            return
        if _is_read_only_user(self.request.user):
            raise PermissionDenied("No permission to modify projects.")

        request_data = self.request.data if isinstance(self.request.data, dict) else {}
        target_departments = self._extract_create_scope_departments(request_data)
        if not target_departments:
            raise PermissionDenied("No permission to create projects without department scope.")

        if any(not _can_edit_department(self.request.user, dept) for dept in target_departments):
            raise PermissionDenied("No permission to modify projects for this department.")

    def _ensure_project_update_permission(self, serializer):
        if _has_full_access(self.request.user):
            return
        if _is_read_only_user(self.request.user):
            raise PermissionDenied("No permission to modify projects.")

        project = serializer.instance
        request_data = self.request.data if isinstance(self.request.data, dict) else {}

        if self._shared_project_fields_modified(project, request_data):
            raise PermissionDenied("No permission to modify shared project fields.")

        changed_departments = self._changed_departments_from_payload(project, request_data)
        if any(not _can_edit_department(self.request.user, dept) for dept in changed_departments):
            raise PermissionDenied("No permission to modify projects for this department.")

    def _ensure_full_access(self):
        if not _has_full_access(self.request.user):
            raise PermissionDenied("No permission to modify projects.")

    def perform_create(self, serializer):
        self._ensure_project_create_permission()
        serializer.save()

    def perform_update(self, serializer):
        self._ensure_project_update_permission(serializer)
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_full_access()
        # Soft delete: keep assignments/budgets/history but hide project from active UI.
        if not instance.is_hidden:
            instance.is_hidden = True
            instance.hidden_at = timezone.now()
            instance.save(update_fields=['is_hidden', 'hidden_at', 'updated_at'])

    @action(detail=True, methods=['get'])
    def statistics(self, request, pk=None):
        """
        Get comprehensive project statistics.

        Returns:
            - Total assignments
            - Total allocated hours
            - Assignment count by department
            - Week-by-week breakdown
            - Resource utilization

        Example:
            GET /api/projects/{id}/statistics/
        """
        project = self.get_object()
        assignments = project.assignments.all().select_related('employee')

        # Calculate statistics
        total_hours = sum(a.hours for a in assignments)
        assignment_count = assignments.count()

        # Group by department
        dept_stats = {}
        for assignment in assignments:
            dept = assignment.employee.department
            if dept not in dept_stats:
                dept_stats[dept] = {
                    'count': 0,
                    'hours': 0,
                    'employees': set()
                }
            dept_stats[dept]['count'] += 1
            dept_stats[dept]['hours'] += assignment.hours
            dept_stats[dept]['employees'].add(str(assignment.employee.id))

        # Convert sets to lists
        for dept in dept_stats:
            dept_stats[dept]['employees'] = list(dept_stats[dept]['employees'])

        # Week-by-week breakdown
        week_stats = {}
        for assignment in assignments:
            week = assignment.week_start_date.isoformat()
            if week not in week_stats:
                week_stats[week] = {
                    'hours': 0,
                    'assignments': 0
                }
            week_stats[week]['hours'] += assignment.hours
            week_stats[week]['assignments'] += 1

        return Response({
            'project_id': str(project.id),
            'project_name': project.name,
            'total_assignments': assignment_count,
            'total_allocated_hours': round(total_hours, 2),
            'average_hours_per_assignment': (
                round(total_hours / assignment_count, 2) if assignment_count > 0 else 0
            ),
            'by_department': {
                dept: {
                    'count': stats['count'],
                    'total_hours': round(stats['hours'], 2),
                    'employee_count': len(stats['employees']),
                }
                for dept, stats in dept_stats.items()
            },
            'by_week': sorted(week_stats.items()),
        })

    @action(detail=True, methods=['get'])
    def budget_report(self, request, pk=None):
        """
        Get project budget utilization report.

        Returns:
            - Budget by department
            - Utilization percentages
            - Available budget
            - Risk status (within, near, exceeded)

        Example:
            GET /api/projects/{id}/budget-report/
        """
        project = self.get_object()

        try:
            budget = project.budget
            serializer = ProjectBudgetSerializer(budget)
            return Response(serializer.data)
        except ProjectBudget.DoesNotExist:
            return Response(
                {'error': 'No budget configured for this project'},
                status=status.HTTP_404_NOT_FOUND
            )

    @action(detail=True, methods=['get'])
    def timeline(self, request, pk=None):
        """
        Get project timeline with department stages.

        Returns:
            - Project duration
            - Department stage schedule
            - Key milestones
            - Week-by-week view

        Example:
            GET /api/projects/{id}/timeline/
        """
        project = self.get_object()
        stages = project.department_stages.all()

        timeline_data = []
        for stage in stages:
            timeline_data.append({
                'department': stage.get_department_display(),
                'stage': stage.get_stage_display() if stage.stage else 'N/A',
                'week_start': stage.week_start,
                'week_end': stage.week_end,
                'duration_weeks': stage.week_end - stage.week_start + 1,
                'start_date': stage.department_start_date,
            })

        return Response({
            'project_id': str(project.id),
            'project_name': project.name,
            'start_date': project.start_date.isoformat(),
            'end_date': project.end_date.isoformat(),
            'total_weeks': project.number_of_weeks,
            'duration_days': (project.end_date - project.start_date).days,
            'timeline': sorted(timeline_data, key=lambda x: x['week_start']),
        })

    @action(detail=False, methods=['get'])
    def by_facility(self, request):
        """
        Get all projects by facility with summary.

        Query Parameters:
            - facility: Facility code (AL, MI, MX)

        Returns:
            List of projects at facility with:
            - Project dates and duration
            - Assignment count
            - Team members

        Example:
            GET /api/projects/by-facility/?facility=AL
        """
        facility = request.query_params.get('facility')

        if not facility:
            return Response(
                {'error': 'facility parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        projects = self.get_queryset().filter(
            facility=facility
        ).select_related('project_manager')

        project_list = []
        for proj in projects:
            assignment_count = proj.assignments.count()
            total_hours = sum(a.hours for a in proj.assignments.all())

            project_list.append({
                'id': str(proj.id),
                'name': proj.name,
                'client': proj.client,
                'start_date': proj.start_date.isoformat(),
                'end_date': proj.end_date.isoformat(),
                'duration_weeks': proj.number_of_weeks,
                'assignment_count': assignment_count,
                'total_allocated_hours': round(total_hours, 2),
                'project_manager': proj.project_manager.name if proj.project_manager else None,
            })

        return Response({
            'facility': facility,
            'facility_name': dict(Facility.choices).get(facility, facility),
            'project_count': len(project_list),
            'projects': project_list,
        })

    @action(detail=True, methods=['patch'], url_path='update-budget-hours')
    def update_budget_hours(self, request, pk=None):
        """
        Update budget hours (utilized or forecast) for a specific project and department.
        Creates ProjectBudget entry if it doesn't exist.

        Request body:
        {
            "department": "PM",  // Required: Department code
            "hours_utilized": 100,  // Optional: Hours utilized
            "hours_forecast": 150   // Optional: Hours forecast
        }

        Returns the updated ProjectBudget object.
        """
        project = self.get_object()
        department = request.data.get('department')
        hours_utilized = request.data.get('hours_utilized')
        hours_forecast = request.data.get('hours_forecast')

        if not department:
            return Response(
                {'detail': 'Department is required'},
                status=400
            )

        try:
            budget, created = ProjectBudget.objects.get_or_create(
                project=project,
                department=department,
                defaults={
                    'hours_allocated': 0,
                    'hours_utilized': hours_utilized or 0,
                    'hours_forecast': hours_forecast or 0,
                }
            )

            # Update the fields if provided (only if not newly created)
            if not created:
                if hours_utilized is not None:
                    budget.hours_utilized = hours_utilized
                if hours_forecast is not None:
                    budget.hours_forecast = hours_forecast

                budget.save()

            from capacity.serializers import ProjectBudgetSerializer
            serializer = ProjectBudgetSerializer(budget)
            return Response(serializer.data)

        except Exception as e:
            return Response(
                {'detail': f'Error updating budget: {str(e)}'},
                status=400
            )

    def create(self, request, *args, **kwargs):
        """Override create to handle ProjectBudgets creation."""
        response = super().create(request, *args, **kwargs)

        if response.status_code == 201:
            # Create ProjectBudget entries for each department with allocated hours
            project_id = response.data['id']
            department_hours_allocated = request.data.get('department_hours_allocated', {})

            # Process all departments, even if they have 0 hours
            if department_hours_allocated is not None and isinstance(department_hours_allocated, dict):
                try:
                    project = Project.objects.get(id=project_id)
                    for department, hours in department_hours_allocated.items():
                        # Ensure hours is a number (int or float), handle None values
                        hours_value = float(hours) if hours is not None else 0
                        ProjectBudget.objects.get_or_create(
                            project=project,
                            department=department,
                            defaults={
                                'hours_allocated': hours_value,
                                'hours_utilized': 0,
                                'hours_forecast': 0,
                            }
                        )
                except Exception as e:
                    print(f'Error creating ProjectBudgets: {str(e)}')

        return response

    def update(self, request, *args, **kwargs):
        """Override update to handle ProjectBudgets update."""
        response = super().update(request, *args, **kwargs)

        if response.status_code in [200, 202]:
            # Update ProjectBudget entries for each department
            project_id = kwargs.get('pk')
            department_hours_allocated = request.data.get('department_hours_allocated', {})

            # Process all departments, even if they have 0 hours
            if department_hours_allocated is not None and isinstance(department_hours_allocated, dict):
                try:
                    project = Project.objects.get(id=project_id)
                    for department, hours in department_hours_allocated.items():
                        # Ensure hours is a number (int or float), handle None values
                        hours_value = float(hours) if hours is not None else 0
                        budget, created = ProjectBudget.objects.get_or_create(
                            project=project,
                            department=department,
                            defaults={
                                'hours_allocated': hours_value,
                                'hours_utilized': 0,
                                'hours_forecast': 0,
                            }
                        )
                        # Update hours_allocated if budget already existed and value changed
                        if not created and budget.hours_allocated != hours_value:
                            budget.hours_allocated = hours_value
                            budget.save()
                except Exception as e:
                    print(f'Error updating ProjectBudgets: {str(e)}')

        return response


class AssignmentViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Assignment model.

    Provides CRUD operations for project assignments with:
    - Filtering by employee, project, date range
    - Search capabilities
    - Ordering by week and employee
    - Pagination with larger default
    - Weekly aggregation and reports

    Endpoints:
        GET /api/assignments/ - List all assignments
        POST /api/assignments/ - Create new assignment
        GET /api/assignments/{id}/ - Get assignment details
        PUT /api/assignments/{id}/ - Update assignment
        DELETE /api/assignments/{id}/ - Delete assignment
        GET /api/assignments/by-week/ - Get assignments by week
        GET /api/assignments/capacity-by-dept/ - Get capacity by department
        GET /api/assignments/utilization-report/ - Get utilization report

    Permissions:
        - IsAuthenticated: User must be logged in
        - IsAdminOrReadOnly: Only staff can create/modify

    Query Parameters:
        - employee_id: Filter by employee UUID
        - project_id: Filter by project UUID
        - week_start_date: Filter by week date (YYYY-MM-DD)
        - stage: Filter by work stage
        - ordering: Order by field (-week_start_date, -employee__name, etc)
        - page: Page number
        - page_size: Items per page
    """
    queryset = (
        Assignment.objects
        .all()
        .select_related('employee', 'project')
    )
    serializer_class = AssignmentSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = LargeResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['employee', 'project', 'week_start_date', 'stage']
    ordering_fields = ['week_start_date', 'employee', 'project', 'hours']
    ordering = ['-week_start_date', 'employee']

    def get_serializer_class(self):
        # List responses are large; keep them compact for faster initial render.
        if self.action == 'list':
            return AssignmentListSerializer
        return AssignmentSerializer

    def get_queryset(self):
        """Filter queryset by date range if provided."""
        queryset = super().get_queryset()
        include_hidden = _query_param_as_bool(
            self.request.query_params.get('include_hidden'),
            default=False,
        )

        if include_hidden and not _has_full_access(self.request.user):
            raise PermissionDenied('No tienes permiso para consultar asignaciones ocultas.')

        if not include_hidden:
            queryset = queryset.filter(project__is_hidden=False)

        # Optional filter: employee department (used by frontend to reduce payload)
        department = self.request.query_params.get('department')
        if department:
            queryset = queryset.filter(employee__department=department)

        # Optional filter: limit to a set of project UUIDs (comma-separated)
        project_ids_param = self.request.query_params.get('project_ids')
        if project_ids_param:
            project_ids = []
            for raw in project_ids_param.split(','):
                raw = (raw or '').strip()
                if not raw:
                    continue
                try:
                    uuid.UUID(raw)
                except ValueError:
                    continue
                project_ids.append(raw)

            if project_ids:
                queryset = queryset.filter(project_id__in=project_ids)

        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')

        if start_date:
            try:
                start = datetime.strptime(start_date, '%Y-%m-%d').date()
                queryset = queryset.filter(week_start_date__gte=start)
            except ValueError:
                pass

        if end_date:
            try:
                end = datetime.strptime(end_date, '%Y-%m-%d').date()
                queryset = queryset.filter(week_start_date__lte=end)
            except ValueError:
                pass

        return queryset

    def _ensure_assignment_edit_permission(self, employee):
        if _has_full_access(self.request.user):
            return
        if _is_read_only_user(self.request.user):
            raise PermissionDenied("Read-only access.")
        if not employee or not _can_edit_department(self.request.user, employee.department):
            raise PermissionDenied("No permission to modify this department.")

    def perform_create(self, serializer):
        employee_id = serializer.validated_data.get('employee_id') or self.request.data.get('employee_id')
        employee = Employee.objects.filter(id=employee_id).first() if employee_id else None
        self._ensure_assignment_edit_permission(employee)
        serializer.save()

    def perform_update(self, serializer):
        employee_id = self.request.data.get('employee_id')
        employee = None
        if employee_id:
            employee = Employee.objects.filter(id=employee_id).first()
        if employee is None:
            employee = serializer.instance.employee
        self._ensure_assignment_edit_permission(employee)
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_assignment_edit_permission(instance.employee)
        instance.delete()

    @action(detail=False, methods=['get'], url_path='summary-by-project-dept')
    def summary_by_project_dept(self, request):
        """
        Return utilized/forecast hours aggregated by project + employee department.

        This is used by the frontend to calculate project metrics across ALL years
        without downloading every assignment row.

        Query params:
          - project_ids: comma-separated UUIDs (required)
          - department: optional department code (e.g. MED) to filter
          - current_week_start: optional ISO date (YYYY-MM-DD) to split used vs forecast
        """
        project_ids_param = (request.query_params.get('project_ids') or '').strip()
        if not project_ids_param:
            return Response(
                {'detail': 'project_ids query param is required.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        project_ids = [pid.strip() for pid in project_ids_param.split(',') if pid.strip()]
        department = (request.query_params.get('department') or '').strip() or None

        current_week_start = request.query_params.get('current_week_start')
        if current_week_start:
            try:
                split_date = datetime.strptime(current_week_start, '%Y-%m-%d').date()
            except ValueError:
                return Response(
                    {'detail': 'current_week_start must be in YYYY-MM-DD format.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        else:
            today = timezone.localdate()
            split_date = today - timedelta(days=today.weekday())  # Monday of current week

        qs = Assignment.objects.filter(project_id__in=project_ids).select_related('employee')
        include_hidden = _query_param_as_bool(
            request.query_params.get('include_hidden'),
            default=False,
        )

        if include_hidden and not _has_full_access(request.user):
            raise PermissionDenied('No tienes permiso para consultar asignaciones ocultas.')

        if not include_hidden:
            qs = qs.filter(project__is_hidden=False)

        if department:
            qs = qs.filter(employee__department=department)

        rows = (
            qs.values('project_id', 'employee__department')
            .annotate(
                utilized=Sum(
                    Case(
                        When(week_start_date__lt=split_date, then=F('hours')),
                        default=Value(0),
                        output_field=FloatField(),
                    )
                ),
                forecast=Sum(
                    Case(
                        When(week_start_date__gte=split_date, then=F('hours')),
                        default=Value(0),
                        output_field=FloatField(),
                    )
                ),
            )
        )

        results = [
            {
                'project_id': str(row['project_id']),
                'department': row['employee__department'],
                'utilized': float(row['utilized'] or 0),
                'forecast': float(row['forecast'] or 0),
            }
            for row in rows
            if row.get('employee__department')
        ]

        return Response(results)

    @action(detail=False, methods=['get'])
    def by_week(self, request):
        """
        Get assignments aggregated by week.

        Returns:
            List of weeks with:
            - Week start/end dates
            - Total hours by employee
            - Total hours by project
            - Utilization metrics

        Query Parameters:
            - start_date: Start week (YYYY-MM-DD)
            - end_date: End week (YYYY-MM-DD)
            - project_id: Filter by project (optional)

        Example:
            GET /api/assignments/by-week/?start_date=2024-01-01&end_date=2024-12-31
        """
        assignments = self.get_queryset().select_related(
            'employee', 'project'
        )

        # Group by week
        weeks = {}
        for assignment in assignments:
            week_key = assignment.week_start_date.isoformat()

            if week_key not in weeks:
                weeks[week_key] = {
                    'week_start': assignment.week_start_date,
                    'week_end': assignment.week_start_date + timedelta(days=6),
                    'total_hours': 0,
                    'assignment_count': 0,
                    'by_employee': {},
                    'by_project': {},
                    'by_department': {},
                }

            weeks[week_key]['total_hours'] += assignment.hours
            weeks[week_key]['assignment_count'] += 1

            # Track by employee
            emp_id = str(assignment.employee.id)
            if emp_id not in weeks[week_key]['by_employee']:
                weeks[week_key]['by_employee'][emp_id] = {
                    'name': assignment.employee.name,
                    'hours': 0,
                    'capacity': assignment.employee.capacity,
                }
            weeks[week_key]['by_employee'][emp_id]['hours'] += assignment.hours

            # Track by project
            proj_id = str(assignment.project.id)
            if proj_id not in weeks[week_key]['by_project']:
                weeks[week_key]['by_project'][proj_id] = {
                    'name': assignment.project.name,
                    'hours': 0,
                }
            weeks[week_key]['by_project'][proj_id]['hours'] += assignment.hours

            # Track by department
            dept = assignment.employee.department
            if dept not in weeks[week_key]['by_department']:
                weeks[week_key]['by_department'][dept] = 0
            weeks[week_key]['by_department'][dept] += assignment.hours

        # Calculate utilization for employees
        for week_key, week_data in weeks.items():
            for emp_id, emp_data in week_data['by_employee'].items():
                if emp_data['capacity'] > 0:
                    emp_data['utilization_percent'] = round(
                        (emp_data['hours'] / emp_data['capacity']) * 100, 2
                    )
                else:
                    emp_data['utilization_percent'] = 0

        # Convert to sorted list
        weeks_list = [
            {
                'week_start': week_data['week_start'].isoformat(),
                'week_end': week_data['week_end'].isoformat(),
                'total_hours': round(week_data['total_hours'], 2),
                'assignment_count': week_data['assignment_count'],
                'by_employee': week_data['by_employee'],
                'by_project': week_data['by_project'],
                'by_department': {
                    k: round(v, 2) for k, v in week_data['by_department'].items()
                },
            }
            for week_data in sorted(
                weeks.values(),
                key=lambda x: x['week_start']
            )
        ]

        return Response({
            'week_count': len(weeks_list),
            'total_hours': round(sum(w['total_hours'] for w in weeks_list), 2),
            'weeks': weeks_list,
        })

    @action(detail=False, methods=['get'])
    def capacity_by_dept(self, request):
        """
        Get capacity and utilization by department.

        Returns:
            Department-level statistics:
            - Total capacity
            - Total allocated hours
            - Utilization percentage
            - Number of employees
            - Available capacity

        Query Parameters:
            - week_start_date: Filter by specific week (optional)

        Example:
            GET /api/assignments/capacity-by-dept/
        """
        week_date = request.query_params.get('week_start_date')

        if week_date:
            try:
                week = datetime.strptime(week_date, '%Y-%m-%d').date()
                assignments = self.get_queryset().filter(week_start_date=week)
            except ValueError:
                assignments = self.get_queryset()
        else:
            assignments = self.get_queryset()

        # Get all employees by department
        employees = Employee.objects.filter(is_active=True)

        dept_stats = {}
        for emp in employees:
            dept = emp.department
            if dept not in dept_stats:
                dept_stats[dept] = {
                    'total_capacity': 0,
                    'employee_count': 0,
                    'employees': [],
                }
            dept_stats[dept]['total_capacity'] += emp.capacity
            dept_stats[dept]['employee_count'] += 1
            dept_stats[dept]['employees'].append(str(emp.id))

        # Add allocated hours from assignments
        for assignment in assignments:
            dept = assignment.employee.department
            if dept not in dept_stats:
                dept_stats[dept] = {
                    'total_capacity': 0,
                    'total_allocated': 0,
                    'employee_count': 0,
                    'employees': [],
                }

        # Calculate allocations by department
        dept_allocated = {}
        for assignment in assignments:
            dept = assignment.employee.department
            if dept not in dept_allocated:
                dept_allocated[dept] = 0
            dept_allocated[dept] += assignment.hours

        # Build response
        capacity_data = []
        for dept, stats in dept_stats.items():
            allocated = dept_allocated.get(dept, 0)
            utilization = (
                (allocated / stats['total_capacity'] * 100)
                if stats['total_capacity'] > 0 else 0
            )

            capacity_data.append({
                'department': dept,
                'department_name': dict(Department.choices).get(dept, dept),
                'total_capacity': stats['total_capacity'],
                'total_allocated': round(allocated, 2),
                'available_capacity': max(0, stats['total_capacity'] - allocated),
                'utilization_percent': round(utilization, 2),
                'employee_count': stats['employee_count'],
                'status': (
                    'exceeded' if utilization > 100
                    else 'high' if utilization > 80
                    else 'normal'
                ),
            })

        return Response({
            'period': week_date if week_date else 'all_time',
            'timestamp': timezone.now().isoformat(),
            'departments': sorted(capacity_data, key=lambda x: x['department']),
        })

    @action(detail=False, methods=['get'])
    def utilization_report(self, request):
        """
        Get detailed utilization report.

        Returns:
            - Employee utilization summary
            - Under-utilized employees
            - Over-allocated employees
            - Department-level insights

        Query Parameters:
            - start_date: Report start date
            - end_date: Report end date

        Example:
            GET /api/assignments/utilization-report/
        """
        assignments = self.get_queryset()

        # Get current week by default
        today = timezone.now().date()
        week_start = today - timedelta(days=today.weekday())
        week_end = week_start + timedelta(days=6)

        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')

        if start_date and end_date:
            try:
                week_start = datetime.strptime(start_date, '%Y-%m-%d').date()
                week_end = datetime.strptime(end_date, '%Y-%m-%d').date()
            except ValueError:
                pass

        assignments = assignments.filter(
            week_start_date__gte=week_start,
            week_start_date__lte=week_end
        )

        # Group by employee
        employee_util = {}
        for assignment in assignments:
            emp_id = str(assignment.employee.id)
            if emp_id not in employee_util:
                employee_util[emp_id] = {
                    'name': assignment.employee.name,
                    'department': assignment.employee.department,
                    'capacity': assignment.employee.capacity,
                    'allocated': 0,
                    'assignments': [],
                }
            employee_util[emp_id]['allocated'] += assignment.hours
            employee_util[emp_id]['assignments'].append({
                'project': assignment.project.name,
                'hours': assignment.hours,
                'stage': assignment.stage,
            })

        # Calculate utilization and categorize
        utilization_summary = []
        underutilized = []
        overallocated = []

        for emp_id, data in employee_util.items():
            utilization = (
                (data['allocated'] / data['capacity'] * 100)
                if data['capacity'] > 0 else 0
            )

            employee_util_data = {
                'employee_id': emp_id,
                'name': data['name'],
                'department': dict(Department.choices).get(data['department'], data['department']),
                'capacity': data['capacity'],
                'allocated': round(data['allocated'], 2),
                'utilization_percent': round(utilization, 2),
                'assignment_count': len(data['assignments']),
            }

            utilization_summary.append(employee_util_data)

            if utilization < 50:
                underutilized.append(employee_util_data)
            elif utilization > 100:
                overallocated.append(employee_util_data)

        return Response({
            'period_start': week_start.isoformat(),
            'period_end': week_end.isoformat(),
            'total_employees': len(utilization_summary),
            'underutilized_count': len(underutilized),
            'overallocated_count': len(overallocated),
            'summary': sorted(utilization_summary, key=lambda x: x['utilization_percent'], reverse=True),
            'underutilized': sorted(underutilized, key=lambda x: x['utilization_percent']),
            'overallocated': sorted(overallocated, key=lambda x: x['utilization_percent'], reverse=True),
        })


class DepartmentStageConfigViewSet(viewsets.ModelViewSet):
    """
    ViewSet for DepartmentStageConfig model.

    Provides CRUD operations for department stage configurations:
    - Filtering by project and department
    - Ordering by project and department
    - Pagination

    Endpoints:
        GET /api/department-stages/ - List all configurations
        POST /api/department-stages/ - Create new configuration
        GET /api/department-stages/{id}/ - Get configuration details
        PUT /api/department-stages/{id}/ - Update configuration
        DELETE /api/department-stages/{id}/ - Delete configuration

    Permissions:
        - IsAuthenticated: User must be logged in
        - IsAdminOrReadOnly: Only staff can create/modify

    Query Parameters:
        - project: Filter by project UUID
        - department: Filter by department code
        - ordering: Order by field
        - page: Page number
        - page_size: Items per page
    """
    queryset = (
        DepartmentStageConfig.objects
        .all()
        .select_related('project')
    )
    serializer_class = DepartmentStageConfigSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['project', 'department']
    ordering_fields = ['project', 'department', 'week_start']
    ordering = ['project', 'department']

    def _ensure_full_access(self):
        if not _has_full_access(self.request.user):
            raise PermissionDenied("No permission to modify department stages.")

    def perform_create(self, serializer):
        self._ensure_full_access()
        serializer.save()

    def perform_update(self, serializer):
        self._ensure_full_access()
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_full_access()
        instance.delete()


class ProjectBudgetViewSet(viewsets.ModelViewSet):
    """
    ViewSet for ProjectBudget model.

    Provides CRUD operations for project budgets:
    - Filtering by project and department
    - Budget status tracking
    - Utilization calculations

    Endpoints:
        GET /api/project-budgets/ - List all budgets
        POST /api/project-budgets/ - Create new budget
        GET /api/project-budgets/{id}/ - Get budget details
        PUT /api/project-budgets/{id}/ - Update budget
        DELETE /api/project-budgets/{id}/ - Delete budget

    Permissions:
        - IsAuthenticated: User must be logged in
        - IsAdminOrReadOnly: Only staff can create/modify

    Query Parameters:
        - project: Filter by project UUID
        - department: Filter by department code
        - ordering: Order by field
        - page: Page number
        - page_size: Items per page
    """
    queryset = (
        ProjectBudget.objects
        .all()
        .select_related('project')
    )
    serializer_class = ProjectBudgetSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['project', 'department']
    ordering_fields = ['project', 'department', 'utilization_percent']
    ordering = ['project', 'department']

    def _ensure_full_access(self):
        if not _has_full_access(self.request.user):
            raise PermissionDenied("No permission to modify project budgets.")

    def perform_create(self, serializer):
        self._ensure_full_access()
        serializer.save()

    def perform_update(self, serializer):
        self._ensure_full_access()
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_full_access()
        instance.delete()

    def get_queryset(self):
        """Add filtering for budget status if requested."""
        queryset = super().get_queryset()

        status_filter = self.request.query_params.get('status')
        if status_filter in ['within', 'near', 'exceeded']:
            # We'll need to filter in Python since this is a computed property
            # This is acceptable for smaller datasets
            pass

        return queryset


class ProjectChangeOrderViewSet(viewsets.ModelViewSet):
    """
    ViewSet for ProjectChangeOrder model.

    Provides CRUD operations for project change orders:
    - Filtering by project and department
    - Search by change order name
    - Ordering by creation date and hours

    Endpoints:
        GET /api/project-change-orders/ - List all change orders
        POST /api/project-change-orders/ - Create new change order
        GET /api/project-change-orders/{id}/ - Get change order details
        PUT /api/project-change-orders/{id}/ - Update change order
        DELETE /api/project-change-orders/{id}/ - Delete change order

    Permissions:
        - IsAuthenticated: User must be logged in

    Query Parameters:
        - project: Filter by project UUID
        - department: Filter by department code
        - search: Search by change order name
        - ordering: Order by field
        - page: Page number
        - page_size: Items per page
    """
    queryset = (
        ProjectChangeOrder.objects
        .all()
        .select_related('project')
    )
    serializer_class = ProjectChangeOrderSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['project', 'department']
    search_fields = ['name']
    ordering_fields = ['created_at', 'updated_at', 'hours_quoted', 'name']
    ordering = ['-created_at']

    def _ensure_change_order_permission(self, department):
        if _has_full_access(self.request.user):
            return
        if _is_read_only_user(self.request.user):
            raise PermissionDenied("Read-only access.")
        if not _can_edit_department(self.request.user, department):
            raise PermissionDenied("No permission to modify this department.")

    def perform_create(self, serializer):
        department = serializer.validated_data.get('department') or self.request.data.get('department')
        self._ensure_change_order_permission(department)
        serializer.save()

    def perform_update(self, serializer):
        department = serializer.validated_data.get('department') or serializer.instance.department
        self._ensure_change_order_permission(department)
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_change_order_permission(instance.department)
        instance.delete()


class ActivityLogViewSet(viewsets.ModelViewSet):
    """
    ViewSet for ActivityLog model.

    Provides full CRUD access to activity logs for audit trail:
    - Filtering by user and model
    - Ordering by timestamp
    - Pagination with large result set

    Endpoints:
        GET /api/activity-logs/ - List all activity logs
        GET /api/activity-logs/{id}/ - Get log entry details
        POST /api/activity-logs/ - Create a new activity log

    Permissions:
        - IsAuthenticated: User must be logged in

    Query Parameters:
        - user: Filter by user ID
        - model_name: Filter by model name
        - action: Filter by action (created, updated, deleted, viewed)
        - start_date: Filter by date (YYYY-MM-DD)
        - ordering: Order by field (-created_at, etc)
        - page: Page number
        - page_size: Items per page
    """
    queryset = (
        ActivityLog.objects
        .all()
        .select_related('user')
    )
    serializer_class = ActivityLogSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = LargeResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['user', 'model_name', 'action']
    ordering_fields = ['created_at', 'user', 'action']
    ordering = ['-created_at']

    def perform_create(self, serializer):
        """Set the user when creating an activity log."""
        serializer.save(user=self.request.user)

    def get_queryset(self):
        """Return all activity logs for authenticated users."""
        queryset = super().get_queryset()

        # Filter by date range if provided
        start_date = self.request.query_params.get('start_date')
        if start_date:
            try:
                date = datetime.strptime(start_date, '%Y-%m-%d').date()
                queryset = queryset.filter(created_at__date__gte=date)
            except ValueError:
                pass

        end_date = self.request.query_params.get('end_date')
        if end_date:
            try:
                date = datetime.strptime(end_date, '%Y-%m-%d').date()
                queryset = queryset.filter(created_at__date__lte=date)
            except ValueError:
                pass

        return queryset


# ==================== SCIO TEAM CAPACITY VIEWSET ====================

class ScioTeamCapacityViewSet(viewsets.ModelViewSet):
    """
    API ViewSet for SCIO Team Capacity.

    Provides CRUD operations for managing SCIO team capacity per department and week.
    Supports upsert behavior: if a record with the same department+week exists, it will be updated.
    Pagination disabled to return all records at once (small dataset).
    """
    queryset = ScioTeamCapacity.objects.all()
    serializer_class = ScioTeamCapacitySerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None  # Disabled - return all records at once
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['department', 'week_start_date']
    ordering_fields = ['department', 'week_start_date', 'capacity']
    ordering = ['department', 'week_start_date']

    def _ensure_full_access(self):
        if not _has_full_access(self.request.user):
            raise PermissionDenied("No permission to modify SCIO team capacity.")

    def create(self, request, *args, **kwargs):
        """
        Override create to support upsert behavior.
        If a record with the same department+week_start_date exists, update it.
        Otherwise create a new one.
        """
        self._ensure_full_access()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        department = serializer.validated_data.get('department')
        week_start_date = serializer.validated_data.get('week_start_date')
        capacity = serializer.validated_data.get('capacity')

        obj, created = ScioTeamCapacity.objects.update_or_create(
            department=department,
            week_start_date=week_start_date,
            defaults={'capacity': capacity}
        )

        print(f"[ScioTeamCapacity] {'Created' if created else 'Updated'} record: {obj.id}, dept={department}, week={week_start_date}, capacity={capacity}")

        # Return the serialized object
        result_serializer = self.get_serializer(obj)
        return Response(result_serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def perform_update(self, serializer):
        self._ensure_full_access()
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_full_access()
        instance.delete()


# ==================== SUBCONTRACTED TEAM CAPACITY VIEWSET ====================

class SubcontractedTeamCapacityViewSet(viewsets.ModelViewSet):
    """
    API ViewSet for Subcontracted Team Capacity.

    Provides CRUD operations for managing subcontracted team capacity per company and week.
    Supports upsert behavior: if a record with the same company+week exists, it will be updated.
    Pagination disabled to return all records at once (small dataset).
    """
    queryset = SubcontractedTeamCapacity.objects.all()
    serializer_class = SubcontractedTeamCapacitySerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None  # Disabled - return all records at once
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['company', 'week_start_date']
    ordering_fields = ['company', 'week_start_date', 'capacity']
    ordering = ['company', 'week_start_date']

    def _ensure_full_access(self):
        if not _has_full_access(self.request.user):
            raise PermissionDenied("No permission to modify subcontracted team capacity.")

    def create(self, request, *args, **kwargs):
        """
        Override create to support upsert behavior.
        If a record with the same company+week_start_date exists, update it.
        Otherwise create a new one.
        """
        self._ensure_full_access()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        company = serializer.validated_data.get('company')
        week_start_date = serializer.validated_data.get('week_start_date')
        capacity = serializer.validated_data.get('capacity')

        obj, created = SubcontractedTeamCapacity.objects.update_or_create(
            company=company,
            week_start_date=week_start_date,
            defaults={'capacity': capacity}
        )

        print(f"[SubcontractedTeamCapacity] {'Created' if created else 'Updated'} record: {obj.id}, company={company}, week={week_start_date}, capacity={capacity}")

        # Return the serialized object
        result_serializer = self.get_serializer(obj)
        return Response(result_serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def perform_update(self, serializer):
        self._ensure_full_access()
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_full_access()
        instance.delete()


# ==================== PRG EXTERNAL TEAM CAPACITY VIEWSET ====================

class PrgExternalTeamCapacityViewSet(viewsets.ModelViewSet):
    """
    API ViewSet for PRG External Team Capacity.

    Provides CRUD operations for managing external team capacity for PRG department per week.
    Supports upsert behavior: if a record with the same team+week exists, it will be updated.
    Pagination disabled to return all records at once (small dataset).
    """
    queryset = PrgExternalTeamCapacity.objects.all()
    serializer_class = PrgExternalTeamCapacitySerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None  # Disabled - return all records at once
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['team_name', 'week_start_date']
    ordering_fields = ['team_name', 'week_start_date', 'capacity']
    ordering = ['team_name', 'week_start_date']

    def _ensure_full_access(self):
        if not _has_full_access(self.request.user):
            raise PermissionDenied("No permission to modify PRG external team capacity.")

    def create(self, request, *args, **kwargs):
        """
        Override create to support upsert behavior.
        If a record with the same team_name+week_start_date exists, update it.
        Otherwise create a new one.
        """
        self._ensure_full_access()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        team_name = serializer.validated_data.get('team_name')
        week_start_date = serializer.validated_data.get('week_start_date')
        capacity = serializer.validated_data.get('capacity')

        obj, created = PrgExternalTeamCapacity.objects.update_or_create(
            team_name=team_name,
            week_start_date=week_start_date,
            defaults={'capacity': capacity}
        )

        print(f"[PrgExternalTeamCapacity] {'Created' if created else 'Updated'} record: {obj.id}, team={team_name}, week={week_start_date}, capacity={capacity}")

        # Return the serialized object
        result_serializer = self.get_serializer(obj)
        return Response(result_serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def perform_update(self, serializer):
        self._ensure_full_access()
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_full_access()
        instance.delete()


class DepartmentWeeklyTotalViewSet(viewsets.ModelViewSet):
    """
    API ViewSet for Department Weekly Total.

    Provides CRUD operations for managing weekly occupancy total hours per department.
    This represents the total hours assigned to a department for a specific week.
    """
    queryset = DepartmentWeeklyTotal.objects.all()
    serializer_class = DepartmentWeeklyTotalSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['department', 'week_start_date']
    ordering_fields = ['department', 'week_start_date', 'total_hours']
    ordering = ['department', 'week_start_date']

    def _ensure_full_access(self):
        if not _has_full_access(self.request.user):
            raise PermissionDenied("No permission to modify department weekly totals.")

    def perform_create(self, serializer):
        self._ensure_full_access()
        serializer.save()

    def perform_update(self, serializer):
        self._ensure_full_access()
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_full_access()
        instance.delete()


class RegisteredUserViewSet(viewsets.ModelViewSet):
    """
    BI-only management for registered users.

    Endpoints:
        GET /api/registered-users/
        GET /api/registered-users/{id}/
        PATCH /api/registered-users/{id}/
        DELETE /api/registered-users/{id}/
    """
    queryset = (
        User.objects
        .filter(is_staff=False, is_superuser=False)
        .select_related('profile')
        .order_by('-date_joined')
    )
    serializer_class = RegisteredUserSerializer
    permission_classes = [IsAuthenticated, IsBusinessIntelligenceManager]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['username', 'email', 'first_name', 'last_name', 'profile__department', 'profile__other_department']
    ordering_fields = ['date_joined', 'email', 'first_name', 'last_name', 'is_active']
    ordering = ['-date_joined']

    def perform_destroy(self, instance):
        if instance.id == self.request.user.id:
            raise ValidationError({'detail': 'You cannot delete your own account from this view.'})
        instance.delete()


# ==================== USER REGISTRATION VIEWS ====================

from rest_framework import generics
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

logger = logging.getLogger(__name__)


class UserRegistrationView(generics.CreateAPIView):
    """
    User registration endpoint.

    POST /api/register/

    Accepts email, password, first_name, last_name, and department.
    Creates inactive user and sends verification email.

    Permissions:
        - AllowAny: Registration is open to anyone with valid email domain

    Request Body:
        {
            "email": "user@na.scio-automation.com",
            "password": "SecurePassword123!",
            "confirm_password": "SecurePassword123!",
            "first_name": "John",
            "last_name": "Doe",
            "department": "PM"
        }

    Response (201 Created):
        {
            "message": "Registration successful. Please check your email to verify your account.",
            "email": "user@na.scio-automation.com"
        }

    Rate Limiting:
        - Applied via DRF throttle (5/hour for anonymous users)
    """
    serializer_class = UserRegistrationSerializer
    permission_classes = [AllowAny]
    throttle_scope = 'registration'

    def create(self, request, *args, **kwargs):
        """Override create to customize response."""
        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
            user = serializer.save()
        except ValidationError:
            raise
        except Exception:
            logger.exception("Unexpected error during user registration")
            return Response(
                {"detail": "Registration temporarily unavailable. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        return Response(
            {
                "message": "Registration successful. Please check your email to verify your account.",
                "email": user.email
            },
            status=status.HTTP_201_CREATED
        )


class EmailVerificationView(APIView):
    """
    Email verification endpoint.

    GET /api/verify-email/<token>/

    Verifies user email and activates account.

    Permissions:
        - AllowAny: Anyone with valid token can verify

    Response (200 OK):
        {
            "message": "Email verified successfully. You can now log in.",
            "email": "user@na.scio-automation.com"
        }

    Error Responses:
        - 400: Token expired or invalid
        - 404: Token not found
    """
    permission_classes = [AllowAny]

    def get(self, request, token):
        """
        Verify email token and activate user account.

        Args:
            request: HTTP request
            token: Verification token from URL

        Returns:
            Response with success or error message
        """
        from .models import EmailVerification

        try:
            verification = EmailVerification.objects.select_related('user').get(token=token)
        except EmailVerification.DoesNotExist:
            return Response(
                {"error": "Invalid verification token."},
                status=status.HTTP_404_NOT_FOUND
            )

        # Check if already verified
        if verification.is_verified():
            return Response(
                {
                    "message": "Email already verified. You can log in.",
                    "email": verification.user.email
                },
                status=status.HTTP_200_OK
            )

        # Check if token expired
        if verification.is_expired():
            return Response(
                {"error": "Verification token has expired. Please request a new one."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Verify email and activate user
        user = verification.user
        user.is_active = True
        user.save()

        # Activate employee profile
        try:
            employee = user.employee
            employee.is_active = True
            employee.save()
        except:
            pass  # Employee might not exist

        # Mark verification as complete
        verification.verified_at = timezone.now()
        verification.save()

        # Log activity
        ActivityLog.objects.create(
            user=user,
            action='email_verified',
            model_name='User',
            object_id=str(user.id),
            changes={'email_verified': True}
        )

        return Response(
            {
                "message": "Email verified successfully. You can now log in.",
                "email": user.email
            },
            status=status.HTTP_200_OK
        )


class ResendVerificationEmailView(APIView):
    """
    Resend verification email endpoint.

    POST /api/resend-verification-email/

    Resends verification email if the first attempt failed.
    Useful if the user didn't receive the original email or it expired.

    Permissions:
        - AllowAny: Anyone can request to resend (rate limited)

    Request Body:
        {
            "email": "user@na.scio-automation.com"
        }

    Response (200 OK):
        {
            "message": "Verification email sent. Please check your email.",
            "email": "user@na.scio-automation.com"
        }

    Error Responses:
        - 400: User not found, already verified, or email sending failed
        - 404: User not found
    """
    permission_classes = [AllowAny]
    throttle_scope = 'registration'  # Same rate limiting as registration

    def post(self, request):
        """
        Resend verification email to user.

        Args:
            request: HTTP request with email in body

        Returns:
            Response with success or error message
        """
        from django.contrib.auth.models import User

        email = request.data.get('email', '').lower()

        if not email:
            return Response(
                {"error": "Email address is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response(
                {"error": "User with this email not found."},
                status=status.HTTP_404_NOT_FOUND
            )

        # Check if user is already verified
        try:
            verification = EmailVerification.objects.get(user=user)
            if verification.is_verified():
                return Response(
                    {"error": "This email is already verified. You can log in."},
                    status=status.HTTP_400_BAD_REQUEST
                )
        except EmailVerification.DoesNotExist:
            return Response(
                {"error": "No verification record found for this user."},
                status=status.HTTP_404_NOT_FOUND
            )

        # Regenerate verification code and resend email
        import secrets
        import threading
        from .serializers import UserRegistrationSerializer

        try:
            # Generate new code and reset attempts
            verification.token = secrets.token_urlsafe(32)
            verification.code = EmailVerification.generate_code()
            verification.attempts = 0
            verification.created_at = timezone.now()  # Reset expiry
            verification.save()

            # Send email in background thread
            def send_email_background():
                try:
                    serializer = UserRegistrationSerializer()
                    serializer._send_verification_code_email(user, verification.code)
                except Exception as e:
                    import logging
                    logger = logging.getLogger(__name__)
                    logger.error(f"Failed to send verification email to {user.email}: {str(e)}")

            email_thread = threading.Thread(target=send_email_background)
            email_thread.daemon = True
            email_thread.start()

            # Log activity
            ActivityLog.objects.create(
                user=user,
                action='verification_code_resent',
                model_name='EmailVerification',
                object_id=str(verification.id),
                changes={'resent_at': timezone.now().isoformat()}
            )

            return Response(
                {
                    "message": "Verification code sent. Please check your email.",
                    "email": user.email
                },
                status=status.HTTP_200_OK
            )

        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Failed to resend verification code to {user.email}: {str(e)}")

            return Response(
                {"error": f"Failed to send verification code. Please try again later."},
                status=status.HTTP_400_BAD_REQUEST
            )


class VerifyCodeView(APIView):
    """
    Verify email using 6-digit code.

    POST /api/verify-code/

    Request Body:
        {
            "email": "user@na.scio-automation.com",
            "code": "123456"
        }

    Response (200 OK):
        {
            "message": "Email verified successfully. You can now log in.",
            "email": "user@na.scio-automation.com"
        }

    Error Responses:
        - 400: Invalid code, expired, or max attempts reached
        - 404: User not found
    """
    permission_classes = [AllowAny]
    throttle_scope = 'registration'

    def post(self, request):
        from django.contrib.auth.models import User

        email = request.data.get('email', '').lower()
        code = request.data.get('code', '').strip()

        if not email or not code:
            return Response(
                {"error": "Email and code are required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response(
                {"error": "User not found."},
                status=status.HTTP_404_NOT_FOUND
            )

        try:
            verification = EmailVerification.objects.get(user=user)
        except EmailVerification.DoesNotExist:
            return Response(
                {"error": "No verification record found."},
                status=status.HTTP_404_NOT_FOUND
            )

        # Check if already verified
        if verification.is_verified():
            return Response(
                {"message": "Email already verified. You can log in.", "email": email},
                status=status.HTTP_200_OK
            )

        # Check max attempts
        if verification.max_attempts_reached():
            return Response(
                {"error": "Too many failed attempts. Please request a new code."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check if code expired
        if verification.is_expired():
            return Response(
                {"error": "Code expired. Please request a new code."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Verify code
        if verification.code != code:
            verification.attempts += 1
            verification.save()
            remaining = 5 - verification.attempts
            return Response(
                {"error": f"Invalid code. {remaining} attempts remaining."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Success! Activate user
        user.is_active = True
        user.save()

        verification.verified_at = timezone.now()
        verification.save()

        # Log activity
        ActivityLog.objects.create(
            user=user,
            action='email_verified',
            model_name='User',
            object_id=str(user.id),
            changes={'email_verified': True, 'method': 'code'}
        )

        return Response(
            {"message": "Email verified successfully. You can now log in.", "email": email},
            status=status.HTTP_200_OK
        )


# ==================== AUTHENTICATION VIEWS ====================

class CaseInsensitiveTokenObtainPairView(APIView):
    """
    Custom token view that accepts case-insensitive username.

    Allows users to login with username in any case (e.g., MARCO.SOTO or marco.soto).
    """
    permission_classes = []
    authentication_classes = []

    def post(self, request):
        from capacity.serializers import CaseInsensitiveTokenObtainPairSerializer

        serializer = CaseInsensitiveTokenObtainPairSerializer(data=request.data, context={'request': request})
        if serializer.is_valid():
            return Response({
                'access': serializer.validated_data['access'],
                'refresh': serializer.validated_data['refresh'],
                'user_id': serializer.validated_data['user_id'],
                'username': serializer.validated_data['username'],
                'email': serializer.validated_data['email'],
            }, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_401_UNAUTHORIZED)


class LogoutView(APIView):
    """
    Logout view that deactivates the current user session.

    Marks the session associated with the current access/refresh token as inactive,
    allowing another device to login if the user reached the device limit.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from capacity.models import UserSession
        from rest_framework_simplejwt.tokens import UntypedToken

        try:
            refresh_token = request.data.get('refresh')
            session_id = None

            auth_header = request.META.get('HTTP_AUTHORIZATION', '')
            if auth_header.startswith('Bearer '):
                access_token = auth_header.split(' ')[1]
                try:
                    decoded = UntypedToken(access_token)
                    session_id = decoded.get('session_id')
                except Exception:
                    session_id = None

            if session_id:
                UserSession.objects.filter(
                    user=request.user,
                    id=session_id,
                    is_active=True,
                ).update(is_active=False, last_activity=timezone.now())
            elif refresh_token:
                UserSession.objects.filter(
                    user=request.user,
                    refresh_token=refresh_token,
                    is_active=True,
                ).update(is_active=False, last_activity=timezone.now())
            else:
                UserSession.objects.filter(
                    user=request.user,
                    is_active=True,
                ).update(is_active=False, last_activity=timezone.now())

            return Response({
                'detail': 'Sesion cerrada exitosamente.'
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({
                'detail': f'Error al cerrar sesion: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class SessionStatusView(APIView):
    """
    View to check if the current session is still active.

    Returns:
    - 200 OK: Session is active
    - 401 Unauthorized: Session is inactive or has been logged out
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from capacity.models import UserSession
        from rest_framework_simplejwt.tokens import UntypedToken

        inactivity_timeout_minutes = max(
            1,
            int(getattr(settings, 'SESSION_INACTIVITY_TIMEOUT_MINUTES', 20)),
        )
        inactivity_threshold = timezone.now() - timedelta(minutes=inactivity_timeout_minutes)

        try:
            auth_header = request.META.get('HTTP_AUTHORIZATION', '')

            if auth_header.startswith('Bearer '):
                token = auth_header.split(' ')[1]
                decoded = UntypedToken(token)
                session_id = decoded.get('session_id')

                UserSession.objects.filter(
                    user=request.user,
                    is_active=True,
                    last_activity__lt=inactivity_threshold,
                ).update(is_active=False)

                if session_id:
                    session = UserSession.objects.filter(
                        id=session_id,
                        user=request.user,
                    ).first()

                    if session and session.is_active:
                        return Response({
                            'status': 'active',
                            'detail': 'Sesion activa',
                            'user': request.user.username,
                            'session_id': str(session.id),
                        }, status=status.HTTP_200_OK)

                    return Response({
                        'status': 'inactive',
                        'detail': 'Sesion inactiva o ha sido cerrada.',
                    }, status=status.HTTP_401_UNAUTHORIZED)

                # Backward compatibility for tokens minted before `session_id` claim.
                active_sessions = UserSession.objects.filter(
                    user=request.user,
                    is_active=True,
                ).count()

                if active_sessions > 0:
                    return Response({
                        'status': 'active',
                        'detail': 'Sesion activa',
                        'user': request.user.username,
                    }, status=status.HTTP_200_OK)

                return Response({
                    'status': 'inactive',
                    'detail': 'Sesion inactiva o ha sido cerrada.',
                }, status=status.HTTP_401_UNAUTHORIZED)

            return Response({
                'status': 'error',
                'detail': 'Token no proporcionado',
            }, status=status.HTTP_400_BAD_REQUEST)

        except Exception as e:
            return Response({
                'status': 'error',
                'detail': f'Error al verificar sesion: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class ChangePasswordView(APIView):
    """
    View to change user password.

    Requires:
    - current_password: Current password for verification
    - new_password: New password to set
    - confirm_password: Confirmation of new password (must match new_password)
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            current_password = request.data.get('current_password')
            new_password = request.data.get('new_password')
            confirm_password = request.data.get('confirm_password')

            # Validate inputs
            if not current_password or not new_password or not confirm_password:
                return Response({
                    'detail': 'Por favor, proporciona la contraseña actual, nueva y confirmación.'
                }, status=status.HTTP_400_BAD_REQUEST)

            # Check if new password and confirm password match
            if new_password != confirm_password:
                return Response({
                    'detail': 'Las contraseñas nuevas no coinciden.'
                }, status=status.HTTP_400_BAD_REQUEST)

            # Check if new password is different from current
            if current_password == new_password:
                return Response({
                    'detail': 'La nueva contraseña debe ser diferente de la actual.'
                }, status=status.HTTP_400_BAD_REQUEST)

            # Verify current password
            if not request.user.check_password(current_password):
                return Response({
                    'detail': 'La contraseña actual es incorrecta.'
                }, status=status.HTTP_401_UNAUTHORIZED)

            # Validate new password strength (minimum 8 characters)
            if len(new_password) < 8:
                return Response({
                    'detail': 'La nueva contraseña debe tener al menos 8 caracteres.'
                }, status=status.HTTP_400_BAD_REQUEST)

            # Change password
            request.user.set_password(new_password)
            request.user.save()

            # Invalidate all sessions for this user (they need to login again with new password)
            from capacity.models import UserSession
            UserSession.objects.filter(user=request.user).update(is_active=False)

            return Response({
                'detail': 'Contraseña actualizada correctamente. Por favor, inicia sesión nuevamente.'
            }, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({
                'detail': f'Error al cambiar contraseña: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
