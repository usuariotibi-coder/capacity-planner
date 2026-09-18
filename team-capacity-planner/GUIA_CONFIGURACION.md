# Team Capacity Planner - Guía de Configuración

## ℹ️ NOTA IMPORTANTE

**Este proyecto es una aplicación web Frontend en React, NO es un proyecto Python.**

- ❌ **NO** necesita `requirements.txt`
- ✅ **USA** `package.json` para gestionar dependencias
- ✅ **USA** npm (Node Package Manager) en lugar de pip

---

## 📋 Requisitos Previos

### Instalación de Node.js
1. Descargar desde https://nodejs.org/ (versión LTS v20+ recomendada)
2. Instalar con todas las opciones por defecto
3. Verificar instalación:
   ```bash
   node --version    # Debe mostrar v20.x.x o superior
   npm --version     # Debe mostrar 10.x.x o superior
   ```

---

## 🚀 Pasos para Iniciar

### 1. Abrir Terminal/CMD en la carpeta del proyecto
```bash
cd "c:\Users\usuar\OneDrive - CEC Controls\Escritorio\Capacity\team-capacity-planner"
```

### 2. Instalar todas las dependencias
```bash
npm install
```
Esto descargará aproximadamente 500+ paquetes a la carpeta `node_modules/`

### 3. Iniciar servidor de desarrollo
```bash
npm run dev
```

**Resultado esperado:**
```
  VITE v7.2.4  ready in 245 ms

  ➜  Local:   http://localhost:5173/
  ➜  press h to show help
```

### 4. Abrir en navegador
- Ve a http://localhost:5173
- ¡La aplicación está lista para usar!

---

## 📦 Estructura de Dependencias

### Librerías Principales (Producción)
```
react 19.2.0          → Framework UI
react-dom 19.2.0      → Renderizado
zustand 5.0.9         → Gestión de estado
tailwindcss 3.4.19    → Estilos CSS
lucide-react 0.562.0  → Iconos
date-fns 4.1.0        → Utilidades de fechas
```

### Herramientas de Desarrollo
```
typescript 5.9.3      → Type checking
vite 7.2.4            → Build tool
eslint 9.39.1         → Linting de código
```

Ver `DEPENDENCIES.md` para lista completa.

---

## 💻 Comandos Principales

```bash
# Iniciar en desarrollo (http://localhost:5173)
npm run dev

# Compilar para producción
npm run build

# Ver la compilación de producción
npm run preview

# Revisar calidad de código
npm run lint

# Listar todas las dependencias
npm list

# Actualizar todas las dependencias
npm update

# Ver qué está desactualizado
npm outdated
```

---

## 🗂️ Qué son estos archivos?

| Archivo | Propósito |
|---------|-----------|
| `package.json` | 📋 Lista de dependencias y scripts |
| `package-lock.json` | 🔒 Versiones exactas instaladas |
| `node_modules/` | 📦 Carpeta con todas las librerías (NO editar) |
| `src/` | 💻 Código fuente del proyecto |
| `dist/` | 🏢 Compilación para producción (se genera con build) |
| `vite.config.ts` | ⚙️ Configuración de Vite |
| `tsconfig.json` | 📝 Configuración de TypeScript |
| `tailwind.config.js` | 🎨 Configuración de Tailwind CSS |

---

## 🛑 Solucionar Problemas

### Problema: "npm command not found"
**Solución**: Node.js no está instalado o no está en PATH
```bash
# Verificar instalación
node -v
npm -v

# Si no funciona, reinstalar Node.js desde https://nodejs.org/
```

### Problema: Puerto 5173 ya está en uso
**Solución**: Usar otro puerto
```bash
npm run dev -- --port 3000
```

### Problema: Errores al instalar
**Solución**: Limpiar cache de npm
```bash
npm cache clean --force
rm -rf node_modules
rm package-lock.json
npm install
```

### Problema: TypeScript errors durante build
**Solución**: Verificar tipos
```bash
npx tsc --noEmit
```

### Problema: Cambios no se ven en desarrollo
**Solución**: Limpiar cache del navegador (Ctrl+Shift+Cansar)

---

## 📚 Archivos de Documentación

