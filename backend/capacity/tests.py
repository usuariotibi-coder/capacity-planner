from datetime import date, timedelta

from django.contrib.auth.models import User
from django.urls import reverse
from django.utils import timezone
from rest_framework_simplejwt.tokens import UntypedToken
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Assignment, Department, Employee, Facility, Project, UserSession


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
