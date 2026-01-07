"""
URL configuration for Team Capacity Planner API
"""
from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from capacity.views import (
    EmployeeViewSet,
    ProjectViewSet,
    AssignmentViewSet,
    DepartmentStageConfigViewSet,
    ProjectBudgetViewSet,
    ActivityLogViewSet,
)

# Create a router and register viewsets
router = DefaultRouter()
router.register(r'employees', EmployeeViewSet, basename='employee')
router.register(r'projects', ProjectViewSet, basename='project')
router.register(r'assignments', AssignmentViewSet, basename='assignment')
router.register(r'department-stages', DepartmentStageConfigViewSet, basename='department-stage')
router.register(r'project-budgets', ProjectBudgetViewSet, basename='project-budget')
router.register(r'activity-logs', ActivityLogViewSet, basename='activity-log')

urlpatterns = [
    # Admin panel
    path('admin/', admin.site.urls),

    # Authentication endpoints
    path('api/token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # API endpoints
    path('api/', include(router.urls)),

    # Default authentication endpoints
    path('api-auth/', include('rest_framework.urls')),
]