Estos archivos explican cómo funciona el sistema:

1. **SYSTEM_DOCUMENTATION.md** - 📖 Documentación completa del sistema
   - Arquitectura
   - Modelo de datos
   - Descripción de módulos
   - Guía de desarrollo

2. **DEPENDENCIES.md** - 📦 Información sobre dependencias
   - Qué es cada paquete
   - Cómo se instala
   - Solución de problemas

3. **README.md** - 📄 Descripción general del proyecto
   - Características
   - Quick start
   - Estructura de carpetas

4. **GUIA_CONFIGURACION.md** - 📋 Este archivo
   - Pasos de instalación
   - Comandos principales
   - Solución de problemas

---

## 🎯 Próximos Pasos

Después de instalar:

1. ✅ Ejecutar `npm install`
2. ✅ Ejecutar `npm run dev`
3. ✅ Abrir http://localhost:5173
4. ✅ Ver la aplicación funcionando
5. ✅ Hacer cambios en código (se actualizan automáticamente)
6. ✅ Leer SYSTEM_DOCUMENTATION.md para entender la arquitectura

---

## 🎓 Aprender la Arquitectura

```
1. Leer este archivo (GUIA_CONFIGURACION.md)
           ↓
2. Leer SYSTEM_DOCUMENTATION.md
           ↓
3. Explorar carpeta src/
           ↓
4. Leer código comentado
           ↓
5. Hacer cambios y experimentar
```

---

## 📞 Referencia Rápida

### Iniciar desarrollo
```bash
npm run dev
```
→ Acceder a http://localhost:5173

### Compilar para producción
```bash
npm run build
```
→ Archivos en carpeta `dist/`

### Revisar errores
```bash
npm run lint
```
→ Muestra problemas de código

### Ver que está desactualizado
```bash
npm outdated
```

---

## ✨ Características de Desarrollo

- **Hot Reload**: Los cambios se ven inmediatamente sin recargar
- **Type Checking**: TypeScript detecta errores antes de ejecutar
- **ESLint**: Revisa calidad de código automáticamente
- **Tailwind CSS**: Estilos con clases utility
- **State Management**: Zustand para gestión de estado simple

---

## 🔍 Verificar Instalación Correcta

Después de `npm install`, deberías tener:

```
node_modules/                    ✅ 500+ paquetes
package-lock.json               ✅ Archivo de lock
src/                            ✅ Código fuente
dist/                           ❌ Se crea con build
```

Si algo falta, ejecutar `npm install` nuevamente.

---

## 📱 Acceder desde Otros Dispositivos

Si quieres acceder desde otro dispositivo en la misma red:

```bash
npm run dev
# Nota la línea que dice "Local: http://localhost:5173"
# Reemplaza localhost con tu IP local, por ejemplo:
# http://192.168.1.100:5173
```

---

## 🌐 Desplegar a Producción

### Paso 1: Compilar
```bash
npm run build
```

### Paso 2: Probar localmente
```bash
npm run preview
```

### Paso 3: Desplegar carpeta `dist/`
- Subir carpeta `dist/` a hosting estático
- Opciones: Vercel, Netlify, GitHub Pages, etc.

---

## 🆘 ¿No funciona?

1. Verificar Node.js instalado: `node -v`
2. Verificar en carpeta correcta: `ls package.json`
3. Instalar de nuevo: `npm install`
4. Limpiar cache: `npm cache clean --force`
5. Ver `DEPENDENCIES.md` para más soluciones

---

## 📝 Notas Importantes

- **NO editar** la carpeta `node_modules/` - se regenera con `npm install`
- **NO eliminar** `package-lock.json` - asegura versiones consistentes
- **SÍ editar** archivos en `src/`
- **SÍ** hacer git commit de cambios en `src/` y documentación
- **NO** hacer git commit de `node_modules/` o `dist/`

---

## 🎯 Verificación Final

Ejecutar esto para asegurar todo está bien:

```bash
# Compilar sin errores
npm run build

# Debería mostrar:
# ✓ built in 9.04s
```

Si ves ese mensaje, ¡todo está funcionando correctamente!

---

**Última actualización**: Diciembre 2025
**Versión**: 1.0.0
