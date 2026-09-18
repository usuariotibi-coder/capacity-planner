# Guía de Utilización - Horas Usadas del Proyecto

## 📋 ¿Qué es "Horas Usadas del Proyecto"?

Es una característica que te permite:
1. **Asignar horas presupuestadas** a cada departamento por proyecto
2. **Calcular automáticamente** el porcentaje de utilización (horas usadas / horas asignadas)
3. **Visualizar** con código de colores si el departamento está sobre/bajo utilizado

---

## 🎯 Cómo Usar

### Paso 1: Crear/Editar un Proyecto

1. Ve a la página **"Proyectos (ADD NEW JOB)"**
2. Haz click en **"ADD NEW JOB"** o edita un proyecto existente
3. Completa los campos:
   - Nombre del proyecto
   - Cliente/Descripción
   - Fecha de inicio
   - Número de semanas
   - Facility

### Paso 2: Configurar "Horas Usadas del Proyecto" en las Pantallas de Departamentos

Una vez creado el proyecto, debes ir a **cada pantalla de departamento** para configurar el presupuesto de horas:

1. Selecciona un departamento (ej: **MED**, **HD**, **PRG**, etc.)
2. Busca el proyecto en la lista
3. Verás la sección **"💼 Horas Usadas del Departamento"**
4. Haz click en **"➕ Agregar Presupuesto"** (si no hay presupuesto asignado)
5. Ingresa las horas presupuestadas para ese departamento
6. Guarda los cambios

Repite este proceso para cada departamento que trabaje en el proyecto.

**Ejemplo de presupuesto por departamento:**
```
Proyecto: "Modernización Sistema"

En pantalla MED:    160h  (Diseño mecánico)
En pantalla HD:     200h  (Diseño de hardware)
En pantalla BUILD:  240h  (Ensamble)
En pantalla PRG:    180h  (Programación)
```

### Paso 3: Asignar Horas Reales en la Matriz de Capacidad

Una vez creado el proyecto, ve a:

#### **Opción A: Vista General**
1. Página → General
2. Expande el proyecto (click en el chevron)
3. Verás el **resumen de horas + la tabla de capacidad** juntos
4. Click en una celda vacía para asignar horas

#### **Opción B: Pantallas de Departamentos**
1. Página → Selecciona departamento (MED, HD, PRG, etc.)
2. Busca el proyecto
3. Verás el **resumen solo de ese departamento**
4. Click en una celda vacía para asignar horas

**Proceso de asignación** (igual en ambas opciones):
1. Click en una celda vacía → Se abre modal de edición
2. Ingresa las horas a asignar
3. Selecciona la etapa (si aplica)
4. Selecciona los recursos (empleados de ese departamento)
5. Haz click en "✓ Guardar"

**Resultado automático:**
- Las horas se asignan a los empleados seleccionados
- El resumen se actualiza automáticamente
- El porcentaje (%) se recalcula en tiempo real

---

## 📊 Interpretando los Resultados

### En la Vista General
Cuando **expandes un proyecto** (ves la tabla), verás:

1. **Resumen de Horas** (aparece arriba de la tabla):
```
💼 Horas Usadas del Proyecto
┌─────────────────────────────────────────┐
│ ⚙️ MED    │  80h / 160h   │  50%  🟢    │
│ ⚡ HD     │  150h / 200h  │  75%  🟡    │
│ 🔧 BUILD  │  240h / 240h  │ 100%  🟠    │
│ 💻 PRG    │  200h / 180h  │ 111%  🔴    │
└─────────────────────────────────────────┘
```

2. **Tabla de Capacidad** (debajo del resumen):
   - Todas las semanas del proyecto
   - Todos los departamentos configurados
   - Horas asignadas por semana
   - Etapas y recursos asociados

**Nota:** El resumen solo muestra los departamentos que están configurados en el proyecto (tienen etapas asignadas).

Cuando **cierras el proyecto** (colapsas la tabla):
- Se ocultará **tanto el resumen como la tabla**
- Solo verás el nombre del proyecto y cliente
- Al volver a expandir, todo reaparece

### En las Pantallas de Departamentos
Cuando seleccionas un departamento específico (ej: HD), verás:

```
💼 Horas Usadas del Departamento
⚡ Hardware Design
150h / 200h         75%
```

Solo se muestra el departamento que estás viendo.

---

## 🎨 Código de Colores de Utilización

| Color | Rango | Significado |
|-------|-------|------------|
| 🟢 Verde | 0-50% | Subutilizado - hay capacidad disponible |
| 🟡 Amarillo | 50-75% | Utilización moderada - equilibrio bueno |
| 🟠 Naranja | 75-100% | Altamente utilizado - capacidad limitada |
| 🔴 Rojo | 100%+ | Sobre utilizado - excede la capacidad |

---

## 💡 Ejemplos Prácticos

### Escenario 1: Departamento con Baja Utilización
```
Proyecto: Modernización Sistema
HD: 100h asignadas, 30h usadas → 30% 🟢
```
**Interpretación:** El departamento HD tiene mucha capacidad disponible.
Puedes asignar más trabajo a este equipo.

### Escenario 2: Departamento Equilibrado
```
Proyecto: Nuevo Producto
PRG: 80h asignadas, 65h usadas → 81% 🟠
```
**Interpretación:** El equipo de programación está casi al tope.
Cuidado con asignar más trabajo sin revisar disponibilidad.

