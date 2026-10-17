from datetime import date, timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.urls import reverse
from django.utils import timezone
from rest_framework_simplejwt.tokens import UntypedToken
from rest_framework import status
from rest_framework.test import APITestCase

from .models import (
    ActivityLog,
    Assignment,
    Department,
    DepartmentHourlyCost,
    DepartmentStageConfig,
    Employee,
    ExternalProviderRate,
    ExternalTeamHeadcountEvent,
    Facility,
    OtherDepartment,
    PrgExternalTeamCapacity,
    Project,
    ProjectBudget,
    ProjectChangeOrder,
    ScioHeadcountEvent,
    ScioTeamCapacity,
    Stage,
    SubcontractedTeamCapacity,
    UserDepartment,
    UserProfile,
    UserSession,
)


class ProjectSoftDeleteTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='softdelete-admin',
            password='test-password',
            is_staff=True,
        )
        self.client.force_authenticate(user=self.user)

        self.employee = Employee.objects.create(
            name='Soft Delete Tester',
            role='Engineer',
            department=Department.PRG,
            capacity=40,
            is_active=True,
        )

        self.project = Project.objects.create(
            name='Soft Delete Project',
            client='Internal',
            start_date=date.today(),
            end_date=date.today() + timedelta(days=28),
            facility=Facility.MX,
            number_of_weeks=4,
        )

        self.assignment = Assignment.objects.create(
            employee=self.employee,
            project=self.project,
            week_start_date=date.today(),
            hours=12,
            stage=None,
        )

    @staticmethod
    def _extract_results(response):
        if isinstance(response.data, dict) and 'results' in response.data:
            return response.data['results']
        return response.data

    def test_delete_project_hides_instead_of_hard_deleting(self):
        delete_response = self.client.delete(reverse('project-detail', args=[self.project.id]))
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)

        self.project.refresh_from_db()
        self.assertTrue(self.project.is_hidden)
        self.assertIsNotNone(self.project.hidden_at)
        self.assertTrue(Assignment.objects.filter(id=self.assignment.id).exists())

        visible_projects_response = self.client.get(reverse('project-list'))
        visible_projects = self._extract_results(visible_projects_response)
        visible_ids = {str(item['id']) for item in visible_projects}
        self.assertNotIn(str(self.project.id), visible_ids)

        all_projects_response = self.client.get(reverse('project-list'), {'include_hidden': 'true'})
        all_projects = self._extract_results(all_projects_response)
        all_ids = {str(item['id']) for item in all_projects}
        self.assertIn(str(self.project.id), all_ids)

    def test_assignment_list_excludes_hidden_project_by_default(self):
        self.project.is_hidden = True
        self.project.hidden_at = timezone.now()
        self.project.save(update_fields=['is_hidden', 'hidden_at', 'updated_at'])

        visible_assignments_response = self.client.get(reverse('assignment-list'))
        visible_assignments = self._extract_results(visible_assignments_response)
        visible_ids = {str(item['id']) for item in visible_assignments}
        self.assertNotIn(str(self.assignment.id), visible_ids)

        all_assignments_response = self.client.get(reverse('assignment-list'), {'include_hidden': 'true'})
        all_assignments = self._extract_results(all_assignments_response)
        all_ids = {str(item['id']) for item in all_assignments}
        self.assertIn(str(self.assignment.id), all_ids)


class ProjectDepartmentPermissionTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='prg-dept-user',
            password='test-password',
            is_active=True,
        )
        UserProfile.objects.create(
            user=self.user,
            department=UserDepartment.PRG,
        )
        self.client.force_authenticate(user=self.user)

        self.existing_project = Project.objects.create(
            name='Existing Shared Project',
            client='Internal',
            start_date=date(2026, 1, 6),
            end_date=date(2026, 2, 2),
            facility=Facility.MX,
            number_of_weeks=4,
            visible_in_departments=[Department.MED],
        )
        DepartmentStageConfig.objects.create(
            project=self.existing_project,
            department=Department.MED,
            stage=None,
            week_start=1,
            week_end=4,
            department_start_date=date(2026, 1, 6),
            duration_weeks=4,
        )
        ProjectBudget.objects.create(
            project=self.existing_project,
            department=Department.MED,
            hours_allocated=20,
        )

    @staticmethod
    def _create_payload_for_department(department):
        return {
            'name': f'Quick Create {department}',
            'client': 'Internal',
            'start_date': '2026-01-06',
            'end_date': '2026-02-02',
            'facility': Facility.MX,
            'number_of_weeks': 4,
            'visible_in_departments': [department],
            'department_stages': {
                department: [
                    {
                        'stage': None,
                        'week_start': 1,
                        'week_end': 4,
                        'department_start_date': '2026-01-06',
                        'duration_weeks': 4,
                    }
                ]
            },
            'department_hours_allocated': {
                Department.PM: 0,
                Department.MED: 0,
                Department.HD: 0,
                Department.MFG: 0,
                Department.BUILD: 0,
                Department.PRG: 0,
                department: 20,
            },
        }

    def test_department_user_can_create_project_for_own_department(self):
        payload = self._create_payload_for_department(Department.PRG)

        response = self.client.post(reverse('project-list'), payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn(Department.PRG, response.data.get('visible_in_departments', []))

    def test_department_user_cannot_create_project_for_other_department(self):
        payload = self._create_payload_for_department(Department.MED)

        response = self.client.post(reverse('project-list'), payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_department_user_can_import_project_into_own_department(self):
        payload = {
            'department_stages': {
                Department.MED: [
                    {
                        'stage': None,
                        'week_start': 1,
                        'week_end': 4,
                        'department_start_date': '2026-01-06',
                        'duration_weeks': 4,
                    }
                ],
                Department.PRG: [
                    {
                        'stage': None,
                        'week_start': 1,
                        'week_end': 5,
                        'department_start_date': '2026-01-13',
                        'duration_weeks': 5,
                    }
                ],
            },
            'department_hours_allocated': {
                Department.MED: 20,
                Department.PRG: 35,
            },
            'visible_in_departments': [Department.MED, Department.PRG],
        }

        response = self.client.patch(
            reverse('project-detail', args=[self.existing_project.id]),
            payload,
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.existing_project.refresh_from_db()
        self.assertIn(Department.PRG, self.existing_project.visible_in_departments or [])
        self.assertTrue(
            DepartmentStageConfig.objects.filter(
                project=self.existing_project,
                department=Department.PRG,
            ).exists()
        )
        self.assertEqual(
            ProjectBudget.objects.get(
                project=self.existing_project,
                department=Department.PRG,
            ).hours_allocated,
            35,
        )

    def test_department_user_cannot_modify_other_department_allocation(self):
        response = self.client.patch(
            reverse('project-detail', args=[self.existing_project.id]),
            {'department_hours_allocated': {Department.MED: 25}},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_department_user_cannot_set_quoted_amount(self):
        response = self.client.patch(
            reverse('project-detail', args=[self.existing_project.id]),
            {'department_cost_allocated': {Department.PRG: 1500}},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class ProjectQuotedAmountTests(APITestCase):
    """Quoted $ per department (Qtd $ in the Summary): full-access only, null = not registered."""

    def setUp(self):
        self.pm_user = User.objects.create_user(username='pm-quote-user', password='test-password', is_active=True)
        UserProfile.objects.create(user=self.pm_user, department=UserDepartment.PM)
        self.project = Project.objects.create(
            name='Quoted Amount Project',
            client='Internal',
            start_date='2026-01-05',
            end_date='2026-02-01',
            facility=Facility.MX,
            number_of_weeks=4,
        )
        ProjectBudget.objects.create(project=self.project, department=Department.MED, hours_allocated=40)
        self.client.force_authenticate(user=self.pm_user)

    def test_full_access_user_can_set_and_read_quoted_amount(self):
        response = self.client.patch(
            reverse('project-detail', args=[self.project.id]),
            {
                'department_hours_allocated': {Department.MED: 40},
                'department_cost_allocated': {Department.MED: '1234.50'},
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['department_cost_allocated'], {Department.MED: 1234.5})
        self.assertEqual(
            ProjectBudget.objects.get(project=self.project, department=Department.MED).hours_allocated, 40
        )

    def test_departments_without_amount_are_omitted_and_empty_clears(self):
        self.client.patch(
            reverse('project-detail', args=[self.project.id]),
            {'department_cost_allocated': {Department.MED: 500}},
            format='json',
        )
        detail = self.client.get(reverse('project-detail', args=[self.project.id]))
        self.assertEqual(detail.data['department_cost_allocated'], {Department.MED: 500.0})

        self.client.patch(
            reverse('project-detail', args=[self.project.id]),
            {'department_cost_allocated': {Department.MED: ''}},
            format='json',
        )
        detail = self.client.get(reverse('project-detail', args=[self.project.id]))
        self.assertEqual(detail.data['department_cost_allocated'], {})

    def test_updating_hours_alone_keeps_registered_amount(self):
        self.client.patch(
            reverse('project-detail', args=[self.project.id]),
            {'department_cost_allocated': {Department.MED: 500}},
            format='json',
        )
        self.client.patch(
            reverse('project-detail', args=[self.project.id]),
            {'department_hours_allocated': {Department.MED: 60}},
            format='json',
        )
        budget = ProjectBudget.objects.get(project=self.project, department=Department.MED)
        self.assertEqual(budget.hours_allocated, 60)
        self.assertEqual(str(budget.cost_allocated), '500.00')


class ChangeOrderRegistrationTests(APITestCase):
    """
    Change Orders are now registered from the Projects page, two ways:
    (1) ProjectChangeOrder rows that widen an existing project's budget (hours + $,
        per department, grouped under a shared `name`); (2) a brand-new Project with
        `parent_project` pointing back at the original. Department-level edit access
        (same as editing assignments), not full-access-only.
    """

    def setUp(self):
        self.med_user = User.objects.create_user(username='med-co-user', password='test-password', is_active=True)
        UserProfile.objects.create(user=self.med_user, department=UserDepartment.MED)
        self.build_user = User.objects.create_user(username='build-co-user', password='test-password', is_active=True)
        UserProfile.objects.create(user=self.build_user, department=UserDepartment.BUILD)

        self.project = Project.objects.create(
            name='Original Project',
            client='Internal',
            start_date='2026-01-05',
            end_date='2026-02-01',
            facility=Facility.MX,
            number_of_weeks=4,
        )
        ProjectBudget.objects.create(project=self.project, department=Department.MED, hours_allocated=40)

    def test_department_user_can_register_co_with_hours_and_cost_for_own_department(self):
        self.client.force_authenticate(user=self.med_user)
        response = self.client.post(
            reverse('project-change-order-list'),
            {
                'project_id': str(self.project.id),
                'department': Department.MED,
                'name': 'CO01',
                'hours_quoted': 10,
                'cost_quoted': '750.00',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['cost_quoted'], '750.00')
        self.assertTrue(
            ProjectChangeOrder.objects.filter(project=self.project, department=Department.MED, name='CO01').exists()
        )

    def test_department_user_cannot_register_co_for_other_department(self):
        self.client.force_authenticate(user=self.med_user)
        response = self.client.post(
            reverse('project-change-order-list'),
            {
                'project_id': str(self.project.id),
                'department': Department.BUILD,
                'name': 'CO01',
                'hours_quoted': 10,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_one_co_name_can_span_multiple_departments(self):
        self.client.force_authenticate(user=self.med_user)
        self.client.post(
            reverse('project-change-order-list'),
            {'project_id': str(self.project.id), 'department': Department.MED, 'name': 'CO01', 'hours_quoted': 10},
            format='json',
        )
        self.client.force_authenticate(user=self.build_user)
        self.client.post(
            reverse('project-change-order-list'),
            {'project_id': str(self.project.id), 'department': Department.BUILD, 'name': 'CO01', 'hours_quoted': 5},
            format='json',
        )
        self.assertEqual(
            ProjectChangeOrder.objects.filter(project=self.project, name='CO01').count(), 2
        )

    def test_co_registered_as_new_project_links_back_to_parent(self):
        self.client.force_authenticate(user=self.med_user)
        response = self.client.post(
            reverse('project-list'),
            {
                'name': 'Original Project - CO01',
                'client': 'Internal',
                'start_date': '2026-02-01',
                'end_date': '2026-03-01',
                'facility': Facility.MX,
                'number_of_weeks': 4,
                'parent_project_id': str(self.project.id),
                'department_hours_allocated': {Department.MED: 10},
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['parent_project_name'], 'Original Project')
        created = Project.objects.get(id=response.data['id'])
        self.assertEqual(created.parent_project_id, self.project.id)

    def test_project_cannot_be_its_own_parent(self):
        self.client.force_authenticate(user=self.med_user)
        response = self.client.patch(
            reverse('project-detail', args=[self.project.id]),
            {'parent_project_id': str(self.project.id)},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class AssignmentPastWeekLockTests(APITestCase):
    """
    Past weeks are locked to hours coming from the Finance actuals report, but a
    department manager should still be able to relabel which stage those hours
    belong to (see recompute-free stage_only path in AssignmentViewSet).
    """

    def setUp(self):
        self.user = User.objects.create_user(
            username='med-dept-user',
            password='test-password',
            is_active=True,
        )
        UserProfile.objects.create(user=self.user, department=UserDepartment.MED)
        self.client.force_authenticate(user=self.user)

        self.employee = Employee.objects.create(
            name='Past Week Tester',
            role='Engineer',
            department=Department.MED,
            capacity=45,
        )
        self.other_employee = Employee.objects.create(
            name='Past Week Tester 2',
            role='Engineer',
            department=Department.MED,
            capacity=45,
        )
        self.project = Project.objects.create(
            name='Past Week Project',
            client='Internal',
            start_date=date(2020, 1, 6),
            end_date=date(2030, 12, 30),
            facility=Facility.MX,
            number_of_weeks=1,
            visible_in_departments=[Department.MED],
        )

        today = timezone.localdate()
        current_week_start = today - timedelta(days=today.weekday())
        self.past_week = current_week_start - timedelta(weeks=2)

        self.assignment = Assignment.objects.create(
            employee=self.employee,
            project=self.project,
            week_start_date=self.past_week,
            hours=5,
            stage=Stage.CONCEPT,
        )

    def test_department_user_cannot_change_hours_in_past_week(self):
        response = self.client.patch(
            reverse('assignment-detail', args=[self.assignment.id]),
            {'hours': 8},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assignment.refresh_from_db()
        self.assertEqual(self.assignment.hours, 5)

    def test_department_user_can_relabel_stage_in_past_week_without_changing_hours(self):
        response = self.client.patch(
            reverse('assignment-detail', args=[self.assignment.id]),
            {'stage': Stage.DETAIL_DESIGN},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assignment.refresh_from_db()
        self.assertEqual(self.assignment.stage, Stage.DETAIL_DESIGN)
        self.assertEqual(self.assignment.hours, 5)

    def test_department_user_cannot_create_assignment_with_hours_in_past_week(self):
        response = self.client.post(
            reverse('assignment-list'),
            {
                'employee_id': str(self.other_employee.id),
                'project_id': str(self.project.id),
                'week_start_date': self.past_week.isoformat(),
                'hours': 3,
                'stage': Stage.CONCEPT,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_department_user_can_create_zero_hour_stage_entry_in_past_week(self):
        response = self.client.post(
            reverse('assignment-list'),
            {
                'employee_id': str(self.other_employee.id),
                'project_id': str(self.project.id),
                'week_start_date': self.past_week.isoformat(),
                'hours': 0,
                'stage': Stage.DETAIL_DESIGN,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_department_user_cannot_delete_assignment_in_past_week(self):
        response = self.client.delete(
            reverse('assignment-detail', args=[self.assignment.id])
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Assignment.objects.filter(id=self.assignment.id).exists())

    def test_full_access_user_can_still_change_hours_in_past_week(self):
        pm_user = User.objects.create_user(
            username='pm-user',
            password='test-password',
            is_active=True,
        )
        UserProfile.objects.create(user=pm_user, department=UserDepartment.PM)
        self.client.force_authenticate(user=pm_user)

        response = self.client.patch(
            reverse('assignment-detail', args=[self.assignment.id]),
            {'hours': 9},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assignment.refresh_from_db()
        self.assertEqual(self.assignment.hours, 9)


class AssignmentMultiStageTests(APITestCase):
    """
    An employee can split a single project/week across multiple stages (the
    Capacity Matrix's stage planner). This requires one Assignment row per
    stage for the same employee+project+week -- regression coverage for a bug
    where `unique_together` omitted `stage`, so the second stage's create hit
    the first row's constraint and raised an uncaught IntegrityError (500)
    instead of succeeding.
    """

    def setUp(self):
        self.user = User.objects.create_user(
            username='med-multistage-user',
            password='test-password',
            is_active=True,
        )
        UserProfile.objects.create(user=self.user, department=UserDepartment.MED)
        self.client.force_authenticate(user=self.user)

        self.employee = Employee.objects.create(
            name='Multi Stage Tester',
            role='Engineer',
            department=Department.MED,
            capacity=45,
        )
        self.project = Project.objects.create(
            name='Multi Stage Project',
            client='Internal',
            start_date=date(2020, 1, 6),
            end_date=date(2030, 12, 30),
            facility=Facility.MX,
            number_of_weeks=1,
            visible_in_departments=[Department.MED],
        )
        today = timezone.localdate()
        self.future_week = (today - timedelta(days=today.weekday())) + timedelta(weeks=2)

    def _create(self, stage, hours):
        return self.client.post(
            reverse('assignment-list'),
            {
                'employee_id': str(self.employee.id),
                'project_id': str(self.project.id),
                'week_start_date': self.future_week.isoformat(),
                'hours': hours,
                'stage': stage,
            },
            format='json',
        )

    def test_can_create_two_stages_for_same_employee_project_week(self):
        response1 = self._create(Stage.DETAIL_DESIGN, 5)
        self.assertEqual(response1.status_code, status.HTTP_201_CREATED)

        response2 = self._create(Stage.CONCEPT, 1)
        self.assertEqual(response2.status_code, status.HTTP_201_CREATED)

        rows = Assignment.objects.filter(
            employee=self.employee, project=self.project, week_start_date=self.future_week
        )
        self.assertEqual(rows.count(), 2)
        self.assertEqual({row.stage for row in rows}, {Stage.DETAIL_DESIGN, Stage.CONCEPT})

    def test_duplicate_stage_for_same_employee_project_week_is_rejected_cleanly(self):
        response1 = self._create(Stage.DETAIL_DESIGN, 5)
        self.assertEqual(response1.status_code, status.HTTP_201_CREATED)

        response2 = self._create(Stage.DETAIL_DESIGN, 2)
        self.assertEqual(response2.status_code, status.HTTP_400_BAD_REQUEST)


class DepartmentCapacityDelegationTests(APITestCase):
    """
    SCIO Team Members/PTO/Training, the headcount hire/departure ledger, and
    BUILD/PRG's subcontracted/external team capacity used to be full-access
    (PM/BI) only. They're now delegated per-department like Employees/
    Assignments/Projects: a department manager can edit their own department's
    numbers (with the usual BUILD<->MFG shared-edit exception), but not
    another department's.
    """

    def _user_for(self, username, department, other_department=None):
        user = User.objects.create_user(username=username, password='test-password', is_active=True)
        UserProfile.objects.create(user=user, department=department, other_department=other_department)
        return user

    def setUp(self):
        self.pm_user = self._user_for('pm-capacity-user', UserDepartment.PM)
        self.med_user = self._user_for('med-capacity-user', UserDepartment.MED)
        self.hd_user = self._user_for('hd-capacity-user', UserDepartment.HD)
        self.build_user = self._user_for('build-capacity-user', UserDepartment.BUILD)
        self.mfg_user = self._user_for('mfg-capacity-user', UserDepartment.MFG)
        self.prg_user = self._user_for('prg-capacity-user', UserDepartment.PRG)
        self.readonly_user = self._user_for(
            'readonly-capacity-user', UserDepartment.OTHER, OtherDepartment.OPERATIONS
        )
        today = timezone.localdate()
        self.week = (today - timedelta(days=today.weekday())) + timedelta(weeks=2)

    def test_department_user_can_set_own_department_scio_capacity(self):
        self.client.force_authenticate(user=self.med_user)
        response = self.client.post(
            reverse('scio-team-capacity-list'),
            {'department': Department.MED, 'week_start_date': self.week.isoformat(), 'capacity': 6},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            ScioTeamCapacity.objects.filter(department=Department.MED, week_start_date=self.week, capacity=6).exists()
        )

    def test_department_user_cannot_set_other_department_scio_capacity(self):
        self.client.force_authenticate(user=self.med_user)
        response = self.client.post(
            reverse('scio-team-capacity-list'),
            {'department': Department.HD, 'week_start_date': self.week.isoformat(), 'capacity': 6},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_build_and_mfg_can_edit_each_others_scio_capacity(self):
        self.client.force_authenticate(user=self.build_user)
        response = self.client.post(
            reverse('scio-team-capacity-list'),
            {'department': Department.MFG, 'week_start_date': self.week.isoformat(), 'capacity': 4},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        self.client.force_authenticate(user=self.mfg_user)
        response = self.client.post(
            reverse('scio-team-capacity-list'),
            {'department': Department.BUILD, 'week_start_date': self.week.isoformat(), 'capacity': 3},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_readonly_user_cannot_set_scio_capacity(self):
        self.client.force_authenticate(user=self.readonly_user)
        response = self.client.post(
            reverse('scio-team-capacity-list'),
            {'department': Department.MED, 'week_start_date': self.week.isoformat(), 'capacity': 6},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_department_user_can_log_own_department_headcount_event(self):
        self.client.force_authenticate(user=self.med_user)
        response = self.client.post(
            reverse('scio-headcount-event-list'),
            {'department': Department.MED, 'effective_date': self.week.isoformat(), 'delta': 2},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(ScioHeadcountEvent.objects.filter(department=Department.MED).exists())
        # The recompute helper should have written ScioTeamCapacity for this week.
        self.assertTrue(
            ScioTeamCapacity.objects.filter(department=Department.MED, week_start_date=self.week, capacity=2).exists()
        )

    def test_department_user_cannot_log_other_department_headcount_event(self):
        self.client.force_authenticate(user=self.hd_user)
        response = self.client.post(
            reverse('scio-headcount-event-list'),
            {'department': Department.MED, 'effective_date': self.week.isoformat(), 'delta': 2},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_build_user_can_edit_subcontracted_capacity_med_user_cannot(self):
        self.client.force_authenticate(user=self.build_user)
        response = self.client.post(
            reverse('subcontracted-team-capacity-list'),
            {'company': 'AMI', 'week_start_date': self.week.isoformat(), 'capacity': 3},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        self.client.force_authenticate(user=self.med_user)
        response = self.client.post(
            reverse('subcontracted-team-capacity-list'),
            {'company': 'VICER', 'week_start_date': self.week.isoformat(), 'capacity': 2},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_prg_user_can_edit_external_capacity_med_user_cannot_for_prg(self):
        self.client.force_authenticate(user=self.prg_user)
        response = self.client.post(
            reverse('prg-external-team-capacity-list'),
            {'department': Department.PRG, 'team_name': 'External Team A', 'week_start_date': self.week.isoformat(), 'capacity': 3},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        self.client.force_authenticate(user=self.med_user)
        response = self.client.post(
            reverse('prg-external-team-capacity-list'),
            {'department': Department.PRG, 'team_name': 'External Team B', 'week_start_date': self.week.isoformat(), 'capacity': 2},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_med_user_can_edit_own_department_external_capacity(self):
        """External team capacity was generalized from PRG-only to MED/HD/MFG/BUILD/PRG."""
        self.client.force_authenticate(user=self.med_user)
        response = self.client.post(
            reverse('prg-external-team-capacity-list'),
            {'department': Department.MED, 'team_name': 'External Team C', 'week_start_date': self.week.isoformat(), 'capacity': 4},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            PrgExternalTeamCapacity.objects.filter(department=Department.MED, team_name='External Team C').exists()
        )

    def test_external_team_capacity_not_available_for_pm_or_purchasing(self):
        """PM/PURCHASING don't get this feature, even for a full-access (PM) user."""
        self.client.force_authenticate(user=self.pm_user)
        response = self.client.post(
            reverse('prg-external-team-capacity-list'),
            {'department': Department.PM, 'team_name': 'Nope', 'week_start_date': self.week.isoformat(), 'capacity': 1},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.post(
            reverse('prg-external-team-capacity-list'),
            {'department': Department.PURCHASING, 'team_name': 'Nope', 'week_start_date': self.week.isoformat(), 'capacity': 1},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class ExternalTeamHeadcountEventTests(APITestCase):
    """
    The "+ / - External Staff" ledger (ExternalTeamHeadcountEvent): same idea as
    SCIO headcount events, but scoped to one (department, team_name) and, unlike
    SCIO events, rejects backdated effective dates. MED/HD/MFG/PRG recompute
    PrgExternalTeamCapacity; BUILD recomputes SubcontractedTeamCapacity instead.
    """

    def _user_for(self, username, department):
        user = User.objects.create_user(username=username, password='test-password', is_active=True)
        UserProfile.objects.create(user=user, department=department)
        return user

    def setUp(self):
        self.pm_user = self._user_for('pm-extheadcount-user', UserDepartment.PM)
        self.med_user = self._user_for('med-extheadcount-user', UserDepartment.MED)
        self.hd_user = self._user_for('hd-extheadcount-user', UserDepartment.HD)
        self.build_user = self._user_for('build-extheadcount-user', UserDepartment.BUILD)
        today = timezone.localdate()
        self.current_week = today - timedelta(days=today.weekday())
        self.future_week = self.current_week + timedelta(weeks=2)
        self.later_week = self.current_week + timedelta(weeks=5)
        self.past_week = self.current_week - timedelta(weeks=4)

    def test_department_user_can_log_own_external_team_event(self):
        self.client.force_authenticate(user=self.med_user)
        response = self.client.post(
            reverse('external-team-headcount-event-list'),
            {
                'department': Department.MED,
                'team_name': 'Provider A',
                'effective_date': self.future_week.isoformat(),
                'delta': 3,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            ExternalTeamHeadcountEvent.objects.filter(department=Department.MED, team_name='Provider A').exists()
        )
        self.assertTrue(
            PrgExternalTeamCapacity.objects.filter(
                department=Department.MED, team_name='Provider A',
                week_start_date=self.future_week, capacity=3,
            ).exists()
        )
        # Weeks before the event are untouched; the event's week and forward carry the headcount.
        self.assertFalse(
            PrgExternalTeamCapacity.objects.filter(
                department=Department.MED, team_name='Provider A', week_start_date=self.current_week,
            ).exists()
        )

    def test_events_accumulate_going_forward(self):
        self.client.force_authenticate(user=self.med_user)
        self.client.post(
            reverse('external-team-headcount-event-list'),
            {'department': Department.MED, 'team_name': 'Provider A', 'effective_date': self.future_week.isoformat(), 'delta': 3},
            format='json',
        )
        self.client.post(
            reverse('external-team-headcount-event-list'),
            {'department': Department.MED, 'team_name': 'Provider A', 'effective_date': self.later_week.isoformat(), 'delta': -1},
            format='json',
        )
        between_week = self.future_week + timedelta(weeks=1)
        self.assertEqual(
            PrgExternalTeamCapacity.objects.get(
                department=Department.MED, team_name='Provider A', week_start_date=between_week,
            ).capacity,
            3,
        )
        self.assertEqual(
            PrgExternalTeamCapacity.objects.get(
                department=Department.MED, team_name='Provider A', week_start_date=self.later_week,
            ).capacity,
            2,
        )

    def test_build_event_recomputes_subcontracted_capacity_not_prg_model(self):
        self.client.force_authenticate(user=self.build_user)
        response = self.client.post(
            reverse('external-team-headcount-event-list'),
            {
                'department': Department.BUILD,
                'team_name': 'AMI',
                'effective_date': self.future_week.isoformat(),
                'delta': 4,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            SubcontractedTeamCapacity.objects.filter(
                company='AMI', week_start_date=self.future_week, capacity=4,
            ).exists()
        )
        self.assertFalse(
            PrgExternalTeamCapacity.objects.filter(department=Department.BUILD).exists()
        )

    def test_department_user_cannot_log_other_department_external_event(self):
        self.client.force_authenticate(user=self.hd_user)
        response = self.client.post(
            reverse('external-team-headcount-event-list'),
            {
                'department': Department.MED,
                'team_name': 'Provider A',
                'effective_date': self.future_week.isoformat(),
                'delta': 1,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_pm_department_not_available_even_for_full_access_user(self):
        self.client.force_authenticate(user=self.pm_user)
        response = self.client.post(
            reverse('external-team-headcount-event-list'),
            {
                'department': Department.PM,
                'team_name': 'Nope',
                'effective_date': self.future_week.isoformat(),
                'delta': 1,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_backdated_effective_date_is_rejected(self):
        self.client.force_authenticate(user=self.med_user)
        response = self.client.post(
            reverse('external-team-headcount-event-list'),
            {
                'department': Department.MED,
                'team_name': 'Provider A',
                'effective_date': self.past_week.isoformat(),
                'delta': 1,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(ExternalTeamHeadcountEvent.objects.exists())

    def test_current_week_effective_date_is_allowed(self):
        self.client.force_authenticate(user=self.med_user)
        response = self.client.post(
            reverse('external-team-headcount-event-list'),
            {
                'department': Department.MED,
                'team_name': 'Provider A',
                'effective_date': self.current_week.isoformat(),
                'delta': 1,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)


class DepartmentHourlyCostTests(APITestCase):
    """Global per-department hourly cost rate: full-access (PM/BI) only, one row per department."""

    def setUp(self):
        self.pm_user = User.objects.create_user(
            username='pm-cost-user', password='test-password', is_active=True,
        )
        UserProfile.objects.create(user=self.pm_user, department=UserDepartment.PM)

        self.med_user = User.objects.create_user(
            username='med-cost-user', password='test-password', is_active=True,
        )
        UserProfile.objects.create(user=self.med_user, department=UserDepartment.MED)

    def test_full_access_user_can_set_hourly_cost(self):
        self.client.force_authenticate(user=self.pm_user)
        response = self.client.post(
            reverse('department-hourly-cost-list'),
            {'department': Department.MED, 'hourly_cost': '75.50'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            DepartmentHourlyCost.objects.filter(department=Department.MED, hourly_cost='75.50').exists()
        )

    def test_posting_same_department_again_updates_instead_of_erroring(self):
        self.client.force_authenticate(user=self.pm_user)
        self.client.post(
            reverse('department-hourly-cost-list'),
            {'department': Department.HD, 'hourly_cost': '60.00'},
            format='json',
        )
        response = self.client.post(
            reverse('department-hourly-cost-list'),
            {'department': Department.HD, 'hourly_cost': '65.00'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(DepartmentHourlyCost.objects.filter(department=Department.HD).count(), 1)
        self.assertEqual(str(DepartmentHourlyCost.objects.get(department=Department.HD).hourly_cost), '65.00')

    def test_department_manager_cannot_set_hourly_cost(self):
        self.client.force_authenticate(user=self.med_user)
        response = self.client.post(
            reverse('department-hourly-cost-list'),
            {'department': Department.MED, 'hourly_cost': '75.50'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_saving_records_updated_by_and_activity_log_history(self):
        """
        Every save is explicit (button-triggered, not autosave) and must leave
        a durable trail: who changed the rate and when, both on the row
        itself (updated_by) and as an accumulating ActivityLog history.
        """
        self.client.force_authenticate(user=self.pm_user)

        response = self.client.post(
            reverse('department-hourly-cost-list'),
            {'department': Department.BUILD, 'hourly_cost': '60.00'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['updated_by_username'], 'pm-cost-user')

        record = DepartmentHourlyCost.objects.get(department=Department.BUILD)
        self.assertEqual(record.updated_by, self.pm_user)

        logs_after_create = ActivityLog.objects.filter(
            model_name='DepartmentHourlyCost', object_id=str(record.id)
        ).order_by('created_at')
        self.assertEqual(logs_after_create.count(), 1)
        self.assertEqual(logs_after_create[0].action, 'created')
        self.assertEqual(logs_after_create[0].user, self.pm_user)
        self.assertEqual(logs_after_create[0].changes['old_hourly_cost'], None)
        self.assertEqual(logs_after_create[0].changes['new_hourly_cost'], '60.00')

        # A second save for the same department is a separate ledger entry,
        # not an overwrite of the first -- history accumulates.
        response = self.client.post(
            reverse('department-hourly-cost-list'),
            {'department': Department.BUILD, 'hourly_cost': '65.00'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        logs_after_update = ActivityLog.objects.filter(
            model_name='DepartmentHourlyCost', object_id=str(record.id)
        ).order_by('created_at')
        self.assertEqual(logs_after_update.count(), 2)
        self.assertEqual(logs_after_update[1].action, 'updated')
        self.assertEqual(logs_after_update[1].changes['old_hourly_cost'], '60.00')
        self.assertEqual(logs_after_update[1].changes['new_hourly_cost'], '65.00')


class ExternalProviderRateTests(APITestCase):
    """
    Effective-dated hourly rate per (department, provider, stage): department-level edit
    access (same as adding the provider itself), not full-access-only like
    DepartmentHourlyCost, and rates can be backdated (unlike ExternalTeamHeadcountEvent).
    """

    def setUp(self):
        self.build_user = User.objects.create_user(
            username='build-rate-user', password='test-password', is_active=True,
        )
        UserProfile.objects.create(user=self.build_user, department=UserDepartment.BUILD)

        self.med_user = User.objects.create_user(
            username='med-rate-user', password='test-password', is_active=True,
        )
        UserProfile.objects.create(user=self.med_user, department=UserDepartment.MED)

    def test_department_user_can_set_rate_for_own_department(self):
        self.client.force_authenticate(user=self.build_user)
        response = self.client.post(
            reverse('external-provider-rate-list'),
            {
                'department': Department.BUILD,
                'provider_name': 'AMI',
                'stage': Stage.CABINETS_FRAMES,
                'effective_date': str(date.today()),
                'rate': '45.00',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            ExternalProviderRate.objects.filter(
                department=Department.BUILD, provider_name='AMI', stage=Stage.CABINETS_FRAMES
            ).exists()
        )

    def test_department_user_cannot_set_rate_for_other_department(self):
        self.client.force_authenticate(user=self.med_user)
        response = self.client.post(
            reverse('external-provider-rate-list'),
            {
                'department': Department.BUILD,
                'provider_name': 'AMI',
                'stage': Stage.CABINETS_FRAMES,
                'effective_date': str(date.today()),
                'rate': '45.00',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_rate_can_be_backdated(self):
        self.client.force_authenticate(user=self.build_user)
        past_date = date.today() - timedelta(days=90)
        response = self.client.post(
            reverse('external-provider-rate-list'),
            {
                'department': Department.BUILD,
                'provider_name': 'AMI',
                'stage': Stage.CABINETS_FRAMES,
                'effective_date': str(past_date),
                'rate': '40.00',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_new_rate_adds_to_history_instead_of_overwriting(self):
        self.client.force_authenticate(user=self.build_user)
        self.client.post(
            reverse('external-provider-rate-list'),
            {
                'department': Department.BUILD, 'provider_name': 'AMI', 'stage': Stage.CABINETS_FRAMES,
                'effective_date': str(date.today() - timedelta(days=30)), 'rate': '40.00',
            },
            format='json',
        )
        self.client.post(
            reverse('external-provider-rate-list'),
            {
                'department': Department.BUILD, 'provider_name': 'AMI', 'stage': Stage.CABINETS_FRAMES,
                'effective_date': str(date.today()), 'rate': '45.00',
            },
            format='json',
        )
        self.assertEqual(
            ExternalProviderRate.objects.filter(
                department=Department.BUILD, provider_name='AMI', stage=Stage.CABINETS_FRAMES
            ).count(),
            2,
        )


class ProjectCostSummaryWithProviderRatesTests(APITestCase):
    """
    summary-by-project-dept's $ cost computation: internal hours use the department's flat
    DepartmentHourlyCost, external/subcontracted hours use the provider's own per-stage rate
    as of the assignment's week (the most recent ExternalProviderRate at or before it).
    """

    def setUp(self):
        self.pm_user = User.objects.create_user(
            username='cost-summary-pm', password='test-password', is_active=True, is_staff=True,
        )
        self.client.force_authenticate(user=self.pm_user)

        self.project = Project.objects.create(
            name='Cost Summary Project',
            client='Internal',
            start_date=date.today(),
            end_date=date.today() + timedelta(days=28),
            facility=Facility.MX,
            number_of_weeks=4,
        )

        self.internal_employee = Employee.objects.create(
            name='Internal Builder', role='Build Tech', department=Department.BUILD, capacity=40,
        )
        self.external_employee = Employee.objects.create(
            name='AMI', role='Subcontracted Team', department=Department.BUILD, capacity=0,
            is_subcontracted_material=True, subcontract_company='AMI',
        )

        DepartmentHourlyCost.objects.create(department=Department.BUILD, hourly_cost='50.00')
        ExternalProviderRate.objects.create(
            department=Department.BUILD, provider_name='AMI', stage=Stage.CABINETS_FRAMES,
            effective_date=date.today() - timedelta(days=365), rate='30.00',
        )

        current_week_start = date.today() - timedelta(days=date.today().weekday())
        self.current_week_start = current_week_start

        # Internal: 10h this week @ $50/hr flat -> $500 forecast.
        Assignment.objects.create(
            employee=self.internal_employee, project=self.project,
            week_start_date=current_week_start, hours=10, stage=Stage.CABINETS_FRAMES,
        )
        # External: 10h this week @ $30/hr provider rate -> $300 forecast.
        Assignment.objects.create(
            employee=self.external_employee, project=self.project,
            week_start_date=current_week_start, hours=10, stage=Stage.CABINETS_FRAMES,
            scio_hours=0, external_hours=10,
        )

    def _get_summary_row(self):
        response = self.client.get(
            reverse('assignment-summary-by-project-dept'),
            {'project_ids': str(self.project.id), 'department': Department.BUILD},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rows = [row for row in response.data if row['department'] == Department.BUILD]
        self.assertEqual(len(rows), 1)
        return rows[0]

    def test_forecast_cost_blends_flat_and_provider_rates(self):
        row = self._get_summary_row()
        self.assertEqual(row['forecast'], 20.0)
        self.assertEqual(row['forecast_cost'], 800.0)  # $500 internal + $300 external

    def test_cost_is_null_when_no_rate_registered_anywhere(self):
        DepartmentHourlyCost.objects.all().delete()
        ExternalProviderRate.objects.all().delete()
        row = self._get_summary_row()
        self.assertIsNone(row['forecast_cost'])

    def test_provider_rate_change_only_applies_going_forward(self):
        # A newer rate effective starting next week shouldn't affect this week's cost.
        ExternalProviderRate.objects.create(
            department=Department.BUILD, provider_name='AMI', stage=Stage.CABINETS_FRAMES,
            effective_date=self.current_week_start + timedelta(days=7), rate='999.00',
        )
        row = self._get_summary_row()
        self.assertEqual(row['forecast_cost'], 800.0)


class HeadEngineeringPermissionTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='head-engineering-user',
            password='test-password',
            is_active=True,
        )
        UserProfile.objects.create(
            user=self.user,
            department=UserDepartment.OTHER,
            other_department=OtherDepartment.HEAD_ENGINEERING,
        )
        self.client.force_authenticate(user=self.user)

        self.med_employee = Employee.objects.create(
            name='MED Editable',
            role='Mechanical Engineer',
            department=Department.MED,
            capacity=45,
            is_active=True,
        )
        self.pm_employee = Employee.objects.create(
            name='PM Not Editable',
            role='Project Manager',
            department=Department.PM,
            capacity=45,
            is_active=True,
        )

    def test_head_engineering_can_modify_med_employee(self):
        response = self.client.patch(
            reverse('employee-detail', args=[self.med_employee.id]),
            {'role': 'Mechanical Lead Engineer'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.med_employee.refresh_from_db()
        self.assertEqual(self.med_employee.role, 'Mechanical Lead Engineer')

    def test_head_engineering_cannot_modify_pm_employee(self):
        response = self.client.patch(
            reverse('employee-detail', args=[self.pm_employee.id]),
            {'role': 'Senior PM'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.pm_employee.refresh_from_db()
        self.assertEqual(self.pm_employee.role, 'Project Manager')


class SessionControlTests(APITestCase):
    def setUp(self):
        self.password = 'secure-test-password'
        self.user = User.objects.create_user(
            username='session-control-user',
            password=self.password,
            is_active=True,
        )

    def _login(self, user_agent: str):
        return self.client.post(
            reverse('token_obtain_pair'),
            {'username': self.user.username, 'password': self.password},
            format='json',
            HTTP_USER_AGENT=user_agent,
        )

    def _auth_headers(self, access_token: str):
        return {'HTTP_AUTHORIZATION': f'Bearer {access_token}'}

    def test_user_is_limited_to_two_active_sessions(self):
        login_1 = self._login('Device-A')
        login_2 = self._login('Device-B')
        login_3 = self._login('Device-C')

        self.assertEqual(login_1.status_code, status.HTTP_200_OK)
        self.assertEqual(login_2.status_code, status.HTTP_200_OK)
        self.assertEqual(login_3.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(UserSession.objects.filter(user=self.user, is_active=True).count(), 2)

    def test_successful_login_updates_last_login(self):
        self.assertIsNone(self.user.last_login)

        login_response = self._login('Device-LastLogin')
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)

        self.user.refresh_from_db()
        self.assertIsNotNone(self.user.last_login)

    def test_session_status_is_checked_per_session_id(self):
        login_1 = self._login('Device-1')
        login_2 = self._login('Device-2')
        self.assertEqual(login_1.status_code, status.HTTP_200_OK)
        self.assertEqual(login_2.status_code, status.HTTP_200_OK)

        access_1 = login_1.data['access']
        access_2 = login_2.data['access']
        session_id_1 = UntypedToken(access_1).get('session_id')

        self.assertIsNotNone(session_id_1)

        UserSession.objects.filter(id=session_id_1, user=self.user).update(is_active=False)

        status_1 = self.client.get(reverse('session_status'), **self._auth_headers(access_1))
        status_2 = self.client.get(reverse('session_status'), **self._auth_headers(access_2))

        self.assertEqual(status_1.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(status_2.status_code, status.HTTP_200_OK)

    def test_authenticated_request_updates_session_last_activity(self):
        login_response = self._login('Activity-Refresh-Device')
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)

        access = login_response.data['access']
        session_id = UntypedToken(access).get('session_id')
        self.assertIsNotNone(session_id)

        stale_time = timezone.now() - timedelta(minutes=10)
        UserSession.objects.filter(id=session_id, user=self.user).update(
            is_active=True,
            last_activity=stale_time,
        )

        response = self.client.get(reverse('project-list'), **self._auth_headers(access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        refreshed_session = UserSession.objects.get(id=session_id, user=self.user)
        self.assertTrue(refreshed_session.is_active)
        self.assertGreater(refreshed_session.last_activity, stale_time)

    def test_inactive_session_is_forced_closed_after_timeout(self):
        login_response = self._login('Inactivity-Device')
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)

        access = login_response.data['access']
        session_id = UntypedToken(access).get('session_id')
        self.assertIsNotNone(session_id)

        timeout_minutes = max(1, int(getattr(settings, 'SESSION_INACTIVITY_TIMEOUT_MINUTES', 90)))
        stale_time = timezone.now() - timedelta(minutes=timeout_minutes + 1)
        UserSession.objects.filter(id=session_id, user=self.user).update(
            is_active=True,
            last_activity=stale_time,
        )

        session_status = self.client.get(reverse('session_status'), **self._auth_headers(access))
        self.assertEqual(session_status.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(UserSession.objects.get(id=session_id).is_active)


class ChangePasswordPolicyTests(APITestCase):
    def setUp(self):
        self.current_password = 'CurrentPass1!'
        self.user = User.objects.create_user(
            username='password.policy.user',
            email='password.policy.user@na.scio-automation.com',
            password=self.current_password,
            is_active=True,
        )
        self.client.force_authenticate(user=self.user)

    def test_change_password_rejects_password_without_special_character(self):
        response = self.client.post(
            reverse('change_password'),
            {
                'current_password': self.current_password,
                'new_password': 'NoSpecial123',
                'confirm_password': 'NoSpecial123',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        detail = str(response.data.get('detail', '')).lower()
        self.assertIn('special', detail)

    def test_change_password_rejects_password_similar_to_username(self):
        response = self.client.post(
            reverse('change_password'),
            {
                'current_password': self.current_password,
                'new_password': 'password.policy.user',
                'confirm_password': 'password.policy.user',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        detail = str(response.data.get('detail', '')).lower()
        self.assertIn('similar', detail)

    def test_change_password_accepts_compliant_password(self):
        new_password = 'CompliantPass2#'
        response = self.client.post(
            reverse('change_password'),
            {
                'current_password': self.current_password,
                'new_password': new_password,
                'confirm_password': new_password,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(new_password))


class RegisteredUsersLastLoginTests(APITestCase):
    @staticmethod
    def _extract_results(response):
        if isinstance(response.data, dict) and 'results' in response.data:
            return response.data['results']
        return response.data

    def setUp(self):
        self.bi_manager = User.objects.create_user(
            username='bi.manager',
            email='bi.manager@na.scio-automation.com',
            password='test-password',
            is_active=True,
        )
        UserProfile.objects.create(
            user=self.bi_manager,
            department=UserDepartment.OTHER,
            other_department=OtherDepartment.BUSINESS_INTELLIGENCE,
        )
        self.client.force_authenticate(user=self.bi_manager)

        self.target_user = User.objects.create_user(
            username='target.user',
            email='target.user@na.scio-automation.com',
            password='test-password',
            is_active=True,
        )
        self.assertIsNone(self.target_user.last_login)
        UserSession.objects.create(
            user=self.target_user,
            refresh_token='registered-users-last-login-token',
            device_info={},
            is_active=True,
        )

    def test_registered_users_uses_last_session_when_last_login_is_null(self):
        response = self.client.get(reverse('registered-user-list'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        rows = self._extract_results(response)
        target_row = next((item for item in rows if item['id'] == self.target_user.id), None)
        self.assertIsNotNone(target_row)
        self.assertIsNotNone(target_row.get('last_login'))


class RegisteredUsersPasswordResetTests(APITestCase):
    def setUp(self):
        self.bi_manager = User.objects.create_user(
            username='bi.reset.manager',
            email='bi.reset.manager@na.scio-automation.com',
            password='manager-password',
            is_active=True,
        )
        UserProfile.objects.create(
            user=self.bi_manager,
            department=UserDepartment.OTHER,
            other_department=OtherDepartment.BUSINESS_INTELLIGENCE,
        )

        self.target_user = User.objects.create_user(
            username='forgotten.user',
            email='forgotten.user@na.scio-automation.com',
            password='OldPass123!',
            is_active=True,
        )
        UserSession.objects.create(
            user=self.target_user,
            refresh_token='reset-password-active-session-token',
            device_info={'user_agent': 'test-agent'},
            is_active=True,
        )

    def test_bi_can_reset_user_password_and_invalidate_sessions(self):
        self.client.force_authenticate(user=self.bi_manager)

        payload = {
            'password': 'NewPass456!',
            'confirm_password': 'NewPass456!',
        }
        response = self.client.post(
            reverse('registered-user-reset-password', args=[self.target_user.id]),
            payload,
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.target_user.refresh_from_db()
        self.assertTrue(self.target_user.check_password('NewPass456!'))
        self.assertFalse(
            UserSession.objects.filter(user=self.target_user, is_active=True).exists()
        )

        old_login = self.client.post(
            reverse('token_obtain_pair'),
            {'username': self.target_user.username, 'password': 'OldPass123!'},
            format='json',
        )
        self.assertEqual(old_login.status_code, status.HTTP_401_UNAUTHORIZED)

        new_login = self.client.post(
            reverse('token_obtain_pair'),
            {'username': self.target_user.username, 'password': 'NewPass456!'},
            format='json',
        )
        self.assertEqual(new_login.status_code, status.HTTP_200_OK)

    def test_non_bi_user_cannot_reset_password(self):
        non_bi_user = User.objects.create_user(
            username='prg.user',
            email='prg.user@na.scio-automation.com',
            password='test-password',
            is_active=True,
        )
        UserProfile.objects.create(user=non_bi_user, department=UserDepartment.PRG)
        self.client.force_authenticate(user=non_bi_user)

        response = self.client.post(
            reverse('registered-user-reset-password', args=[self.target_user.id]),
            {'password': 'AnotherPass789!', 'confirm_password': 'AnotherPass789!'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class RegisteredUsersDepartmentNormalizationTests(APITestCase):
    def setUp(self):
        self.bi_manager = User.objects.create_user(
            username='bi.normalizer',
            email='bi.normalizer@na.scio-automation.com',
            password='manager-password',
            is_active=True,
        )
        UserProfile.objects.create(
            user=self.bi_manager,
            department=UserDepartment.OTHER,
            other_department=OtherDepartment.BUSINESS_INTELLIGENCE,
        )
        self.client.force_authenticate(user=self.bi_manager)

    def test_registered_users_create_accepts_human_readable_head_engineering(self):
        response = self.client.post(
            reverse('registered-user-list'),
            {
                'first_name': 'Head',
                'last_name': 'Engineering',
                'email': 'head.eng.normalized@na.scio-automation.com',
                'password': 'StrongPass123!',
                'department': 'OTHER',
                'other_department': 'Head Engineering',
                'is_active': True,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        created = User.objects.get(email='head.eng.normalized@na.scio-automation.com')
        self.assertEqual(created.profile.other_department, OtherDepartment.HEAD_ENGINEERING)


class HiddenDataAccessControlTests(APITestCase):
    @staticmethod
    def _extract_results(response):
        if isinstance(response.data, dict) and 'results' in response.data:
            return response.data['results']
        return response.data

    def setUp(self):
        self.employee = Employee.objects.create(
            name='Hidden Data Tester',
            role='Engineer',
            department=Department.PRG,
            capacity=40,
            is_active=True,
        )
        self.project = Project.objects.create(
            name='Hidden Project',
            client='Internal',
            start_date=date.today(),
            end_date=date.today() + timedelta(days=28),
            facility=Facility.MX,
            number_of_weeks=4,
            is_hidden=True,
            hidden_at=timezone.now(),
        )
        self.assignment = Assignment.objects.create(
            employee=self.employee,
            project=self.project,
            week_start_date=date.today(),
            hours=8,
            stage=None,
        )

        self.department_user = User.objects.create_user(
            username='department.user',
            email='department.user@na.scio-automation.com',
            password='test-password',
            is_active=True,
        )
        UserProfile.objects.create(user=self.department_user, department=UserDepartment.PRG)

        self.full_access_user = User.objects.create_user(
            username='full-access-user',
            email='full.access@na.scio-automation.com',
            password='test-password',
            is_active=True,
            is_staff=True,
        )

    def test_department_user_cannot_include_hidden_projects(self):
        self.client.force_authenticate(user=self.department_user)
        response = self.client.get(reverse('project-list'), {'include_hidden': 'true'})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_department_user_cannot_include_hidden_assignments(self):
        self.client.force_authenticate(user=self.department_user)
        response = self.client.get(reverse('assignment-list'), {'include_hidden': 'true'})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_department_user_cannot_include_hidden_summary(self):
        self.client.force_authenticate(user=self.department_user)
        response = self.client.get(
            reverse('assignment-summary-by-project-dept'),
            {'project_ids': str(self.project.id), 'include_hidden': 'true'},
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_full_access_user_can_include_hidden_projects_and_assignments(self):
        self.client.force_authenticate(user=self.full_access_user)

        project_response = self.client.get(reverse('project-list'), {'include_hidden': 'true'})
        self.assertEqual(project_response.status_code, status.HTTP_200_OK)
        project_ids = {str(item['id']) for item in self._extract_results(project_response)}
        self.assertIn(str(self.project.id), project_ids)

        assignment_response = self.client.get(reverse('assignment-list'), {'include_hidden': 'true'})
        self.assertEqual(assignment_response.status_code, status.HTTP_200_OK)
        assignment_ids = {str(item['id']) for item in self._extract_results(assignment_response)}
        self.assertIn(str(self.assignment.id), assignment_ids)
