# Planificador de Capacidad del Equipo - API Backend

Una API de Django REST Framework lista para producción para administrar la capacidad del equipo, proyectos y asignación de recursos en múltiples departamentos.

## 🚀 Inicio Rápido

### Requisitos Previos
- Python 3.11+
- PostgreSQL 12+
- pip & virtualenv

### Configuración de Desarrollo Local

```bash
# 1. Clonar el repositorio (o navegar a la carpeta backend)
cd backend

# 2. Crear entorno virtual
python -m venv venv

# 3. Activar entorno virtual
# En Windows:
venv\Scripts\activate
# En macOS/Linux:
source venv/bin/activate

# 4. Instalar dependencias
pip install -r requirements.txt

# 5. Copiar variables de entorno
cp .env.example .env

# 6. Actualizar .env con las credenciales de la base de datos

# 7. Ejecutar migraciones
python manage.py migrate

# 8. Crear superusuario (admin)
python manage.py createsuperuser

# 9. Iniciar servidor de desarrollo
python manage.py runserver

# API estará disponible en http://localhost:8000/api/
# Panel de administración en http://localhost:8000/admin/
```

## 📚 Documentación

- **[LOCAL_TESTING.md](./LOCAL_TESTING.md)** - Guía de pruebas locales con datos de prueba y casos de prueba
- **[API_DOCUMENTATION.md](./API_DOCUMENTATION.md)** - Referencia completa de la API con ejemplos
- **[SESSION_MANAGEMENT.md](./SESSION_MANAGEMENT.md)** - Sistema de sesiones, limites de dispositivos e inactividad
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Guía de despliegue en Railway

## 🏗️ Estructura del Proyecto

```
backend/
├── config/                      # Configuración de Django
│   ├── settings.py             # Configuración (lista para producción)
│   ├── urls.py                 # Enrutamiento de URL
│   ├── wsgi.py                 # Aplicación WSGI
│   └── asgi.py                 # Aplicación ASGI
├── capacity/                    # Aplicación principal de Django
│   ├── models.py               # Modelos de la base de datos
│   ├── views.py                # ViewSets y lógica de API
│   ├── serializers.py          # Serializadores DRF
│   ├── permissions.py          # Permisos personalizados
│   ├── filters.py              # Filtros personalizados
│   └── admin.py                # Configuración del admin de Django
├── manage.py                    # Script de gestión de Django
├── requirements.txt             # Dependencias de Python
├── Dockerfile                   # Configuración de Docker
├── Procfile                     # Archivo de despliegue Heroku/Railway
├── railway.toml                 # Configuración de Railway
├── .env.example                 # Plantilla de variables de entorno
└── README.md                    # Este archivo
```

## 🗄️ Modelos de Base de Datos

### Empleado
- Clave primaria UUID
- Nombre, Rol, Departamento
- Capacidad (horas/semana)
- Estado activo
- Bandera de material subcontratado con nombre de empresa

### Proyecto
- Clave primaria UUID
- Nombre, Cliente
- Fechas de inicio/fin
- Instalación (AL, MI, MX)
- Número de semanas
- Referencia del gerente de proyecto

### Asignación
- Clave primaria UUID
- Referencias de Empleado y Proyecto
- Fecha de inicio de la semana
- Horas, horas SCIO, horas externas
- Etapa, Comentario

### Presupuesto de Proyecto
- Horas de presupuesto por departamento
- Horas utilizadas
- Horas pronosticadas
- Porcentaje de utilización calculado

### Configuración de Etapa de Departamento
- Configuración de etapa específica del departamento
- Inicio/fin de semana para cada departamento
- Fecha de inicio del departamento y duración

### Registro de Actividad
- Registro de auditoría de todos los cambios
- Usuario, Acción, Modelo, ID de objeto
- Campo de cambios JSON
- Marca de tiempo

## 🔐 Autenticación

La API utiliza **JWT (JSON Web Tokens)** para la autenticación.

### Obtener un Token

```bash
curl -X POST http://localhost:8000/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username": "tu-usuario", "password": "tu-contraseña"}'
```

Respuesta:
```json
{
  "access": "eyJhbGc...",
  "refresh": "eyJhbGc..."
}
```

### Usar el Token

Agregar al encabezado de la solicitud:
```
Authorization: Bearer <tu-token-de-acceso>
```

### Renovar Token

```bash
curl -X POST http://localhost:8000/api/token/refresh/ \
  -H "Content-Type: application/json" \
  -d '{"refresh": "tu-token-de-renovación"}'
```

## 📡 Puntos de Acceso de la API

### Autenticación
- `POST /api/token/` - Obtener tokens de acceso y renovación
- `POST /api/token/refresh/` - Renovar token de acceso

### Empleados
- `GET /api/employees/` - Listar todos los empleados
- `POST /api/employees/` - Crear nuevo empleado
- `GET /api/employees/{id}/` - Obtener detalles del empleado
- `PUT /api/employees/{id}/` - Actualizar empleado
- `DELETE /api/employees/{id}/` - Eliminar empleado
- `GET /api/employees/{id}/capacity-summary/` - Obtener resumen de capacidad
- `GET /api/employees/{id}/workload/` - Obtener pronóstico de carga de trabajo de 8 semanas

### Proyectos
- `GET /api/projects/` - Listar todos los proyectos
- `POST /api/projects/` - Crear nuevo proyecto
- `GET /api/projects/{id}/` - Obtener detalles del proyecto
- `PUT /api/projects/{id}/` - Actualizar proyecto
- `DELETE /api/projects/{id}/` - Eliminar proyecto
- `GET /api/projects/{id}/statistics/` - Obtener estadísticas del proyecto
- `GET /api/projects/{id}/budget-report/` - Obtener reporte de presupuesto

