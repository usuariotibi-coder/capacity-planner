# Planificador de Capacidad del Equipo - Guía Rápida de Referencia

## 🚀 COMIENZA AQUÍ (90 segundos)

### Paso 1: Ejecutar Backend (Windows)
```bash
cd backend
run_local.bat
```

### Paso 2: Abrir Navegador
- **API**: http://localhost:8000/api/
- **Admin**: http://localhost:8000/admin/
- **Credenciales**: admin / admin

### Paso 3: Probar API
```bash
# Obtener token
curl -X POST http://localhost:8000/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'

# Listar empleados (reemplazar TOKEN)
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:8000/api/employees/
```

---

## 📚 Mapa de Documentación

| Necesito | Archivo | Líneas |
|----------|---------|--------|
| **Primeros pasos** | [RESUMEN_EJECUTIVO.md](./RESUMEN_EJECUTIVO.md) | 300 |
| **Configuración** | [backend/README.md](./backend/README.md) | 350 |
| **Prueba API** | [backend/LOCAL_TESTING.md](./backend/LOCAL_TESTING.md) | 400 |
| **Referencia API** | [backend/API_DOCUMENTATION.md](./backend/API_DOCUMENTATION.md) | 1000+ |
| **Despliegue** | [backend/DEPLOYMENT_ES.md](./backend/DEPLOYMENT_ES.md) | 300 |
| **Integración Frontend** | [INTEGRATION_CHECKLIST.md](./INTEGRATION_CHECKLIST.md) | 300 |

---

## 🔑 Credenciales Predeterminadas

| Componente | Usuario | Contraseña |
|-----------|---------|-----------|
| Panel Admin | admin | admin |
| API (si necesario) | admin | admin |

---

## 🌐 Puntos de Acceso de API - Lista Rápida

```
Autenticación:
POST   /api/token/           Obtener token
POST   /api/token/refresh/   Renovar token

Recursos (todos soportan GET, POST, PUT, DELETE):
/api/employees/             9 empleados de prueba
/api/projects/              3 proyectos de prueba
/api/assignments/           11 asignaciones de prueba
/api/department-stages/     Configuración de departamento
/api/project-budgets/       Seguimiento de presupuesto
/api/activity-logs/         Registro de auditoría (solo lectura)
```

---

## 🧪 Comandos de Prueba Rápida

```bash
# Obtener token
TOKEN=$(curl -s -X POST http://localhost:8000/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' \
  | grep -o '"access":"[^"]*' | cut -d'"' -f4)

echo "Token: $TOKEN"
```

```bash
# Probar empleados
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/employees/ | jq

# Probar proyectos
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/projects/ | jq

# Probar asignaciones
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/assignments/ | jq
```

---

## 📁 Estructura del Proyecto

```
Capacity/
├── backend/                  ← Comienza aquí
│   ├── run_local.bat        ← Haz clic aquí
│   ├── README.md            ← Lee esto
│   └── LOCAL_TESTING.md     ← Luego esto
├── team-capacity-planner/    ← Frontend
├── RESUMEN_EJECUTIVO.md      ← Guía
└── GUIA_RAPIDA.md           ← Este archivo
```

---

## 🔐 Seguridad

- ✅ Autenticación JWT
- ✅ CORS configurado
- ✅ DEBUG=False en producción
- ✅ Clave secreta protegida
- ✅ SSL/TLS en Railway
- ✅ Limitación de velocidad habilitada

---

## 📞 Recursos

- **Configuración**: [backend/README.md](./backend/README.md)
- **Pruebas**: [backend/LOCAL_TESTING.md](./backend/LOCAL_TESTING.md)
- **API Completa**: [backend/API_DOCUMENTATION.md](./backend/API_DOCUMENTATION.md)
- **Despliegue**: [backend/DEPLOYMENT_ES.md](./backend/DEPLOYMENT_ES.md)
- **Integración**: [INTEGRATION_CHECKLIST.md](./INTEGRATION_CHECKLIST.md)

---

## ✅ Lista de Verificación de Verificación

- [ ] Backend se ejecuta sin errores
- [ ] Puede iniciar sesión en http://localhost:8000/admin/
- [ ] Puede obtener token de /api/token/
- [ ] Puede listar empleados, proyectos, asignaciones
- [ ] Sin errores rojos en la terminal

---

## 🆘 Solución de Problemas

### "Puerto 8000 ya está en uso"
```bash
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# macOS/Linux
lsof -i :8000
kill -9 <PID>
```

### "Base de datos no encontrada"
```bash
cd backend
python manage.py migrate
python manage.py load_initial_data
```

### "Token no funciona"
- Verificar que el token esté en el encabezado de Autorización
- Formato: `Authorization: Bearer <TOKEN>`
- No: `Authorization: Token <TOKEN>`

### "Error de CORS"
Verificar que el backend esté en ejecución y que la URL de la API sea correcta en la configuración del frontend.

---

**Estado**: ✅ Listo para Producción
**Versión**: 1.0.0
**Listo**: Sí, ¡comienza ahora! 🚀

👉 **Próxima acción**: `cd backend && run_local.bat`
