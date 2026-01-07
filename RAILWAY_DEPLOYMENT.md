# Despliegue en Railway - Guía Paso a Paso

## ¿Por qué Railway?

- **Confiable:** Usado por empresas profesionales
- **Fácil de usar:** Interfaz intuitiva
- **PostgreSQL incluido:** Base de datos profesional
- **Precio justo:** ~$5-10/mes para desarrollo
- **Actualizaciones automáticas:** Tus cambios en GitHub se despliegan automáticamente

---

## PASO 1: Crear Cuenta en Railway

1. Ve a **https://railway.app**
2. Click en **"Start Project"** o **"Sign Up"**
3. **Opción A:** Login con GitHub (RECOMENDADO - más fácil)
   - Click en "GitHub"
   - Autoriza Railway a acceder a tu GitHub
4. **Opción B:** Email y contraseña
   - Completa el formulario
   - Verifica tu email

**✓ Listo:** Ya tienes cuenta en Railway

---

## PASO 2: Agregar Método de Pago

1. Ve a tu **Dashboard** en Railway
2. Click en tu **perfil** (esquina superior derecha)
3. Click en **"Billing"** o **"Payments"**
4. Click en **"Add Payment Method"**
5. Completa los datos de tu tarjeta (Visa, Mastercard, etc.)
6. Railway te cobrará cuando uses recursos

**Costo estimado:**
- Base de datos PostgreSQL pequeña: $5-7/mes
- Servidor Django: $5-10/mes
- Total: ~$10-15/mes

**✓ Listo:** Método de pago agregado

---

## PASO 3: Conectar GitHub a Railway

1. En Railway Dashboard, click en **"New Project"**
2. Click en **"Deploy from GitHub"**
3. Si no está conectado:
   - Click en **"Configure GitHub App"**
   - Autoriza Railway en GitHub
   - Selecciona tu repositorio `capacity-planner`
4. Si ya está conectado:
   - Selecciona el repositorio `capacity-planner`
   - Railway automáticamente detectará que es un proyecto Django

**✓ Listo:** GitHub conectado

---

## PASO 4: Crear la Base de Datos PostgreSQL

1. En el proyecto de Railway, click en **"+"** (Add Service)
2. Click en **"Database"**
3. Selecciona **"PostgreSQL"**
4. Railway automáticamente:
   - Crea la BD
   - Genera credenciales
   - Las configura como variables de entorno

**✓ Listo:** PostgreSQL creado automáticamente

---

## PASO 5: Configurar Variables de Entorno

Railway automáticamente genera variables para PostgreSQL:
- `DATABASE_URL` - URL completa de la BD
- `PGPASSWORD` - Contraseña
- `PGHOST` - Host
- `PGPORT` - Puerto
- `PGUSER` - Usuario
- `PGDATABASE` - Nombre de la BD

Ahora agrega las variables de Django:

1. En Railway, abre el servicio **Django** (no PostgreSQL)
2. Click en **"Variables"**
3. Agrega estas variables:

```
DEBUG=False
SECRET_KEY=tu-clave-super-secreta-aqui-minimo-50-caracteres
ALLOWED_HOSTS=tu-app.railway.app,www.tu-app.railway.app,localhost
CORS_ALLOWED_ORIGINS=https://tu-frontend.com,http://localhost:5173

# Database - Django leerá DATABASE_URL automáticamente
DB_ENGINE=django.db.backends.postgresql
DB_NAME=${{ Postgres.PGDATABASE }}
DB_USER=${{ Postgres.PGUSER }}
DB_PASSWORD=${{ Postgres.PGPASSWORD }}
DB_HOST=${{ Postgres.PGHOST }}
DB_PORT=${{ Postgres.PGPORT }}
```

**IMPORTANTE:**
- Reemplaza `tu-clave-super-secreta-aqui...` con una clave larga y aleatoria
- Reemplaza `tu-frontend.com` con tu dominio real (o deja localhost:5173)
- Railway detectará automáticamente `${{ Postgres.PGHOST }}` etc.

**✓ Listo:** Variables configuradas

---

## PASO 6: Configurar la Rama y Root Directory

1. En Railway, abre el servicio **Django**
2. Click en **"Settings"**
3. **GitHub Branch:** Selecciona `main`
4. **Root Directory:** Establece a `backend`
5. **Build Command:** (debería estar auto-configurado, pero verifica)
   ```
   pip install -r requirements.txt && python manage.py migrate && python manage.py load_initial_data && python manage.py collectstatic --noinput
   ```