### Asignaciones
- `GET /api/assignments/` - Listar todas las asignaciones
- `POST /api/assignments/` - Crear nueva asignación
- `GET /api/assignments/{id}/` - Obtener detalles de asignación
- `PUT /api/assignments/{id}/` - Actualizar asignación
- `DELETE /api/assignments/{id}/` - Eliminar asignación
- `GET /api/assignments/by-week/` - Obtener asignaciones por semana
- `GET /api/assignments/capacity-by-dept/` - Obtener capacidad por departamento

### Etapas de Departamento
- `GET /api/department-stages/` - Listar configuraciones
- `POST /api/department-stages/` - Crear configuración
- `GET /api/department-stages/{id}/` - Obtener detalles
- `PUT /api/department-stages/{id}/` - Actualizar
- `DELETE /api/department-stages/{id}/` - Eliminar

### Presupuestos de Proyecto
- `GET /api/project-budgets/` - Listar presupuestos
- `POST /api/project-budgets/` - Crear presupuesto
- `GET /api/project-budgets/{id}/` - Obtener detalles
- `PUT /api/project-budgets/{id}/` - Actualizar
- `DELETE /api/project-budgets/{id}/` - Eliminar

### Registros de Actividad
- `GET /api/activity-logs/` - Listar registros de actividad (solo lectura)
- `GET /api/activity-logs/{id}/` - Obtener detalles del registro

## 🔄 Filtrado y Búsqueda

Todos los puntos de acceso de lista admiten filtrado, búsqueda y ordenamiento:

```bash
# Filtrar por departamento
GET /api/employees/?department=MED

# Buscar por nombre
GET /api/employees/?search=John

# Ordenar por capacidad
GET /api/employees/?ordering=-capacity

# Filtrar por rango de fechas
GET /api/projects/?start_date=2024-01-01&end_date=2024-12-31

# Combinar filtros
GET /api/assignments/?employee=<id>&project=<id>&week_start_date=2024-01-08
```

## 📊 Paginación

La API devuelve resultados paginados (50 elementos por página por defecto):

```json
{
  "count": 150,
  "next": "http://localhost:8000/api/employees/?page=2",
  "previous": null,
  "results": [...]
}
```

## ⚙️ Configuración

### Variables de Entorno

Copiar `.env.example` a `.env` y actualizar:

```env
DEBUG=False
SECRET_KEY=tu-clave-secreta
ALLOWED_HOSTS=localhost,127.0.0.1
DB_NAME=capacity_planner
DB_USER=postgres
DB_PASSWORD=tu-contraseña
DB_HOST=localhost
DB_PORT=5432
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

### Configuración de Email (Resend recomendado)

Para el flujo de verificación por código:

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxx
DEFAULT_FROM_EMAIL=noreply@na.scio-automation.com
```

Opcional (fallback SMTP si no hay API key):

```env
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.resend.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=resend
EMAIL_HOST_PASSWORD=re_smtp_xxxxxxxxxxxxxxxxxxxxxxxxx
```

### Configuración de CORS

Configurar CORS en `.env`:

```env
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000,https://tudominio.com
```

## 🚀 Despliegue

### Railway

1. Conectar el repositorio de GitHub a Railway
2. Establecer variables de entorno en el panel de Railway
3. Desplegar:

```bash
git push origin main
```

Ver [DEPLOYMENT.md](./DEPLOYMENT.md) para instrucciones detalladas.

### Docker

```bash
# Compilar imagen
docker build -t capacity-planner-api .

# Ejecutar contenedor
docker run -p 8000:8000 \
  -e DATABASE_URL=postgresql://usuario:contraseña@host/bd \
  -e SECRET_KEY=tu-clave-secreta \
  capacity-planner-api
```

## 🧪 Pruebas

### Ejecutar Pruebas

```bash
python manage.py test
```

### Ejemplos de Solicitudes cURL

```bash
# Iniciar sesión
curl -X POST http://localhost:8000/api/token/ \
  -d "username=admin&password=password"

# Obtener empleados
curl -H "Authorization: Bearer <token>" \
  http://localhost:8000/api/employees/

# Crear proyecto
curl -X POST http://localhost:8000/api/projects/ \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Nuevo Proyecto",
    "client": "Nombre del Cliente",
    "start_date": "2024-01-01",
    "end_date": "2024-12-31",
    "facility": "AL",
    "number_of_weeks": 52
  }'
```

## 🛠️ Panel de Administración

Acceder al admin de Django en `http://localhost:8000/admin/`

Crear un superusuario:
```bash
python manage.py createsuperuser
```

## 📝 Solución de Problemas

### Error de Conexión a la Base de Datos
- Asegurar que PostgreSQL está en ejecución
- Verificar las credenciales de la base de datos en `.env`
- Ejecutar migraciones: `python manage.py migrate`

### Errores de CORS
- Actualizar `CORS_ALLOWED_ORIGINS` en `.env`
- Asegurar que la URL del frontend está incluida

### 401 No Autorizado
- El token puede haber expirado
- Renovar token: `POST /api/token/refresh/`
- Obtener nuevo token: `POST /api/token/`

### Errores de Migración
```bash
python manage.py migrate --fake capacity zero
python manage.py migrate
```

## 📄 Licencia

Propietario - No para distribución pública

## 👥 Soporte

Para problemas o preguntas, contactar al equipo de desarrollo.

---

**Última Actualización**: 6 de enero de 2026
**Versión**: 1.0.0
**Estado**: Listo para Producción

