from datetime import date, timedelta

from django.contrib.auth.models import User
from django.urls import reverse
from django.utils import timezone
from rest_framework_simplejwt.tokens import UntypedToken
from rest_framework import status
from rest_framework.test import APITestCase

from .models import (
    Assignment,
    Department,
    DepartmentStageConfig,
    EmailVerification,
    Employee,
    Facility,
    OtherDepartment,
    Project,
    ProjectBudget,
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

    def test_inactive_session_is_forced_closed_after_timeout(self):
        login_response = self._login('Inactivity-Device')
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)

        access = login_response.data['access']
        session_id = UntypedToken(access).get('session_id')
        self.assertIsNotNone(session_id)

        stale_time = timezone.now() - timedelta(minutes=21)
        UserSession.objects.filter(id=session_id, user=self.user).update(
            is_active=True,
            last_activity=stale_time,
        )

        session_status = self.client.get(reverse('session_status'), **self._auth_headers(access))
        self.assertEqual(session_status.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(UserSession.objects.get(id=session_id).is_active)


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


class RegistrationVerificationTests(APITestCase):
    def _registration_payload(self, email='new.user@na.scio-automation.com'):
        return {
            'email': email,
            'password': 'StrongPassword123!',
            'confirm_password': 'StrongPassword123!',
            'first_name': 'New',
            'last_name': 'User',
            'department': UserDepartment.PRG,
        }

    def test_registration_creates_inactive_user_with_verification_code(self):
        payload = self._registration_payload()

        response = self.client.post(reverse('user_register'), payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        user = User.objects.get(email=payload['email'])
        verification = EmailVerification.objects.get(user=user)
        self.assertFalse(user.is_active)
        self.assertIsNotNone(verification.code)
        self.assertEqual(len(verification.code), 6)
        self.assertIsNone(verification.verified_at)

    def test_login_fails_until_user_is_verified(self):
        payload = self._registration_payload(email='pending.user@na.scio-automation.com')
        register_response = self.client.post(reverse('user_register'), payload, format='json')
        self.assertEqual(register_response.status_code, status.HTTP_201_CREATED)

        login_response = self.client.post(
            reverse('token_obtain_pair'),
            {'username': payload['email'], 'password': payload['password']},
            format='json',
        )

        self.assertEqual(login_response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIn('verificar', str(login_response.data).lower())

    def test_verify_code_activates_user_and_allows_login(self):
        payload = self._registration_payload(email='verified.user@na.scio-automation.com')
        register_response = self.client.post(reverse('user_register'), payload, format='json')
        self.assertEqual(register_response.status_code, status.HTTP_201_CREATED)

        verification = EmailVerification.objects.get(user__email=payload['email'])
        verify_response = self.client.post(
            reverse('verify_code'),
            {'email': payload['email'], 'code': verification.code},
            format='json',
        )
        self.assertEqual(verify_response.status_code, status.HTTP_200_OK)

        user = User.objects.get(email=payload['email'])
        self.assertTrue(user.is_active)

        login_response = self.client.post(
            reverse('token_obtain_pair'),
            {'username': payload['email'], 'password': payload['password']},
            format='json',
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)
        self.assertIn('access', login_response.data)
        self.assertIn('refresh', login_response.data)


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