**O mejor:** Usa `entrypoint.sh` directamente

6. **Start Command:**
   ```
   gunicorn config.wsgi:application --bind 0.0.0.0:8000
   ```

**✓ Listo:** Build y Start commands configurados

---

## PASO 7: Desplegar

1. En Railway Dashboard
2. Click en tu proyecto
3. Verás que automáticamente:
   - Detecta cambios en GitHub
   - Inicia el deploy
4. Espera a ver: **"✓ Deployed successfully"** (toma 2-5 minutos)

---

## PASO 8: Obtener URL de tu App

1. En Railway Dashboard
2. Click en el servicio **Django**
3. En la parte superior verás algo como: `tu-app-abc123.railway.app`
4. Click en ese URL para ir a tu app

**Verás:**
```json
{
  "message": "Team Capacity Planner API",
  "version": "1.0",
  "endpoints": {
    "employees": "/api/employees/",
    "projects": "/api/projects/",
    ...
  }
}
```

---

## PASO 9: Probar los Endpoints

### Obtener Token (Login)
```bash
curl -X POST https://tu-app-abc123.railway.app/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

Respuesta:
```json
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc..."
}
```

### Usar el Token para obtener Empleados
```bash
curl https://tu-app-abc123.railway.app/api/employees/ \
  -H "Authorization: Bearer <tu-token-aqui>"
```

### Ver Admin Panel
```
https://tu-app-abc123.railway.app/admin/
Usuario: admin
Contraseña: admin
```

---

## PASO 10: Configurar Dominio Personalizado (Opcional)

Si tienes tu propio dominio (ej: `api.miapp.com`):

1. En Railway, click en tu proyecto
2. Click en **"Domains"**
3. Click en **"+ Add Domain"**
4. Ingresa tu dominio
5. Railway te da instrucciones para actualizar DNS en tu registrador

---

## Solucionar Problemas

### Problema 1: "Build failed"
**Solución:**
1. Click en el build que falló
2. Scroll hacia arriba en los logs
3. Busca el error (generalmente relacionado con imports o dependencias)
4. Actualiza `requirements.txt` y haz push a GitHub

### Problema 2: "Connection refused" en la BD
**Solución:**
1. Verifica que PostgreSQL esté corriendo (debería estarlo automáticamente)
2. Revisa las variables de entorno: están correctas?
3. En Railway, reinicia el servicio PostgreSQL

### Problema 3: "404 Not Found" en todos los endpoints
**Solución:**
1. Verifica `ALLOWED_HOSTS` en Variables
2. Debería incluir tu URL de Railway
3. Reinicia el deploy

### Problema 4: "500 Internal Server Error"
**Solución:**
1. Ve a Railway y abre los **Logs**
2. Scroll hacia el final
3. Busca el error real
4. Generalmente es un error de imports o base de datos

---

## Comandos Útiles en Railway

### Ver Logs en Vivo
```bash
railway logs -f
```

### Conectar SSH a la máquina
```bash
railway shell
```

### Ejecutar comando Django
```bash
railway run python manage.py shell
```

---

## Actualizar el Código

Cada vez que hagas cambios:

1. En tu computadora:
   ```bash
   git add .
   git commit -m "Descripción del cambio"
   git push
   ```

2. Railway automáticamente:
   - Detecta el push
   - Inicia el build
   - Despliega la nueva versión

**No necesitas hacer nada más** - es automático!

---

## Estructura Final

```
Railway Project
├── Django Service
│   ├── GitHub: capacity-planner/backend
│   ├── Variables de Entorno
│   ├── Build Command (migraciones)
│   └── Start Command (Gunicorn)
└── PostgreSQL Service
    └── Credenciales automáticas
```

---

## Verificación Final

✓ Cuenta creada en Railway
✓ Método de pago agregado
✓ GitHub conectado
✓ PostgreSQL creado
✓ Variables de entorno configuradas
✓ Deploy completado exitosamente
✓ API accesible en `https://tu-app.railway.app/`

---

**¡Ya está! Tu backend está en producción en Railway 🚀**

Puedes:
- Acceder a `/api/` para ver endpoints
- Acceder a `/admin/` para administrar datos
- Conectar tu frontend a la API
- Dormir tranquilo que Railway maneja escalabilidad y backups

¡Listo! Cualquier pregunta, dime cuál es tu URL de Railway y te ayudo.
