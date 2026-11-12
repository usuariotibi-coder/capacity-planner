"""
Additional QA sweep: covers gaps left by tests.py -- full field round-trips for every
form-backed model, the new POST bulk endpoints (summary-by-project-dept,
project-department-weekly-actuals/search), the Finance import pipeline, and the three
Change Order conversion operations (promote / merge-into-parent / move-department).
"""
import io
from datetime import date, timedelta

import openpyxl
from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .finance_import import run_finance_import
from .models import (
    Assignment,
    DailyTimeEntry,
    Department,
    DepartmentStageConfig,
    Employee,
    Facility,
    FinanceJobCumulative,
    PrgExternalTeamCapacity,
    Project,
    ProjectBudget,
    ProjectChangeOrder,
    ProjectDepartmentWeeklyActual,
    ScioTeamCapacity,
    Stage,
    SubcontractedTeamCapacity,
    TimeEntryType,
)


def make_full_access_user(username):
    return User.objects.create_user(username=username, password='test-password', is_staff=True)


class BulkEndpointsPostTests(APITestCase):
    """
    The GET variants of these two endpoints put every project UUID in the query
    string; with a large project roster that exceeds the ~4KB request-line limit
    Railway's edge proxy enforces, which is why POST variants were added. Confirm
    the POST path returns the same data GET would, including the aggregated
    Finance-actuals contribution, and tolerates a large project_ids list.
    """
    def setUp(self):
        self.user = make_full_access_user('bulk-endpoints-admin')
        self.client.force_authenticate(user=self.user)

        self.employee = Employee.objects.create(
            name='Bulk Endpoint Tester', role='Engineer', department=Department.MED, capacity=40,
        )
        self.project = Project.objects.create(
            name='Bulk Endpoint Project', client='Acme', start_date=date(2026, 1, 5),
            end_date=date(2026, 3, 30), facility=Facility.MX, number_of_weeks=12,
        )
        self.past_week = date(2026, 1, 5)
        self.future_week = date(2026, 6, 1)
        Assignment.objects.create(
            employee=self.employee, project=self.project, week_start_date=self.future_week, hours=10,
        )
        ProjectDepartmentWeeklyActual.objects.create(
            project=self.project, department=Department.MED, week_start_date=self.past_week, hours=25,
        )

    def test_post_summary_by_project_dept_blends_assignments_and_actuals(self):
        response = self.client.post(
            reverse('assignment-summary-by-project-dept'),
            data={
                'project_ids': [str(self.project.id)],
                'current_week_start': '2026-02-02',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rows = {row['department']: row for row in response.data}
        self.assertIn('MED', rows)
        # Past-week Finance actual (25h) is "utilized"; future assignment (10h) is "forecast".
        self.assertEqual(rows['MED']['utilized'], 25.0)
        self.assertEqual(rows['MED']['forecast'], 10.0)

    def test_post_summary_by_project_dept_requires_project_ids(self):
        response = self.client.post(
            reverse('assignment-summary-by-project-dept'), data={}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_post_tolerates_large_project_id_roster(self):
        """A roster big enough that its GET query string would exceed ~4KB."""
        extra_ids = [str(self.project.id)]
        for i in range(120):
            p = Project.objects.create(
                name=f'Roster Project {i}', client='Acme', start_date=date(2026, 1, 1),
                end_date=date(2026, 1, 31), facility=Facility.MX, number_of_weeks=4,
            )
            extra_ids.append(str(p.id))

        response = self.client.post(
            reverse('assignment-summary-by-project-dept'),
            data={'project_ids': extra_ids, 'current_week_start': '2026-02-02'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_post_weekly_actuals_search_returns_matching_rows(self):
        other_project = Project.objects.create(
            name='Other Project', client='Acme', start_date=date(2026, 1, 1),
            end_date=date(2026, 1, 31), facility=Facility.MX, number_of_weeks=4,
        )
        ProjectDepartmentWeeklyActual.objects.create(
            project=other_project, department=Department.HD, week_start_date=self.past_week, hours=99,
        )

        response = self.client.post(
            reverse('project-department-weekly-actual-search'),
            data={'project_ids': [str(self.project.id)]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        project_ids = {str(row['project_id']) for row in response.data['results']}
        self.assertEqual(project_ids, {str(self.project.id)})

    def test_post_weekly_actuals_search_filters_by_department(self):
        ProjectDepartmentWeeklyActual.objects.create(
            project=self.project, department=Department.PM, week_start_date=self.past_week, hours=5,
        )
        response = self.client.post(
            reverse('project-department-weekly-actual-search'),
            data={'project_ids': [str(self.project.id)], 'department': 'PM'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        departments = {row['department'] for row in response.data['results']}
        self.assertEqual(departments, {'PM'})


class FinanceImportPipelineTests(APITestCase):
    """
    Exercises run_finance_import directly: baseline seeding on first sight of a
    job/department, correct week-over-week diffing on the next report, safe
    no-op on a re-processed (already-seen) report date, and superseding manual
    Assignment rows for the weeks a fresh actual just covered.
    """
    @staticmethod
    def _build_workbook(rows):
        """rows: list of (date, job_code, dept_header, hours) tuples."""
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(['Date', 'Project', 'Station', 'PM', 'Mechanical Engineering', 'Hardware Design',
                   'Machining', 'Assembly', 'Programming', 'Purchasing', 'Shipping',
                   'Assembly Install', 'Programming Install', 'Labor Total', 'Material Total',
                   'E_Rate', 'Job'])
        for report_date, job_code, dept_header, hours in rows:
            row = [report_date, '', '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, job_code]
            col_index = {
                'PM': 3, 'Mechanical Engineering': 4, 'Hardware Design': 5, 'Machining': 6,
                'Assembly': 7, 'Programming': 8, 'Purchasing': 9, 'Shipping': 10,
                'Assembly Install': 11, 'Programming Install': 12,
            }[dept_header]
            row[col_index] = hours
            ws.append(row)
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return buf

    def test_first_sight_of_job_department_seeds_baseline_only(self):
        wb = self._build_workbook([(date(2026, 2, 2), '9001', 'Machining', 40)])
        log = run_finance_import(wb, file_name='test.xlsx')

        self.assertEqual(log.weekly_actuals_written, 0)
        self.assertIn('9001 (MFG)', log.job_codes_seeded_only)
        self.assertEqual(ProjectDepartmentWeeklyActual.objects.count(), 0)
        self.assertTrue(FinanceJobCumulative.objects.filter(job_code='9001', department='MFG').exists())
        # No weekly actual was ever written for this job, so no Project is auto-created
        # yet either -- that only happens once there's an actual diff to attach to one.
        self.assertFalse(Project.objects.filter(project_number='9001').exists())

    def test_second_report_computes_weekly_diff(self):
        self._build_and_run(date(2026, 2, 2), '9002', 'Machining', 40)
        wb2 = self._build_workbook([(date(2026, 2, 9), '9002', 'Machining', 55)])
        log2 = run_finance_import(wb2, file_name='test2.xlsx')

        self.assertEqual(log2.weekly_actuals_written, 1)
        project = Project.objects.get(project_number='9002')
        actual = ProjectDepartmentWeeklyActual.objects.get(project=project, department='MFG')
        # Diff is 15h, landing on the ISO week BEFORE the second report's date.
        self.assertEqual(actual.hours, 15)
        self.assertEqual(actual.week_start_date, date(2026, 2, 2))

    def test_reprocessing_same_report_date_is_a_safe_no_op(self):
        self._build_and_run(date(2026, 2, 2), '9003', 'Machining', 40)
        self._build_and_run(date(2026, 2, 9), '9003', 'Machining', 55)
        before = ProjectDepartmentWeeklyActual.objects.get(project__project_number='9003').hours

        # Re-upload the very first report again (same date, same value) -- must not
        # double-count or error.
        wb_replay = self._build_workbook([(date(2026, 2, 2), '9003', 'Machining', 40)])
        run_finance_import(wb_replay, file_name='replay.xlsx')

        after = ProjectDepartmentWeeklyActual.objects.get(project__project_number='9003').hours
        self.assertEqual(before, after)

    def test_fresh_actual_supersedes_manual_assignment_for_same_week(self):
        # First two reports establish the project and write an actual for week 2026-02-02
        # (the only week the baseline->second-report diff can land on).
        self._build_and_run(date(2026, 2, 2), '9004', 'Machining', 40)
        self._build_and_run(date(2026, 2, 9), '9004', 'Machining', 55)
        project = Project.objects.get(project_number='9004')
        employee = Employee.objects.create(name='Manual Entry Tester', role='Tech', department=Department.MFG, capacity=40)
        # Week 2026-02-09 hasn't received an actual yet -- put the manual entry there.
        manual = Assignment.objects.create(
            employee=employee, project=project, week_start_date=date(2026, 2, 9), hours=8,
        )

        # The third report's diff lands on week 2026-02-09 -- its first actual -- which
        # must delete the now-redundant manual entry for that same week.
        wb3 = self._build_workbook([(date(2026, 2, 16), '9004', 'Machining', 75)])
        run_finance_import(wb3, file_name='test3.xlsx')

        self.assertFalse(Assignment.objects.filter(id=manual.id).exists())

    def test_job_key_collapses_lettered_suffix_but_keeps_co_suffix(self):
        from .finance_import import project_key_from_job
        self.assertEqual(project_key_from_job('3268-A'), '3268')
        self.assertEqual(project_key_from_job('3268-YB'), '3268')
        self.assertEqual(project_key_from_job('3268-CO01'), '3268-CO01')
        self.assertEqual(project_key_from_job('3268-CO01-A'), '3268-CO01')
        self.assertIsNone(project_key_from_job('AUTO26'))

    def _build_and_run(self, report_date, job_code, dept_header, hours):
        wb = self._build_workbook([(report_date, job_code, dept_header, hours)])
        return run_finance_import(wb, file_name='seed.xlsx')


class ChangeOrderConversionTests(APITestCase):
    """promote-change-order, merge-into-parent, and move-department round trips."""

    def setUp(self):
        self.user = make_full_access_user('co-conversion-admin')
        self.client.force_authenticate(user=self.user)
        self.parent = Project.objects.create(
            project_number='5001', name='5001', client='Acme', start_date=date(2026, 1, 1),
            end_date=date(2026, 6, 1), facility=Facility.MX, number_of_weeks=20,
        )

    def test_promote_change_order_creates_linked_project_and_removes_merged_rows(self):
        ProjectChangeOrder.objects.create(
            project=self.parent, department=Department.BUILD, name='CO01', hours_quoted=40, cost_quoted=3000,
        )
        ProjectChangeOrder.objects.create(
            project=self.parent, department=Department.PRG, name='CO01', hours_quoted=20, cost_quoted=1500,
        )

        response = self.client.post(
            reverse('project-promote-change-order', args=[self.parent.id]),
            data={
                'change_order_name': 'CO01',
                'project_number': '5001-CO01',
                'name': '5001-CO01',
                'client': 'Acme',
                'start_date': '2026-02-01',
                'end_date': '2026-04-01',
                'facility': Facility.MX,
                'number_of_weeks': 8,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(ProjectChangeOrder.objects.filter(project=self.parent, name='CO01').exists())
        new_project = Project.objects.get(project_number='5001-CO01')
        self.assertEqual(str(new_project.parent_project_id), str(self.parent.id))

    def test_promote_rejects_unknown_change_order_name(self):
        response = self.client.post(
            reverse('project-promote-change-order', args=[self.parent.id]),
            data={
                'change_order_name': 'CO99', 'name': '5001-CO99', 'client': 'Acme',
                'start_date': '2026-02-01', 'end_date': '2026-04-01',
                'facility': Facility.MX, 'number_of_weeks': 8,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Project.objects.filter(project_number='5001-CO99').exists())

    def test_merge_into_parent_migrates_budget_assignments_and_actuals(self):
        child = Project.objects.create(
            project_number='5001-CO02', name='5001-CO02', client='Acme', parent_project=self.parent,
            start_date=date(2026, 2, 1), end_date=date(2026, 4, 1), facility=Facility.MX, number_of_weeks=8,
        )
        ProjectBudget.objects.create(project=child, department=Department.MED, hours_allocated=30, cost_allocated=2500)
        employee = Employee.objects.create(name='Merge Tester', role='Eng', department=Department.MED, capacity=40)
        Assignment.objects.create(employee=employee, project=child, week_start_date=date(2026, 2, 2), hours=12)
        ProjectDepartmentWeeklyActual.objects.create(
            project=child, department=Department.MED, week_start_date=date(2026, 2, 2), hours=18,
        )

        response = self.client.post(reverse('project-merge-into-parent', args=[child.id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        child.refresh_from_db()
        self.assertTrue(child.is_hidden)

        co_row = ProjectChangeOrder.objects.get(project=self.parent, department=Department.MED, name='CO02')
        self.assertEqual(co_row.hours_quoted, 30)
        self.assertEqual(float(co_row.cost_quoted), 2500.0)

        migrated_assignment = Assignment.objects.get(employee=employee)
        self.assertEqual(str(migrated_assignment.project_id), str(self.parent.id))
        self.assertEqual(migrated_assignment.hours, 12)

        migrated_actual = ProjectDepartmentWeeklyActual.objects.get(project=self.parent, department=Department.MED)
        self.assertEqual(migrated_actual.hours, 18)

    def test_merge_into_parent_sums_into_colliding_assignment_instead_of_overwriting(self):
        child = Project.objects.create(
            project_number='5001-CO03', name='5001-CO03', client='Acme', parent_project=self.parent,
            start_date=date(2026, 2, 1), end_date=date(2026, 4, 1), facility=Facility.MX, number_of_weeks=8,
        )
        employee = Employee.objects.create(name='Collision Tester', role='Eng', department=Department.MED, capacity=40)
        week = date(2026, 2, 2)
        Assignment.objects.create(employee=employee, project=self.parent, week_start_date=week, hours=5)
        Assignment.objects.create(employee=employee, project=child, week_start_date=week, hours=7)

        response = self.client.post(reverse('project-merge-into-parent', args=[child.id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        remaining = Assignment.objects.filter(employee=employee, project=self.parent, week_start_date=week)
        self.assertEqual(remaining.count(), 1)
        self.assertEqual(remaining.first().hours, 12)

    def test_move_department_rejects_collision_at_target(self):
        co1 = ProjectChangeOrder.objects.create(
            project=self.parent, department=Department.BUILD, name='CO01', hours_quoted=10,
        )
        ProjectChangeOrder.objects.create(
            project=self.parent, department=Department.BUILD, name='CO02', hours_quoted=5,
        )
        response = self.client.post(
            reverse('project-change-order-move-department', args=[co1.id]),
            data={'target_name': 'CO02'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_move_department_succeeds_when_target_is_free(self):
        co1 = ProjectChangeOrder.objects.create(
            project=self.parent, department=Department.BUILD, name='CO01', hours_quoted=10,
        )
        response = self.client.post(
            reverse('project-change-order-move-department', args=[co1.id]),
            data={'target_name': 'CO05'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        co1.refresh_from_db()
        self.assertEqual(co1.name, 'CO05')


class ProjectFullFieldRoundTripTests(APITestCase):
    """Every writable Project field, including multi-phase department_stages."""

    def setUp(self):
        self.user = make_full_access_user('project-fields-admin')
        self.client.force_authenticate(user=self.user)
        self.manager = Employee.objects.create(name='PM One', role='PM', department=Department.PM, capacity=40)

    def test_create_persists_every_field(self):
        payload = {
            'project_number': '6001',
            'name': 'Field Round Trip Project',
            'client': 'Acme Corp',
            'start_date': '2026-03-01',
            'end_date': '2026-08-01',
            'facility': Facility.MI,
            'number_of_weeks': 22,
            'project_manager_id': str(self.manager.id),
            'is_high_probability': True,
            'visible_in_departments': ['MED', 'BUILD'],
            'department_stages': {
                'BUILD': [
                    {'stage': Stage.ASSEMBLY, 'weekStart': 1, 'weekEnd': 4, 'departmentStartDate': '2026-03-01', 'durationWeeks': 4},
                    {'stage': Stage.COMMISSIONING, 'weekStart': 5, 'weekEnd': 8, 'departmentStartDate': '2026-03-29', 'durationWeeks': 4},
                ],
                'PRG': [
                    {'stage': Stage.OFFLINE, 'weekStart': 1, 'weekEnd': 2, 'departmentStartDate': '2026-03-01', 'durationWeeks': 2},
                    {'stage': Stage.ONLINE, 'weekStart': 3, 'weekEnd': 4, 'departmentStartDate': '2026-03-15', 'durationWeeks': 2},
                    {'stage': Stage.DEBUG, 'weekStart': 5, 'weekEnd': 6, 'departmentStartDate': '2026-03-29', 'durationWeeks': 2},
                ],
            },
        }
        response = self.client.post(reverse('project-list'), data=payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

        project = Project.objects.get(project_number='6001')
        self.assertEqual(project.name, 'Field Round Trip Project')
        self.assertEqual(project.client, 'Acme Corp')
        self.assertEqual(project.start_date, date(2026, 3, 1))
        self.assertEqual(project.end_date, date(2026, 8, 1))
        self.assertEqual(project.facility, Facility.MI)
        self.assertEqual(project.number_of_weeks, 22)
        self.assertEqual(str(project.project_manager_id), str(self.manager.id))
        self.assertTrue(project.is_high_probability)
        self.assertEqual(sorted(project.visible_in_departments), ['BUILD', 'MED'])

        build_stages = DepartmentStageConfig.objects.filter(project=project, department='BUILD').order_by('week_start')
        self.assertEqual(list(build_stages.values_list('stage', flat=True)), [Stage.ASSEMBLY, Stage.COMMISSIONING])
        prg_stages = DepartmentStageConfig.objects.filter(project=project, department='PRG').order_by('week_start')
        self.assertEqual(
            list(prg_stages.values_list('stage', flat=True)),
            [Stage.OFFLINE, Stage.ONLINE, Stage.DEBUG],
        )

    def test_update_replaces_every_field_and_clears_stale_substage(self):
        project = Project.objects.create(
            project_number='6002', name='Original', client='Old Client', start_date=date(2026, 1, 1),
            end_date=date(2026, 2, 1), facility=Facility.AL, number_of_weeks=4,
        )
        DepartmentStageConfig.objects.create(
            project=project, department='BUILD', stage=Stage.ASSEMBLY, week_start=1, week_end=2,
        )
        DepartmentStageConfig.objects.create(
            project=project, department='BUILD', stage=Stage.COMMISSIONING, week_start=3, week_end=4,
        )

        response = self.client.patch(
            reverse('project-detail', args=[project.id]),
            data={
                'name': 'Renamed',
                'client': 'New Client',
                'start_date': '2026-04-01',
                'end_date': '2026-09-01',
                'facility': Facility.MX,
                'number_of_weeks': 22,
                'is_high_probability': True,
                # Only one sub-phase sent this time -- the other must be cleared.
                'department_stages': {
                    'BUILD': [
                        {'stage': Stage.ASSEMBLY, 'weekStart': 1, 'weekEnd': 22, 'durationWeeks': 22},
                    ],
                },
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        project.refresh_from_db()
        self.assertEqual(project.name, 'Renamed')
        self.assertEqual(project.client, 'New Client')
        self.assertEqual(project.start_date, date(2026, 4, 1))
        self.assertEqual(project.end_date, date(2026, 9, 1))
        self.assertEqual(project.facility, Facility.MX)
        self.assertEqual(project.number_of_weeks, 22)
        self.assertTrue(project.is_high_probability)

        remaining_stages = DepartmentStageConfig.objects.filter(project=project, department='BUILD')
        self.assertEqual(remaining_stages.count(), 1)
        self.assertEqual(remaining_stages.first().stage, Stage.ASSEMBLY)


class EmployeeFullFieldRoundTripTests(APITestCase):
    def setUp(self):
        self.user = make_full_access_user('employee-fields-admin')
        self.client.force_authenticate(user=self.user)

    def test_create_persists_every_field(self):
        payload = {
            'name': 'Jane Doe', 'role': 'Senior Engineer', 'department': Department.HD,
            'capacity': 40, 'is_active': True, 'is_subcontracted_material': True,
            'subcontract_company': 'AMI', 'hire_date': '2024-05-01',
        }
        response = self.client.post(reverse('employee-list'), data=payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

        employee = Employee.objects.get(name='Jane Doe')
        self.assertEqual(employee.role, 'Senior Engineer')
        self.assertEqual(employee.department, Department.HD)
        self.assertEqual(employee.capacity, 40)
        self.assertTrue(employee.is_subcontracted_material)
        self.assertEqual(employee.subcontract_company, 'AMI')
        self.assertEqual(employee.hire_date, date(2024, 5, 1))

    def test_past_termination_date_forces_inactive_even_if_is_active_sent_true(self):
        employee = Employee.objects.create(
            name='Soon Retired', role='Tech', department=Department.MFG, capacity=40, is_active=True,
        )
        response = self.client.patch(
            reverse('employee-detail', args=[employee.id]),
            data={'termination_date': (date.today() - timedelta(days=1)).isoformat(), 'is_active': True},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        employee.refresh_from_db()
        self.assertFalse(employee.is_active)


class AssignmentFullFieldRoundTripTests(APITestCase):
    def setUp(self):
        self.user = make_full_access_user('assignment-fields-admin')
        self.client.force_authenticate(user=self.user)
        self.employee = Employee.objects.create(name='Assignment Tester', role='Eng', department=Department.BUILD, capacity=40)
        self.project = Project.objects.create(
            name='Assignment Fields Project', client='Acme', start_date=date.today(),
            end_date=date.today() + timedelta(weeks=8), facility=Facility.MX, number_of_weeks=8,
        )
        self.future_week = date.today() + timedelta(days=(7 - date.today().weekday()) % 7 + 7)

    def test_create_persists_every_field(self):
        payload = {
            'employee_id': str(self.employee.id), 'project_id': str(self.project.id),
            'week_start_date': self.future_week.isoformat(), 'hours': 20, 'scio_hours': 12,
            'external_hours': 8, 'stage': Stage.ASSEMBLY, 'comment': 'Round trip test',
            'department_override': Department.MED,
        }
        response = self.client.post(reverse('assignment-list'), data=payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

        assignment = Assignment.objects.get(employee=self.employee, project=self.project)
        self.assertEqual(assignment.hours, 20)
        self.assertEqual(assignment.scio_hours, 12)
        self.assertEqual(assignment.external_hours, 8)
        self.assertEqual(assignment.stage, Stage.ASSEMBLY)
        self.assertEqual(assignment.comment, 'Round trip test')
        self.assertEqual(assignment.department_override, Department.MED)
        self.assertEqual(assignment.effective_department, Department.MED)

    def test_duplicate_employee_project_week_stage_is_clean_400_not_500(self):
        Assignment.objects.create(
            employee=self.employee, project=self.project, week_start_date=self.future_week,
            hours=5, stage=Stage.ASSEMBLY,
        )
        response = self.client.post(
            reverse('assignment-list'),
            data={
                'employee_id': str(self.employee.id), 'project_id': str(self.project.id),
                'week_start_date': self.future_week.isoformat(), 'hours': 9, 'stage': Stage.ASSEMBLY,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_different_stage_same_week_does_not_collide(self):
        Assignment.objects.create(
            employee=self.employee, project=self.project, week_start_date=self.future_week,
            hours=5, stage=Stage.ASSEMBLY,
        )
        response = self.client.post(
            reverse('assignment-list'),
            data={
                'employee_id': str(self.employee.id), 'project_id': str(self.project.id),
                'week_start_date': self.future_week.isoformat(), 'hours': 9, 'stage': Stage.COMMISSIONING,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)


class CapacityModelsFieldRoundTripTests(APITestCase):
    def setUp(self):
        self.user = make_full_access_user('capacity-models-admin')
        self.client.force_authenticate(user=self.user)
        self.week = date(2026, 3, 2)

    def test_scio_team_capacity_persists_pto_and_training(self):
        payload = {'department': Department.MED, 'week_start_date': self.week.isoformat(), 'capacity': 40, 'pto': 8, 'training': 4}
        response = self.client.post(reverse('scio-team-capacity-list'), data=payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        record = ScioTeamCapacity.objects.get(department=Department.MED, week_start_date=self.week)
        self.assertEqual(record.capacity, 40)
        self.assertEqual(record.pto, 8)
        self.assertEqual(record.training, 4)

    def test_subcontracted_team_capacity_post_is_an_upsert_by_design(self):
        """
        Unlike most other models' duplicate-key POST (rejected with 400), this
        viewset's create() explicitly documents upsert semantics: a repeat
        company+week POST updates the existing row instead of erroring.
        """
        existing = SubcontractedTeamCapacity.objects.create(company='AMI', week_start_date=self.week, capacity=3)
        response = self.client.post(
            reverse('subcontracted-team-capacity-list'),
            data={'company': 'AMI', 'week_start_date': self.week.isoformat(), 'capacity': 5},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        existing.refresh_from_db()
        self.assertEqual(existing.capacity, 5)
        self.assertEqual(SubcontractedTeamCapacity.objects.filter(company='AMI', week_start_date=self.week).count(), 1)

    def test_prg_external_team_capacity_persists_all_fields(self):
        payload = {
            'department': Department.PRG, 'team_name': 'External Team A',
            'week_start_date': self.week.isoformat(), 'capacity': 6,
        }
        response = self.client.post(reverse('prg-external-team-capacity-list'), data=payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        record = PrgExternalTeamCapacity.objects.get(department=Department.PRG, team_name='External Team A', week_start_date=self.week)
        self.assertEqual(record.capacity, 6)


class DailyTimeEntryFieldRoundTripTests(APITestCase):
    def setUp(self):
        self.user = make_full_access_user('daily-time-entry-admin')
        self.client.force_authenticate(user=self.user)
        self.employee = Employee.objects.create(name='Daily Entry Tester', role='Eng', department=Department.MED, capacity=40)
        self.project = Project.objects.create(
            name='Daily Entry Project', client='Acme', start_date=date(2026, 1, 1),
            end_date=date(2026, 3, 1), facility=Facility.MX, number_of_weeks=8,
        )

    def test_project_entry_persists_with_project(self):
        response = self.client.post(
            reverse('daily-time-entry-list'),
            data={
                'employee_id': str(self.employee.id), 'date': '2026-02-02', 'entry_type': TimeEntryType.PROJECT,
                'project_id': str(self.project.id), 'hours': 6, 'comment': 'Worked on wiring',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        entry = DailyTimeEntry.objects.get(employee=self.employee, date=date(2026, 2, 2))
        self.assertEqual(entry.hours, 6)
        self.assertEqual(entry.comment, 'Worked on wiring')
        self.assertEqual(str(entry.project_id), str(self.project.id))

    def test_project_entry_without_project_is_rejected(self):
        response = self.client.post(
            reverse('daily-time-entry-list'),
            data={'employee_id': str(self.employee.id), 'date': '2026-02-02', 'entry_type': TimeEntryType.PROJECT, 'hours': 6},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_vacation_entry_with_project_is_rejected(self):
        response = self.client.post(
            reverse('daily-time-entry-list'),
            data={
                'employee_id': str(self.employee.id), 'date': '2026-02-02', 'entry_type': TimeEntryType.VACATION,
                'project_id': str(self.project.id), 'hours': 8,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_vacation_entry_without_project_persists(self):
        response = self.client.post(
            reverse('daily-time-entry-list'),
            data={'employee_id': str(self.employee.id), 'date': '2026-02-02', 'entry_type': TimeEntryType.VACATION, 'hours': 8},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        entry = DailyTimeEntry.objects.get(employee=self.employee, entry_type=TimeEntryType.VACATION)
        self.assertIsNone(entry.project)
        self.assertEqual(entry.hours, 8)


class TimingImportTests(APITestCase):
    """
    Covers the Timing .xlsx parser (POST /api/projects/parse-timing/) and the
    original_start_date/original_end_date (Project) and original_start_date/
    original_duration_weeks (DepartmentStageConfig) freeze-on-first-set behavior
    that lets a project's schedule be revised (e.g. re-uploading a Timing file)
    while still remembering its first-ever recorded dates.
    """

    @staticmethod
    def _build_timing_workbook(stage_rows, project_start=None, project_weeks=None):
        """
        stage_rows: list of (description, start_date, end_date) tuples, each
        written as a Type='S' row in the 'Timing' sheet, matching the real
        template's column layout (Type=col D, Description=col E, Start=col Q,
        End=col R, header row marked by 'id' in col B).
        """
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = 'Timing'
        header = [None] * 18
        header[1] = 'id'
        header[3] = 'Type'
        header[4] = 'Description'
        header[16] = 'Start'
        header[17] = 'End'
        ws.append(header)

        for idx, (description, start, end) in enumerate(stage_rows, start=1):
            row = [None] * 18
            row[1] = idx
            row[3] = 'S'
            row[4] = description
            row[16] = start
            row[17] = end
            ws.append(row)

        ws_settings = wb.create_sheet('Settings')
        if project_start is not None:
            ws_settings.append([None, None, 'Project Start Date:', project_start])
        if project_weeks is not None:
            ws_settings.append([None, None, 'Project Weeks:', project_weeks])

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        buf.name = 'Timing 9999 Test.xlsx'
        return buf

    def setUp(self):
        self.user = make_full_access_user('timing_admin')
        self.client.force_authenticate(user=self.user)

    def test_parse_timing_extracts_department_dates(self):
        workbook = self._build_timing_workbook(
            stage_rows=[
                ('MED', date(2026, 10, 7), date(2026, 11, 27)),
                ('HD', date(2026, 11, 30), date(2026, 12, 18)),
                ('MFG', date(2026, 11, 27), date(2027, 1, 5)),
                ('PUR', date(2026, 10, 16), date(2027, 1, 20)),
                ('RAW MATERIAL PUR', date(2026, 11, 27), date(2026, 12, 10)),
                ('BUILD', date(2027, 1, 6), date(2027, 2, 11)),
                ('Commissioning', date(2027, 4, 21), date(2027, 5, 13)),
                ('PRG OFFLINE', date(2026, 12, 2), date(2027, 1, 8)),
                ('PRG ONLINE', date(2027, 2, 12), date(2027, 3, 9)),
                ('PRG DEBUG', date(2027, 3, 10), date(2027, 4, 2)),
            ],
            project_start=date(2026, 9, 29),
            project_weeks=16,
        )
        response = self.client.post(
            reverse('project-parse-timing'),
            {'file': workbook},
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        data = response.data

        self.assertEqual(data['project_start_date'], '2026-09-29')
        self.assertEqual(data['number_of_weeks'], 16)
        self.assertEqual(data['departments']['MED'], {'start': '2026-10-07', 'end': '2026-11-27'})
        self.assertEqual(data['departments']['HD'], {'start': '2026-11-30', 'end': '2026-12-18'})
        self.assertEqual(data['departments']['PURCHASING'], {'start': '2026-10-16', 'end': '2027-01-20'})
        self.assertEqual(
            data['departments']['BUILD'],
            {
                'ASSEMBLY': {'start': '2027-01-06', 'end': '2027-02-11'},
                'COMMISSIONING': {'start': '2027-04-21', 'end': '2027-05-13'},
            },
        )
        self.assertEqual(
            data['departments']['PRG'],
            {
                'OFFLINE': {'start': '2026-12-02', 'end': '2027-01-08'},
                'ONLINE': {'start': '2027-02-12', 'end': '2027-03-09'},
                'DEBUG': {'start': '2027-03-10', 'end': '2027-04-02'},
            },
        )
        self.assertTrue(any('RAW MATERIAL PUR' in w for w in data['warnings']))

    def test_parse_timing_flags_missing_stage_and_invalid_dates(self):
        workbook = self._build_timing_workbook(
            stage_rows=[
                ('MED', date(2026, 10, 7), date(2026, 11, 27)),
                # HD, MFG, PUR, BUILD, Commissioning, PRG stages all omitted on purpose.
                ('RAW MATERIAL PUR', date(1900, 1, 1), date(1900, 1, 10)),
            ],
        )
        response = self.client.post(
            reverse('project-parse-timing'),
            {'file': workbook},
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        data = response.data

        self.assertNotIn('HD', data['departments'])
        self.assertNotIn('BUILD', data['departments'])
        self.assertNotIn('PRG', data['departments'])
        warnings_text = ' '.join(data['warnings'])
        self.assertIn('HD', warnings_text)
        self.assertIn('inválidas', warnings_text)

    def test_parse_timing_rejects_file_without_timing_sheet(self):
        wb = openpyxl.Workbook()
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        buf.name = 'not_a_timing_file.xlsx'
        response = self.client.post(
            reverse('project-parse-timing'),
            {'file': buf},
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_project_original_dates_are_frozen_after_first_set(self):
        payload = {
            'name': 'Timing Test Project',
            'client': 'Test Client',
            'start_date': '2026-09-29',
            'end_date': '2027-05-17',
            'facility': 'AL',
            'number_of_weeks': 16,
        }
        response = self.client.post(reverse('project-list'), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        project_id = response.data['id']
        self.assertEqual(response.data['original_start_date'], '2026-09-29')
        self.assertEqual(response.data['original_end_date'], '2027-05-17')

        # Simulate a re-uploaded Timing file that shifted the whole schedule out.
        response = self.client.patch(
            reverse('project-detail', args=[project_id]),
            {'start_date': '2026-10-13', 'end_date': '2027-05-31'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['start_date'], '2026-10-13')
        self.assertEqual(response.data['end_date'], '2027-05-31')
        # original_* must not have moved.
        self.assertEqual(response.data['original_start_date'], '2026-09-29')
        self.assertEqual(response.data['original_end_date'], '2027-05-17')

    def test_department_stage_original_dates_are_frozen_after_first_set(self):
        payload = {
            'name': 'Timing Test Project 2',
            'client': 'Test Client',
            'start_date': '2026-09-29',
            'end_date': '2027-05-17',
            'facility': 'AL',
            'number_of_weeks': 16,
            'department_stages': {
                'MED': [{
                    'stage': None,
                    'weekStart': 2,
                    'weekEnd': 9,
                    'departmentStartDate': '2026-10-07',
                    'durationWeeks': 8,
                }],
            },
        }
        response = self.client.post(reverse('project-list'), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        project_id = response.data['id']
        med_config = DepartmentStageConfig.objects.get(project_id=project_id, department='MED')
        self.assertEqual(str(med_config.original_start_date), '2026-10-07')
        self.assertEqual(med_config.original_duration_weeks, 8)

        # Re-upload a revised Timing file that pushed MED's dates out.
        response = self.client.patch(
            reverse('project-detail', args=[project_id]),
            {
                'department_stages': {
                    'MED': [{
                        'stage': None,
                        'weekStart': 2,
                        'weekEnd': 9,
                        'departmentStartDate': '2026-10-21',
                        'durationWeeks': 8,
                    }],
                },
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        med_config.refresh_from_db()
        self.assertEqual(str(med_config.department_start_date), '2026-10-21')
        # The original must stay at the first-ever recorded value.
        self.assertEqual(str(med_config.original_start_date), '2026-10-07')
        self.assertEqual(med_config.original_duration_weeks, 8)