### Escenario 3: Departamento Sobre Utilizado
```
Proyecto: Cliente Urgente
MED: 120h asignadas, 150h usadas → 125% 🔴
```
**Interpretación:** ¡El departamento está excedido!
Necesitas reasignar trabajo o extender el plazo.

---

## 🔄 Flujo Completo: Paso a Paso

### 1. **Crear Proyecto**
```
Página: Proyectos
Botón: "ADD NEW JOB"
Llenar:
  - Nombre, Cliente, Fechas
  - Configuración por Departamento (fechas de inicio y duración)
Guardar proyecto
```

### 2. **Configurar Presupuesto de Horas por Departamento**
```
Para CADA departamento que trabaje en el proyecto:
  1. Selecciona la Página → Departamento (ej: MED, HD, PRG, etc.)
  2. Encuentra el proyecto en la lista
  3. Click en "➕ Agregar Presupuesto" (en sección "💼 Horas Usadas del Departamento")
  4. Ingresa las horas presupuestadas
  5. Click "Guardar"
  6. Si necesitas editar, haz click en "✏️ Editar"
```

### 3. **Asignar Horas Reales en la Matriz**
```
En Vista General (expandido) o en Departamentos:
  - Click en celda vacía
  - Modal aparece con:
    • Campo de horas
    • Dropdown de etapa
    • Lista de empleados (checkboxes)
  - Ingresa datos y click en "✓ Guardar"

Resultado:
  - Se crean/actualizan asignaciones
  - El resumen se actualiza automáticamente
  - El % de utilización cambia
```

### 4. **Monitorear Utilización**

**En Vista General:**
```
- Expande proyecto → Ves resumen + tabla juntos
- Resumen muestra solo departamentos configurados
- Cada celda con horas muestra el % en un badge coloreado
```

**En Pantallas de Departamentos:**
```
- Selecciona departamento (ej: HD)
- Ves resumen SOLO de ese departamento
- Las horas usadas suman solo las de ese dpto
- La tabla muestra solo ese departamento
- Haz click en "✏️ Editar" para cambiar el presupuesto de horas
```

### 5. **Cerrar Proyecto**
```
En Vista General:
  - Click en chevron (▲) para colapsar
  - Se oculta TANTO el resumen como la tabla
  - Solo ves nombre, cliente y semanas

Expande de nuevo:
  - Todo reaparece con datos actualizados
```

---

## ⚠️ Notas Importantes

### Cálculo de Horas
- **Horas "Usadas"** = Suma de TODAS las asignaciones del departamento en ese proyecto
  - Se calcula automáticamente de todas las semanas
  - Se actualiza cuando asignas/editas horas

- **Horas "Asignadas"** = Lo que tú estableces en el formulario del proyecto
  - Es el presupuesto estimado
  - Puede cambiar editando el proyecto

- **Porcentaje** = (Usadas / Asignadas) × 100%
  - Ejemplo: 80h usadas / 160h asignadas = 50%

### Dónde se Suman las Horas
- **En Vista General**: Se suman TODAS las horas de todos los departamentos
- **En Pantallas de Departamentos**: Se suman SOLO las horas de ese departamento
  - Si seleccionas HD, solo suma horas del departamento HD
  - Las de MED, MFG, etc. no aparecen

### Comportamiento Especial
- **No hay límite**: Puedes exceder el 100% (el color se pone rojo 🔴)
- **Actualización en tiempo real**: Al asignar/editar horas, el % se recalcula automáticamente
- **Datos temporales**: Los cambios se pierden al refrescar la página (Frontend only)
- **Múltiples departamentos**: Cada departamento tiene su propio cálculo independiente

---

## 🎓 Tips para Usar Efectivamente

1. **Comienza estimando** horas conservadoramente
2. **Revisa regularmente** los porcentajes de utilización
3. **Si ves 🔴 Rojo**: Considera reasignar trabajo a otros proyectos
4. **Si ves 🟢 Verde**: Busca nuevos proyectos para ese departamento
5. **Si ves 🟡 Amarillo**: Está en el punto ideal (50-75%)

---

## 📱 Dónde Aparecen los Porcentajes

### 1. **En el Resumen de Horas (Sección "💼 Horas Usadas del Proyecto")**

**Vista General:**
- Aparece ENCIMA de la tabla cuando expandes un proyecto
- Muestra un card por cada departamento configurado
- Cada card tiene: Icono, Nombre, Horas (usadas/asignadas), % con color

**Pantallas de Departamentos:**
- Aparece debajo del nombre del proyecto
- Muestra SOLO el departamento seleccionado
- Formato horizontal para mejor legibilidad
- Icono + Nombre + Horas + % con color

### 2. **En las Células Individuales (matriz de horas por semana)**
- Cada celda con horas muestra:
  - Número de horas (ej: "45h")
  - Talent en decimales (ej: "1.0")
  - **Pequeño badge debajo con el % de utilización del proyecto/departamento**
  - Color del badge según el % (🟢 Verde, 🟡 Amarillo, 🟠 Naranja, 🔴 Rojo)
  - Etapa abreviada (si tiene)

### 3. **Visibilidad por Vista**

| Ubicación | Cuándo Aparece | Qué Muestra |
|-----------|---|---|
| **Vista General** | Proyecto expandido | Resumen + Tabla |
| **Departamentos** | Siempre | Resumen + Tabla |
| **Células de horas** | Cuando hay asignaciones | % de utilización general |

---

**Última actualización:** Diciembre 2025
**Versión:** 1.0.0
