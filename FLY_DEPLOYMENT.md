# Despliegue en Fly.io - Guía Completa

## Pasos para Desplegar en Fly.io

### 1. Crear Cuenta en Fly.io
- Ir a https://fly.io
- Crear cuenta (gratuita)
- Verificar email

### 2. Instalar CLI de Fly.io

**En Windows:**
```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

**Luego verificar instalación:**
```bash
flyctl version
```

### 3. Hacer Login en Fly.io
```bash
flyctl auth login
```
- Se abrirá navegador web
- Sigue las instrucciones para autenticar

### 4. Crear Aplicación en Fly.io
```bash
cd backend
flyctl launch
```

Responde las preguntas:
- App name: `capacity-planner` (o tu nombre preferido)
- Region: `mia` (Miami - mejor latencia para México)
- Database: No (usaremos SQLite por ahora)
- Deploy now: No (lo haremos después de configurar)

### 5. Configurar Variables de Entorno en Fly.io
```bash
flyctl secrets set SECRET_KEY="tu-clave-secreta-super-larga-aqui"
flyctl secrets set DEBUG=False
flyctl secrets set ALLOWED_HOSTS="tu-app.fly.dev,localhost"
flyctl secrets set DB_ENGINE="django.db.backends.sqlite3"
flyctl secrets set DB_NAME="db.sqlite3"
flyctl secrets set CORS_ALLOWED_ORIGINS="https://tu-frontend.com,http://localhost:5173"
```

**Nota:** Reemplaza `tu-app.fly.dev` con el nombre que Fly.io te dé

### 6. Desplegar en Fly.io
```bash
flyctl deploy
```

El despliegue tomará 2-5 minutos. Verás algo como:
```
--> Pushing image done
==> Release v1 created
--> You can detach the log stream now. Press Ctrl+C
--> Monitoring Deployment
  [✓] Verified Machines are healthy
```

### 7. Ver Logs en Vivo
```bash
flyctl logs
```

### 8. Acceder a tu Aplicación
Fly.io te dará una URL como: `https://capacity-planner-abc123.fly.dev`

Prueba:
```bash
curl https://capacity-planner-abc123.fly.dev/
```

### 9. Reiniciar o Redeplegar
Si necesitas actualizar código:
```bash
git add .
git commit -m "Cambios"
git push
flyctl deploy
```

## Solucionar Problemas

### Problema: "Command not found: flyctl"
**Solución:** Reinicia PowerShell o terminal después de instalar

### Problema: "No machines running"
**Solución:**
```bash
flyctl machines ls
flyctl machines start [machine-id]
```

### Problema: "500 Internal Server Error"
**Solución:** Ver logs:
```bash
flyctl logs
```

### Problema: "404 Not Found" en todas las rutas
**Solución:** Verifica ALLOWED_HOSTS:
```bash
flyctl secrets list
# Debería mostrar la URL de tu app
```

## Comandos Útiles

```bash
# Ver estado de la app
flyctl status

# Ver máquinas
flyctl machines ls

# Ver variables secretas
flyctl secrets list

# Actualizar una variable secreta
flyctl secrets set VARIABLE=nuevo-valor

# Remover variable secreta
flyctl secrets unset VARIABLE

# Ver información de la app
flyctl info

# Conectarse a la máquina via SSH
flyctl ssh console

# Ver estadísticas
flyctl status
```

## Tier Gratuito de Fly.io

- **3 máquinas compartidas** (shared-cpu-1x con 256MB RAM)
- **3GB almacenamiento persistente**
- **160GB transferencia de datos** al mes
- **Suficiente para desarrollo y pruebas**

## Notas Importantes

1. **Base de datos:** SQLite es suficiente para desarrollo. Para producción con múltiples usuarios, considera PostgreSQL en Fly.io (tier gratuito disponible)

2. **Archivos estáticos:** El Dockerfile incluye `collectstatic`, por lo que CSS/JS se sirven correctamente

3. **Migraciones:** El `entrypoint.sh` corre automáticamente las migraciones en cada despliegue

4. **Datos iniciales:** Se cargan automáticamente via `load_initial_data`

## Próximos Pasos

Una vez desplegado:
1. Accede a `/api/` para ver endpoints disponibles
2. Accede a `/admin/` con usuario `admin` / contraseña `admin`
3. Crea tu frontend y configura `CORS_ALLOWED_ORIGINS`

¡Listo! Tu backend estará en producción en Fly.io 🚀
