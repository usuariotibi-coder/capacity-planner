"""
URL configuration for Team Capacity Planner API
"""
from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework.views import APIView
from rest_framework.response import Response
from capacity.views import (
    EmployeeViewSet,
    ProjectViewSet,
    AssignmentViewSet,
    DepartmentStageConfigViewSet,
    ProjectBudgetViewSet,
    ActivityLogViewSet,
    ScioTeamCapacityViewSet,
    SubcontractedTeamCapacityViewSet,
    PrgExternalTeamCapacityViewSet,
    DepartmentWeeklyTotalViewSet,
    UserRegistrationView,
    EmailVerificationView,
    ResendVerificationEmailView,
)

# Create a router and register viewsets
router = DefaultRouter()
router.register(r'employees', EmployeeViewSet, basename='employee')
router.register(r'projects', ProjectViewSet, basename='project')
router.register(r'assignments', AssignmentViewSet, basename='assignment')
router.register(r'department-stages', DepartmentStageConfigViewSet, basename='department-stage')
router.register(r'project-budgets', ProjectBudgetViewSet, basename='project-budget')
router.register(r'activity-logs', ActivityLogViewSet, basename='activity-log')
router.register(r'scio-team-capacity', ScioTeamCapacityViewSet, basename='scio-team-capacity')
router.register(r'subcontracted-team-capacity', SubcontractedTeamCapacityViewSet, basename='subcontracted-team-capacity')
router.register(r'prg-external-team-capacity', PrgExternalTeamCapacityViewSet, basename='prg-external-team-capacity')
router.register(r'department-weekly-total', DepartmentWeeklyTotalViewSet, basename='department-weekly-total')

class RootView(APIView):
    def get(self, request):
        return Response({
            'message': 'Team Capacity Planner API',
            'version': '1.0',
            'endpoints': {
                'employees': '/employees/',
                'projects': '/projects/',
                'assignments': '/assignments/',
                'department-stages': '/department-stages/',
                'project-budgets': '/project-budgets/',
                'activity-logs': '/activity-logs/',
                'scio-team-capacity': '/scio-team-capacity/',
                'subcontracted-team-capacity': '/subcontracted-team-capacity/',
                'prg-external-team-capacity': '/prg-external-team-capacity/',
                'department-weekly-total': '/department-weekly-total/',
                'token': '/token/',
                'token-refresh': '/token/refresh/',
            }
        })

urlpatterns = [
    # Admin panel
    path('admin/', admin.site.urls),

    # Root API endpoint
    path('', RootView.as_view(), name='root'),

    # Authentication endpoints
    path('api/token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # Registration endpoints
    path('api/register/', UserRegistrationView.as_view(), name='user_register'),
    path('api/verify-email/<str:token>/', EmailVerificationView.as_view(), name='email_verify'),
    path('api/resend-verification-email/', ResendVerificationEmailView.as_view(), name='resend_verification_email'),

    # API endpoints
    path('api/', include(router.urls)),

    # Default authentication endpoints
    path('api-auth/', include('rest_framework.urls')),
]
