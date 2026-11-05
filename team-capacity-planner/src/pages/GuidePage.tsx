import { useLanguage } from '../context/LanguageContext';
import { BookOpen, Briefcase, Grid3x3, FileText, Shield, Key, Eye, Edit3, UserCheck, Lock, DollarSign, FileSpreadsheet } from 'lucide-react';

type RoleCard = {
  title: string;
  titleEn: string;
  departments: string;
  access: 'full' | 'department' | 'readonly' | 'head' | 'bi';
  canEdit: string;
  canEditEn: string;
  canView: string;
  canViewEn: string;
  restrictions: string;
  restrictionsEn: string;
};

const ROLES: RoleCard[] = [
  {
    title: 'Superusuario / Staff',
    titleEn: 'Superuser / Staff',
    departments: '-',
    access: 'full',
    canEdit: 'Todo (empleados, proyectos, asignaciones, presupuestos, capacidades de equipo, change orders, usuarios registrados)',
    canEditEn: 'Everything (employees, projects, assignments, budgets, team capacities, change orders, registered users)',
    canView: 'Todo (incluye proyectos ocultos y registros de actividad de todos los usuarios)',
    canViewEn: 'Everything (includes hidden projects and all users activity logs)',
    restrictions: 'Ninguna',
    restrictionsEn: 'None',
  },
  {
    title: 'PM (Project Manager)',
    titleEn: 'PM (Project Manager)',
    departments: 'PM',
    access: 'full',
    canEdit: 'Todo - acceso completo a todos los departamentos',
    canEditEn: 'Everything - full access to all departments',
    canView: 'Todo (no incluye usuarios registrados)',
    canViewEn: 'Everything (excludes registered users)',
    restrictions: 'No puede gestionar usuarios registrados (solo BI). No ve la pestaña "Usuarios Registrados".',
    restrictionsEn: 'Cannot manage registered users (BI only). Does not see "Registered Users" tab.',
  },
  {
    title: 'Departamento (MED, HD, PRG)',
    titleEn: 'Department (MED, HD, PRG)',
    departments: 'MED, HD, PRG',
    access: 'department',
    canEdit: 'Solo empleados, asignaciones y change orders de su propio departamento. Puede editar stages y presupuestos de proyectos que involucren su departamento.',
    canEditEn: 'Only employees, assignments, and change orders in their own department. Can edit stages and budgets of projects involving their department.',
    canView: 'Todo (excepto usuarios registrados)',
    canViewEn: 'Everything (except registered users)',
    restrictions: 'No puede modificar campos compartidos de proyectos (nombre, cliente, fechas, facility), ni datos de otros departamentos.',
    restrictionsEn: 'Cannot modify shared project fields (name, client, dates, facility) or other departments data.',
  },
  {
    title: 'BUILD / MFG (Edición cruzada)',
    titleEn: 'BUILD / MFG (Cross-editing)',
    departments: 'BUILD, MFG',
    access: 'department',
    canEdit: 'Su propio departamento y el otro (BUILD puede editar MFG y viceversa). Solo empleados, asignaciones y change orders.',
    canEditEn: 'Own department and the other (BUILD can edit MFG and vice versa). Only employees, assignments, and change orders.',
    canView: 'Todo (excepto usuarios registrados)',
    canViewEn: 'Everything (except registered users)',
    restrictions: 'No pueden modificar campos compartidos de proyectos ni otros departamentos.',
    restrictionsEn: 'Cannot modify shared project fields or other departments.',
  },
  {
    title: 'Head Engineering (OTHER)',
    titleEn: 'Head Engineering (OTHER)',
    departments: 'MED, HD',
    access: 'head',
    canEdit: 'Departamentos MED y HD únicamente. Puede crear empleados en estos departamentos.',
    canEditEn: 'MED and HD departments only. Can create employees in these departments.',
    canView: 'Todo (excepto usuarios registrados)',
    canViewEn: 'Everything (except registered users)',
    restrictions: 'No puede modificar otros departamentos ni campos compartidos de proyectos.',
    restrictionsEn: 'Cannot modify other departments or shared project fields.',
  },
  {
    title: 'Business Intelligence (OTHER)',
    titleEn: 'Business Intelligence (OTHER)',
    departments: 'OTHER + BI',
    access: 'bi',
    canEdit: 'Acceso completo (igual que PM). Además puede gestionar usuarios registrados (crear, editar, eliminar, resetear contraseñas).',
    canEditEn: 'Full access (same as PM). Additionally can manage registered users (create, edit, delete, reset passwords).',
    canView: 'Todo, incluyendo la pestaña "Usuarios Registrados" y logs de actividad de todos.',
    canViewEn: 'Everything, including "Registered Users" tab and all users activity logs.',
    restrictions: 'Ninguna adicional.',
    restrictionsEn: 'None additional.',
  },
  {
    title: 'Otros (OPERATIONS, FINANCE, HR)',
    titleEn: 'Others (OPERATIONS, FINANCE, HR)',
    departments: 'OTHER (sin BI ni HE)',
    access: 'readonly',
    canEdit: 'Nada. Acceso de solo lectura.',
    canEditEn: 'Nothing. Read-only access.',
    canView: 'Todo (excepto usuarios registrados)',
    canViewEn: 'Everything (except registered users)',
    restrictions: 'No pueden crear, editar ni eliminar ningún recurso. Solo pueden visualizar.',
    restrictionsEn: 'Cannot create, edit, or delete any resource. View only.',
  },
];

type WindowCard = {
  title: string;
  titleEn: string;
  icon: React.ReactNode;
  description: string;
  descriptionEn: string;
  features: string[];
  featuresEn: string[];
};

const WINDOWS: WindowCard[] = [
  {
    title: 'Matriz de Capacidad',
    titleEn: 'Capacity Matrix',
    icon: <Grid3x3 size={18} />,
    description: 'Vista principal de planificación. Muestra una matriz de empleados (filas) vs semanas (columnas) donde cada celda contiene las horas asignadas a proyectos, coloreadas según la etapa del proyecto.',
    descriptionEn: 'Main planning view. Displays a matrix of employees (rows) vs weeks (columns) where each cell contains hours assigned to projects, colored by project stage.',
    features: [
      'Filtro por departamento en el panel lateral (General o departamento específico)',
      'Filtro por proyecto en la barra superior ("Filtrar proyectos")',
      'Zoom in/out con los botones +/-',
      'Click en una celda para editar/agregar horas de asignación',
      'Arrastrar celdas para copiar horas entre semanas (si el proyecto tiene etapas configuradas)',
      'En departamentos con etapas (HD, MED, BUILD, PRG): varias fases distintas en la misma celda/semana con el botón "+ Agregar" dentro del modal de edición, cada una con su propio reparto de horas',
      'Dividir la actividad de una fase en varias semanas consecutivas, con reparto equitativo o manual por semana (y por persona, si hay 2 o más seleccionadas)',
      'Botón "Mover semanas" (dentro del modal de edición): mueve o combina las horas de una o varias semanas hacia una semana destino; permite fusionar o sobrescribir si el destino ya tiene datos',
      'Botones "+ / − Personal" y "+ / − Personal Externo" en el panel del departamento: registran altas y bajas de personal interno (SCIO) y de proveedores externos/subcontratados a partir de una fecha (recalculan la capacidad semanal automáticamente)',
      'Botón "$ Rates": define la tarifa por hora de cada proveedor externo/subcontratado, por fase/actividad, con historial de cambios (la fecha de vigencia puede ser retroactiva)',
      'El resumen Qtd/Used/Fcst de cada proyecto muestra también el costo en $ estimado: horas internas a la tarifa general del departamento, horas de cada proveedor externo a su propia tarifa por fase',
      'Panel Global: resumen de capacidad por departamento con colores de utilización',
      'Exportación a Excel y PDF',
      'Vista móvil adaptada para pantallas pequeñas',
      'Edición inline de horas: clic en el número para editar directamente',
      'Indicadores visuales de etapas por color de fondo',
      'Soporte para SCIO hours vs External hours (BUILD y PRG)',
      'Leyenda interactiva de colores por etapa y utilización',
    ],
    featuresEn: [
      'Department filter in sidebar (General or specific department)',
      'Project filter in top bar ("Filter projects")',
      'Zoom in/out with +/- buttons',
      'Click a cell to edit/add assignment hours',
      'Drag cells to copy hours between weeks (if project has stages configured)',
      'Departments with stages (HD, MED, BUILD, PRG): multiple distinct stages in the same cell/week via the "+ Add" button inside the edit modal, each with its own hour breakdown',
      'Split one stage\'s activity across several consecutive weeks, evenly or manually per week (and per person, once 2 or more are selected)',
      '"Move weeks" button (inside the edit modal): moves or combines one or more weeks\' hours into a destination week; supports merging or overwriting when the destination already has data',
      '"+ / − Staff" and "+ / − External Staff" buttons in the department panel: log hires/departures for internal (SCIO) staff and external/subcontracted providers effective from a date (weekly capacity recalculates automatically)',
      '"$ Rates" button: sets each external/subcontracted provider\'s hourly rate, per stage/activity, with a change history (the effective date can be backdated)',
      'Each project\'s Qtd/Used/Fcst summary also shows an estimated $ cost: internal hours at the department\'s flat rate, each external provider\'s hours at their own per-stage rate',
      'Global Panel: department capacity summary with utilization colors',
      'Export to Excel and PDF',
      'Mobile view adapted for small screens',
      'Inline hour editing: click the number to edit directly',
      'Visual stage indicators by background color',
      'Support for SCIO hours vs External hours (BUILD and PRG)',
      'Interactive color legend for stages and utilization',
    ],
  },
  {
    title: 'Proyectos',
    titleEn: 'Projects',
    icon: <Briefcase size={18} />,
    description: 'Gestión completa del ciclo de vida de proyectos. Permite crear, editar, importar y eliminar proyectos, configurar presupuestos por departamento, etapas, Change Orders, y visualizar métricas de utilización.',
    descriptionEn: 'Complete project lifecycle management. Allows creating, editing, importing and deleting projects, configuring department budgets, stages, Change Orders, and viewing utilization metrics.',
    features: [
      'Crear proyecto nuevo: nombre, cliente, fechas inicio/fin, facility, project manager',
      'Configurar presupuesto de horas por departamento (horas cotizadas) y el monto cotizado en $',
      'Configurar etapas (stages) por departamento con fechas de inicio y duración',
      'Marcar proyecto como "alta probabilidad" para priorización visual',
      'Importar proyecto existente (hereda configuración de stages y presupuesto)',
      'Editar proyecto: modificar datos, stages, presupuestos',
      'Cerrar/reabrir proyecto (solo cambia su estado; sigue visible y conserva su historial)',
      'Eliminar proyecto (soft-delete: se oculta pero conserva datos históricos)',
      'Botón "CO" en la columna de Acciones: registra un Change Order de dos formas — (1) "Ampliar presupuesto": agrega horas y $ a uno o más departamentos del proyecto ya existente, identificado por un nombre (p. ej. CO01), editable después; (2) "Registrar como proyecto nuevo": crea un proyecto completo (fechas, horas, $) vinculado al original, mostrado en la tabla con la etiqueta "CO de [proyecto]"',
      'Asignar Project Manager desde lista de empleados',
      'Filtro de visibilidad: elegir en qué departamentos se muestra el proyecto (General o específicos)',
      'Filtro de búsqueda por nombre, cliente o PM',
      'Indicadores de presupuesto: horas cotizadas vs utilizadas vs forecast',
      'Métrica de utilización por departamento (%)',
    ],
    featuresEn: [
      'Create new project: name, client, start/end dates, facility, project manager',
      'Configure department hour budget (quoted hours) and the quoted $ amount',
      'Configure department stages with start dates and duration',
      'Mark project as "high probability" for visual prioritization',
      'Import existing project (inherits stage and budget configuration)',
      'Edit project: modify data, stages, budgets',
      'Close/reopen a project (only changes its status; it stays visible and keeps its history)',
      'Delete project (soft-delete: hidden but preserves historical data)',
      '"CO" button in the Actions column: registers a Change Order two ways — (1) "Expand budget": adds hours and $ to one or more departments of the existing project, identified by a name (e.g. CO01), editable later; (2) "Register as a new project": creates a full project (dates, hours, $) linked back to the original, shown in the table with a "CO of [project]" tag',
      'Assign Project Manager from employee list',
      'Visibility filter: choose which departments see the project (General or specific)',
      'Search filter by name, client or PM',
      'Budget indicators: quoted vs utilized vs forecast hours',
      'Department utilization metrics (%)',
    ],
  },
  {
    title: 'Registro de Actividad',
    titleEn: 'Activity Log',
    icon: <FileText size={18} />,
    description: 'Registro de auditoría completo que rastrea todas las operaciones realizadas en el sistema (creación, actualización, eliminación de empleados, proyectos, asignaciones, etc.).',
    descriptionEn: 'Complete audit log tracking all operations performed in the system (creation, update, deletion of employees, projects, assignments, etc.).',
    features: [
      'Lista cronológica de todas las acciones registradas',
      'Filtro por tipo de acción (created, updated, deleted, viewed)',
      'Filtro por modelo afectado (Employee, Project, Assignment, etc.)',
      'Filtro por rango de fechas',
      'Filtro por usuario que realizó la acción',
      'Detalle de cambios: muestra el antes y después de cada modificación',
      'Paginación para grandes volúmenes de datos',
    ],
    featuresEn: [
      'Chronological list of all recorded actions',
      'Filter by action type (created, updated, deleted, viewed)',
      'Filter by affected model (Employee, Project, Assignment, etc.)',
      'Filter by date range',
      'Filter by user who performed the action',
      'Change details: shows before and after for each modification',
      'Pagination for large data volumes',
    ],
  },
  {
    title: 'Usuarios Registrados',
    titleEn: 'Registered Users',
    icon: <UserCheck size={18} />,
    description: 'Panel exclusivo para usuarios de Business Intelligence. Permite gestionar todos los usuarios registrados en el sistema.',
    descriptionEn: 'Exclusive panel for Business Intelligence users. Allows managing all registered users in the system.',
    features: [
      'Lista de todos los usuarios con email, nombre, departamento, estado y última sesión',
      'Crear nuevo usuario (asignando departamento y sub-departamento)',
      'Editar usuario: nombre, departamento, estado activo/inactivo',
      'Resetear contraseña de cualquier usuario',
      'Eliminar usuario (no se puede auto-eliminar)',
      'Búsqueda por email, nombre o departamento',
      'Visible solo para usuarios con rol OTHER + BUSINESS_INTELLIGENCE',
    ],
    featuresEn: [
      'List of all users with email, name, department, status and last session',
      'Create new user (assigning department and sub-department)',
      'Edit user: name, department, active/inactive status',
      'Reset any user password',
      'Delete user (cannot self-delete)',
      'Search by email, name or department',
      'Visible only for users with OTHER + BUSINESS_INTELLIGENCE role',
    ],
  },
  {
    title: 'Costo por Hora por Departamento',
    titleEn: 'Department Hourly Cost',
    icon: <DollarSign size={18} />,
    description: 'Panel exclusivo para PM/Business Intelligence donde se define la tarifa general en $/hora de cada departamento, usada para estimar el costo de las horas internas en los resúmenes de proyecto.',
    descriptionEn: 'Exclusive panel for PM/Business Intelligence to set each department\'s flat $/hour rate, used to estimate internal hours\' cost in project summaries.',
    features: [
      'Una casilla de $/hora por departamento (PM, MED, HD, MFG, BUILD, PRG, PURCHASING)',
      'Los cambios no se guardan al escribir: quedan marcados como "sin guardar" hasta presionar "Guardar cambios"',
      'Solo se envían al servidor los departamentos realmente modificados',
      'Cada casilla muestra quién hizo el último cambio y cuándo',
      'No afecta el costo de proveedores externos/subcontratados (esos usan su propia tarifa, ver "$ Rates" en la Matriz de Capacidad)',
      'Visible solo para usuarios con acceso total (PM o Business Intelligence)',
    ],
    featuresEn: [
      'One $/hour box per department (PM, MED, HD, MFG, BUILD, PRG, PURCHASING)',
      'Changes are not saved as you type: fields are marked "unsaved" until you press "Save changes"',
      'Only the departments actually changed are sent to the server',
      'Each box shows who last changed it and when',
      'Does not affect external/subcontracted provider cost (those use their own rate, see "$ Rates" in the Capacity Matrix)',
      'Visible only to full-access users (PM or Business Intelligence)',
    ],
  },
  {
    title: 'Importación de Finanzas',
    titleEn: 'Finance Import',
    icon: <FileSpreadsheet size={18} />,
    description: 'Panel exclusivo para administradores que carga el reporte acumulado de horas reales (actuals) de Finanzas, para rellenar las semanas pasadas con datos reales en vez de pronósticos manuales.',
    descriptionEn: 'Admin-only panel that uploads Finance\'s cumulative actual-hours report, backfilling past weeks with real data instead of manual forecasts.',
    features: [
      'Selecciona un archivo .xlsx/.xls del reporte de Finanzas y lo procesa',
      'Al terminar, muestra cuántas semanas se escribieron, qué proyectos nuevos se crearon, y advertencias si las hubo',
      'Historial permanente de importaciones: fecha, archivo, quién lo subió, semanas escritas y proyectos creados',
      'Las semanas anteriores a la actual quedan bloqueadas para edición manual en la Matriz de Capacidad; solo se actualizan por esta vía',
      'Visible solo para usuarios con acceso total',
    ],
    featuresEn: [
      'Pick an .xlsx/.xls Finance report file and process it',
      'On completion, shows how many weeks were written, which new projects were created, and any warnings',
      'Permanent import history: date, file name, uploader, weeks written and projects created',
      'Weeks before the current one become locked to manual editing in the Capacity Matrix; they only update through this import',
      'Visible only to full-access users',
    ],
  },
];

const DEPARTMENT_INFO = [
  { code: 'PM', name: 'Project Manager', nameEn: 'Project Manager', desc: 'Gestión de proyectos, planificación y coordinación.', descEn: 'Project management, planning and coordination.' },
  { code: 'MED', name: 'Mechanical Design', nameEn: 'Mechanical Design', desc: 'Diseño mecánico: etapas Concept y Detail Design. Admite equipos externos y varias fases por semana.', descEn: 'Mechanical design: Concept and Detail Design stages. Supports external teams and multiple stages per week.' },
  { code: 'HD', name: 'Hardware Design', nameEn: 'Hardware Design', desc: 'Diseño de hardware: etapas Switch Layout Revision y Controls Design. Admite equipos externos y varias fases por semana.', descEn: 'Hardware design: Switch Layout Revision and Controls Design stages. Supports external teams and multiple stages per week.' },
  { code: 'MFG', name: 'Manufacturing', nameEn: 'Manufacturing', desc: 'Manufactura. Puede editar BUILD y viceversa. No tiene etapas específicas, pero sí admite equipos externos.', descEn: 'Manufacturing. Can edit BUILD and vice versa. No specific stages, but does support external teams.' },
  { code: 'BUILD', name: 'Assembly', nameEn: 'Assembly', desc: 'Ensamblaje: etapas Cabinets/Frames, Overall Assembly, Fine Tuning, Commissioning. Soporta equipos subcontratados (con tarifa propia por fase) y varias fases por semana.', descEn: 'Assembly: Cabinets/Frames, Overall Assembly, Fine Tuning, Commissioning stages. Supports subcontracted teams (with their own per-stage rate) and multiple stages per week.' },
  { code: 'PRG', name: 'Programming PLC', nameEn: 'Programming PLC', desc: 'Programación PLC: etapas Offline, Online, Debug, Commissioning. Soporta equipos externos (con tarifa propia por fase) y varias fases por semana.', descEn: 'PLC Programming: Offline, Online, Debug, Commissioning stages. Supports external teams (with their own per-stage rate) and multiple stages per week.' },
];

const OTHER_DEPARTMENTS = [
  { code: 'OPERATIONS', name: 'Operations', nameEn: 'Operations', access: 'Solo lectura', accessEn: 'Read-only' },
  { code: 'FINANCE', name: 'Finance', nameEn: 'Finance', access: 'Solo lectura', accessEn: 'Read-only' },
  { code: 'HUMAN_RESOURCES', name: 'Human Resources', nameEn: 'Human Resources', access: 'Solo lectura', accessEn: 'Read-only' },
  { code: 'BUSINESS_INTELLIGENCE', name: 'Business Intelligence', nameEn: 'Business Intelligence', access: 'Acceso completo + gestión de usuarios', accessEn: 'Full access + user management' },
  { code: 'HEAD_ENGINEERING', name: 'Head Engineering', nameEn: 'Head Engineering', access: 'Edición de MED y HD', accessEn: 'MED and HD editing' },
];

const CONCEPTS = [
  {
    title: 'Asignación (Assignment)',
    titleEn: 'Assignment',
    desc: 'Registro que vincula un empleado con un proyecto en una semana específica, indicando las horas asignadas, la etapa del trabajo y comentarios opcionales. Cada empleado solo puede tener una asignación por proyecto y semana.',
    descEn: 'Record linking an employee to a project in a specific week, indicating assigned hours, work stage and optional comments. Each employee can only have one assignment per project and week.',
  },
  {
    title: 'Presupuesto (ProjectBudget)',
    titleEn: 'Budget (ProjectBudget)',
    desc: 'Horas cotizadas por departamento para un proyecto. Sirve como referencia para medir la utilización (horas utilizadas + forecast vs horas cotizadas).',
    descEn: 'Quoted hours per department for a project. Serves as reference to measure utilization (used + forecast hours vs quoted hours).',
  },
  {
    title: 'Etapas (DepartmentStageConfig)',
    titleEn: 'Stages (DepartmentStageConfig)',
    desc: 'Configuración de etapas de trabajo por departamento dentro de un proyecto. Define en qué semana comienza y termina cada etapa (ej. Concept de semana 1 a 4). Las etapas disponibles varían por departamento.',
    descEn: 'Work stage configuration per department within a project. Defines start and end week for each stage (e.g., Concept from week 1 to 4). Available stages vary by department.',
  },
  {
    title: 'Change Order (ProjectChangeOrder)',
    titleEn: 'Change Order',
    desc: 'Se registra desde "Proyectos" (botón CO), de dos formas: ampliando el presupuesto de horas/$ de un proyecto existente (un registro con nombre, p. ej. CO01, por cada departamento que toca) o como un proyecto nuevo completo vinculado al original. Ya no se vincula a horas individuales en la Matriz de Capacidad: solo amplía el presupuesto disponible del departamento.',
    descEn: 'Registered from "Projects" (CO button), two ways: expanding an existing project\'s hours/$ budget (a named record, e.g. CO01, per department it touches) or as a brand-new project linked to the original. No longer linked to individual hours in the Capacity Matrix: it only widens the department\'s available budget.',
  },
  {
    title: 'SCIO Team Capacity',
    titleEn: 'SCIO Team Capacity',
    desc: 'Capacidad del equipo interno SCIO por departamento y semana. Incluye ajustes de PTO (vacaciones) y training que se descuentan de la capacidad disponible.',
    descEn: 'Internal SCIO team capacity per department and week. Includes PTO (vacation) and training adjustments deducted from available capacity.',
  },
  {
    title: 'Subcontracted Team Capacity (BUILD)',
    titleEn: 'Subcontracted Team Capacity (BUILD)',
    desc: 'Personal subcontratado por compañía (AMI, VICER, ITAX, MCI, MG Electrical) y semana para el departamento BUILD.',
    descEn: 'Subcontracted personnel by company (AMI, VICER, ITAX, MCI, MG Electrical) and week for the BUILD department.',
  },
  {
    title: 'Equipos Externos (MED, HD, MFG, PRG)',
    titleEn: 'External Teams (MED, HD, MFG, PRG)',
    desc: 'Personal de proveedores externos por nombre de equipo y semana, disponible en MED, HD, MFG y PRG (BUILD usa su propio sistema de subcontratados). Las altas/bajas se registran con el botón "+ / − Personal Externo" en la Matriz de Capacidad.',
    descEn: 'External provider personnel by team name and week, available in MED, HD, MFG and PRG (BUILD uses its own subcontracted-team system). Hires/departures are logged with the "+ / − External Staff" button in the Capacity Matrix.',
  },
  {
    title: 'Tarifa de Proveedor Externo (ExternalProviderRate)',
    titleEn: 'External Provider Rate',
    desc: 'Tarifa en $/hora de un proveedor externo o subcontratado, registrada por departamento y, si el departamento tiene etapas, por fase/actividad (puede ser distinta por fase). Puede cambiar con el tiempo: cada cambio queda guardado con su propia fecha de vigencia (que puede ser retroactiva), sin borrar el historial. Se administra con el botón "$ Rates" en la Matriz de Capacidad, y se usa para calcular el costo en $ de las horas externas en el resumen de proyectos.',
    descEn: 'An external/subcontracted provider\'s $/hour rate, registered per department and, when the department has stages, per stage/activity (it can differ by stage). It can change over time: each change is saved with its own effective date (which can be backdated), without erasing history. Managed with the "$ Rates" button in the Capacity Matrix, and used to compute external hours\' $ cost in project summaries.',
  },
  {
    title: 'Mover Semanas',
    titleEn: 'Move Weeks',
    desc: 'Herramienta dentro del modal de edición de celda que mueve o combina las horas registradas de una o varias semanas hacia una semana destino distinta. Permite elegir si se mueve toda la celda o solo una fase/persona específica, y si al llegar a una semana que ya tiene datos se deben sumar (fusionar) o reemplazar (sobrescribir).',
    descEn: 'A tool inside the cell edit modal that moves or combines registered hours from one or more weeks into a different destination week. Lets you choose whether to move the whole cell or just one specific stage/person, and whether landing on a week that already has data should add (merge) or replace (overwrite) it.',
  },
];

const FACILITIES = [
  { code: 'AL', name: 'Facility A', nameEn: 'Facility A' },
  { code: 'MI', name: 'Facility B', nameEn: 'Facility B' },
  { code: 'MX', name: 'Facility C', nameEn: 'Facility C' },
];

type HowToGuide = {
  title: string;
  titleEn: string;
  note?: string;
  noteEn?: string;
  steps: { es: string; en: string }[];
};

const HOW_TO_GUIDES: HowToGuide[] = [
  {
    title: 'Cargar horas en un proyecto',
    titleEn: 'Load hours into a project',
    steps: [
      {
        es: 'En la Matriz de Capacidad, selecciona el departamento y localiza la celda del proyecto y la semana donde quieres registrar horas.',
        en: 'In the Capacity Matrix, select the department and find the project/week cell where you want to register hours.',
      },
      {
        es: 'Haz doble clic en la celda para abrir el modal "Edit Assignment".',
        en: 'Double-click the cell to open the "Edit Assignment" modal.',
      },
      {
        es: 'Si el departamento tiene fases (HD, MED, BUILD, PRG): elige la fase e ingresa las horas (en BUILD/PRG se separan en SCIO Hours y Horas Externas). Usa "+ Agregar" si necesitas registrar más de una fase en esa misma semana.',
        en: 'If the department has stages (HD, MED, BUILD, PRG): pick the stage and enter the hours (BUILD/PRG split into SCIO Hours and External Hours). Use "+ Add" if you need more than one stage in that same week.',
      },
      {
        es: 'Si la actividad abarca varias semanas, usa "Dividir en semanas" para repartir las horas de forma equitativa o manual entre las semanas siguientes.',
        en: 'If the activity spans several weeks, use "Split across weeks" to divide the hours evenly or manually across the following weeks.',
      },
      {
        es: 'En "Available Resources" selecciona a la(s) persona(s) que harán el trabajo (ver tarea siguiente para repartir entre varias).',
        en: 'In "Available Resources" select the person/people doing the work (see the next task for splitting across several).',
      },
      {
        es: 'Presiona "Save". Las semanas anteriores a la actual aparecen bloqueadas (datos reales de Finanzas) y solo permiten cambiar la fase, no las horas.',
        en: 'Press "Save". Weeks before the current one appear locked (real Finance data) and only let you relabel the stage, not the hours.',
      },
    ],
  },
  {
    title: 'Asignar horas a una o varias personas',
    titleEn: 'Assign hours to one or several people',
    steps: [
      {
        es: 'Dentro del modal "Edit Assignment", la lista "Available Resources" incluye tanto personal interno como proveedores externos ya dados de alta (marcados "Interno" / "Externo").',
        en: 'Inside the "Edit Assignment" modal, the "Available Resources" list includes both internal staff and already-registered external providers (tagged "Interno" / "Externo").',
      },
      {
        es: 'Marca la casilla de cada persona que participará. Con una sola persona seleccionada, todas las horas de esa fase se le asignan a ella.',
        en: 'Check the box for each person involved. With a single person selected, all of that stage\'s hours go to them.',
      },
      {
        es: 'Con 2 o más personas seleccionadas en el mismo grupo (interno o externo), aparece una cuadrícula con una columna por persona y una fila por semana: ahí se define cuántas horas le tocan a cada quien, cada semana.',
        en: 'With 2 or more people selected in the same pool (internal or external), a grid appears with one column per person and one row per week: that\'s where you set how many hours go to each person, each week.',
      },
      {
        es: 'Esa cuadrícula se puede repartir de forma equitativa (automática) o manual (editando cada celda); el total siempre debe coincidir con las horas capturadas para esa fase.',
        en: 'That grid can be split evenly (automatic) or manually (editing each cell); the total always has to match the hours captured for that stage.',
      },
      {
        es: 'No se puede guardar sin al menos una persona seleccionada: el botón "Save" queda deshabilitado hasta elegir un recurso.',
        en: 'You can\'t save without at least one person selected: the "Save" button stays disabled until a resource is chosen.',
      },
    ],
  },
  {
    title: 'Agregar un proveedor externo nuevo',
    titleEn: 'Add a new external provider',
    note: 'Disponible en BUILD (botón propio) y en MED, HD, MFG, PRG.',
    noteEn: 'Available in BUILD (its own button) and in MED, HD, MFG, PRG.',
    steps: [
      {
        es: 'En la Matriz de Capacidad, con el departamento seleccionado, haz clic en "+ Externo" en el encabezado del panel del departamento.',
        en: 'In the Capacity Matrix, with the department selected, click "+ External" in the department panel header.',
      },
      {
        es: 'Escribe el nombre del proveedor (ej. "AMI") y, opcionalmente, cuánto personal tiene disponible desde ya.',
        en: 'Type the provider\'s name (e.g. "AMI") and, optionally, how much staff it already has available.',
      },
      {
        es: 'Ingresa la tarifa por hora ($/hr) para cada fase del departamento — es obligatorio capturar un valor en cada una antes de poder guardar (en departamentos sin fases, como MFG, es una sola tarifa general).',
        en: 'Enter the hourly rate ($/hr) for each of the department\'s stages — a value is required in every one before you can save (departments with no stages, like MFG, just get one flat rate).',
      },
      {
        es: 'Al guardar, el proveedor queda registrado con su capacidad inicial y sus tarifas, y ya aparece seleccionable (etiqueta "Externo") en el modal de asignar horas de ese departamento.',
        en: 'On save, the provider is registered with its initial capacity and rates, and immediately becomes selectable (tagged "External") in that department\'s hour-assignment modal.',
      },
    ],
  },
  {
    title: 'Dar de alta o baja personal, interno y externo',
    titleEn: 'Add or remove staff, internal and external',
    note: 'Las personas (empleados individuales) se crean desde el panel de administración del backend. Lo que se gestiona aquí es el conteo de personal disponible por semana.',
    noteEn: 'Individual employee records are created from the backend admin panel. What\'s managed here is the headcount available per week.',
    steps: [
      {
        es: 'Personal interno (SCIO): botón "+ / − Personal" en el panel del departamento. Indica la fecha de vigencia (puede ser una fecha pasada, para corregir el historial), el cambio (p. ej. +1 para una contratación, -2 para dos bajas) y un comentario opcional.',
        en: 'Internal (SCIO) staff: "+ / − Staff" button in the department panel. Enter the effective date (can be a past date, to correct history), the change (e.g. +1 for a hire, -2 for two departures) and an optional comment.',
      },
      {
        es: 'Personal externo: botón "+ / − Personal Externo". Elige primero el proveedor ya registrado, luego la fecha de vigencia (aquí no puede ser anterior a la semana actual) y el cambio de personal.',
        en: 'External staff: "+ / − External Staff" button. First pick the already-registered provider, then the effective date (here it can\'t be before the current week) and the staff change.',
      },
      {
        es: 'En ambos casos la capacidad semanal se recalcula automáticamente hacia adelante a partir de ese cambio; no hay que editar semana por semana.',
        en: 'In both cases, weekly capacity is automatically recalculated forward from that change; there\'s no need to edit week by week.',
      },
      {
        es: 'El historial de cada ledger se puede revisar (y un movimiento se puede borrar si fue un error) dentro del mismo modal.',
        en: 'Each ledger\'s history can be reviewed (and a mistaken entry deleted) inside that same modal.',
      },
    ],
  },
  {
    title: 'Mover información de una semana a otra',
    titleEn: 'Move information from one week to another',
    steps: [
      {
        es: 'Abre el modal de edición (doble clic) en cualquier semana del proyecto/departamento que ya tenga horas registradas, y haz clic en "Mover semanas".',
        en: 'Open the edit modal (double-click) on any week of the project/department that already has hours registered, then click "Move weeks".',
      },
      {
        es: 'Elige el alcance: toda la celda, o filtra por una fase y/o persona específica si solo quieres mover parte de lo registrado.',
        en: 'Pick the scope: the whole cell, or filter to a specific stage and/or person if you only want to move part of what\'s registered.',
      },
      {
        es: 'Marca en la lista las semanas de origen que quieres mover.',
        en: 'Check the source weeks you want to move in the list.',
      },
      {
        es: 'Define la semana destino para la primera marcada; las demás se autocompletan con el mismo desfase (ej. mover 35→40 hace que 36 se sugiera en 41), pero cada una se puede ajustar por separado para combinar varias semanas en un mismo destino.',
        en: 'Set the destination week for the first one checked; the rest auto-fill with the same offset (e.g. moving 35→40 suggests 36→41), but each one can still be adjusted individually to combine several weeks into one destination.',
      },
      {
        es: 'Presiona "Continuar". Si alguna semana destino ya tiene datos que coinciden (misma persona y fase), se muestra el conflicto y eliges "Combinar" (sumar horas) o "Sobrescribir".',
        en: 'Press "Continue". If a destination week already has matching data (same person and stage), the conflict is shown and you choose "Merge" (add hours) or "Overwrite".',
      },
      {
        es: 'Confirma el movimiento: las semanas de origen quedan vacías y las horas aparecen en la(s) semana(s) destino.',
        en: 'Confirm the move: the source weeks are left empty and the hours appear in the destination week(s).',
      },
    ],
  },
];

export function GuidePage() {
  const { language } = useLanguage();
  const isSpanish = language === 'es';

  const l = (es: string, en: string) => isSpanish ? es : en;

  const accessBadge = (access: RoleCard['access']) => {
    const map = {
      full: { class: 'bg-emerald-100 text-emerald-800 border-emerald-300', label: l('Acceso Total', 'Full Access') },
      department: { class: 'bg-blue-100 text-blue-800 border-blue-300', label: l('Por Departamento', 'By Department') },
      readonly: { class: 'bg-gray-100 text-gray-700 border-gray-300', label: l('Solo Lectura', 'Read Only') },
      head: { class: 'bg-violet-100 text-violet-800 border-violet-300', label: l('Head Engineering', 'Head Engineering') },
      bi: { class: 'bg-amber-100 text-amber-800 border-amber-300', label: l('BI + Full', 'BI + Full') },
    };
    return map[access];
  };

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-8 pb-12">

        {/* Header */}
        <div className="flex items-center gap-3 border-b pb-4">
          <BookOpen size={22} className="text-[#2e1a47]" />
          <div>
            <h1 className="text-lg font-bold text-[#2e1a47]">
              {l('Guía del Sistema', 'System Guide')}
            </h1>
            <p className="text-xs text-[#6c6480]">
              {l('Documentación completa del funcionamiento de la aplicación', 'Complete application functionality documentation')}
            </p>
          </div>
        </div>

        {/* Section: Overview */}
        <section>
          <h2 className="text-sm font-bold text-[#2e1a47] uppercase tracking-wide mb-3">
            {l('Visión General', 'Overview')}
          </h2>
          <div className="bg-white border border-[#e5e0eb] rounded-lg p-4 text-sm text-[#4a4458] leading-relaxed space-y-2">
            <p>
              {l(
                'Capacity Planner es una plataforma de planificación de capacidad de ingeniería que permite gestionar empleados, proyectos y asignaciones de horas a través de múltiples departamentos. Facilita la visualización de carga de trabajo semanal, el control de presupuestos por departamento y la generación de reportes de utilización.',
                'Capacity Planner is an engineering capacity planning platform for managing employees, projects, and hour assignments across multiple departments. It facilitates weekly workload visualization, department budget control, and utilization reporting.'
              )}
            </p>
            <p>
              {l(
                'La aplicación sigue un ciclo de trabajo: 1) Registrar empleados, 2) Crear proyectos con presupuestos y etapas, 3) Asignar horas en la matriz de capacidad, 4) Monitorear utilización y ajustar según sea necesario.',
                'The application follows a workflow cycle: 1) Register employees, 2) Create projects with budgets and stages, 3) Assign hours in the capacity matrix, 4) Monitor utilization and adjust as needed.'
              )}
            </p>
          </div>
        </section>

        {/* Section: Instalaciones */}
        <section>
          <h2 className="text-sm font-bold text-[#2e1a47] uppercase tracking-wide mb-3">
            {l('Instalaciones', 'Facilities')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {FACILITIES.map((f) => (
              <div key={f.code} className="bg-white border border-[#e5e0eb] rounded-lg p-3 text-sm">
                <span className="font-semibold text-[#2e1a47]">{f.code}</span>
                <span className="text-[#6c6480] ml-2">{l(f.name, f.nameEn)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Section: Departamentos */}
        <section>
          <h2 className="text-sm font-bold text-[#2e1a47] uppercase tracking-wide mb-3">
            {l('Departamentos de Ingeniería', 'Engineering Departments')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {DEPARTMENT_INFO.map((dept) => (
              <div key={dept.code} className="bg-white border border-[#e5e0eb] rounded-lg p-3 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono font-bold text-xs bg-[#2e1a47] text-white px-2 py-0.5 rounded">{dept.code}</span>
                  <span className="font-semibold text-[#2e1a47]">{l(dept.name, dept.nameEn)}</span>
                </div>
                <p className="text-[#6c6480] text-xs leading-relaxed">{l(dept.desc, dept.descEn)}</p>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <h3 className="text-xs font-semibold text-[#6c6480] uppercase tracking-wide mb-2">
              {l('Sub-departamentos (OTHER)', 'Sub-departments (OTHER)')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {OTHER_DEPARTMENTS.map((od) => (
                <div key={od.code} className="bg-white border border-[#e5e0eb] rounded-lg p-2.5 text-sm flex justify-between items-center">
                  <div>
                    <span className="font-mono font-bold text-xs bg-[#6c6480] text-white px-1.5 py-0.5 rounded mr-2">{od.code}</span>
                    <span className="font-medium text-[#2e1a47] text-xs">{l(od.name, od.nameEn)}</span>
                  </div>
                  <span className="text-[10px] text-[#6c6480] bg-[#f3eff8] px-2 py-0.5 rounded-full">{l(od.access, od.accessEn)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Section: Roles and Permissions */}
        <section>
          <h2 className="text-sm font-bold text-[#2e1a47] uppercase tracking-wide mb-3 flex items-center gap-2">
            <Shield size={16} />
            {l('Roles y Permisos', 'Roles & Permissions')}
          </h2>
          <div className="space-y-3">
            {ROLES.map((role, i) => {
              const badge = accessBadge(role.access);
              return (
                <div key={i} className="bg-white border border-[#e5e0eb] rounded-lg overflow-hidden">
                  <div className="p-3 bg-[#faf8fc] border-b border-[#e5e0eb] flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-[#2e1a47]">{l(role.title, role.titleEn)}</span>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${badge.class}`}>
                      {badge.label}
                    </span>
                    <span className="text-[10px] text-[#6c6480] font-mono bg-white px-1.5 py-0.5 rounded border">
                      {role.departments}
                    </span>
                  </div>
                  <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="flex items-center gap-1.5 text-emerald-700 font-semibold mb-1">
                        <Edit3 size={12} /> {l('Puede Editar', 'Can Edit')}
                      </div>
                      <p className="text-[#4a4458] leading-relaxed">{l(role.canEdit, role.canEditEn)}</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 text-blue-700 font-semibold mb-1">
                        <Eye size={12} /> {l('Puede Ver', 'Can View')}
                      </div>
                      <p className="text-[#4a4458] leading-relaxed">{l(role.canView, role.canViewEn)}</p>
                    </div>
                  </div>
                  <div className="px-3 pb-3 text-xs">
                    <div className="flex items-center gap-1.5 text-red-600 font-semibold mb-1">
                      <Lock size={12} /> {l('Restricciones', 'Restrictions')}
                    </div>
                    <p className="text-[#4a4458] leading-relaxed">{l(role.restrictions, role.restrictionsEn)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section: Ventanas */}
        <section>
          <h2 className="text-sm font-bold text-[#2e1a47] uppercase tracking-wide mb-3">
            {l('Ventanas de la Aplicación', 'Application Windows')}
          </h2>
          <div className="space-y-4">
            {WINDOWS.map((win, i) => (
              <div key={i} className="bg-white border border-[#e5e0eb] rounded-lg overflow-hidden">
                <div className="p-3 bg-[#faf8fc] border-b border-[#e5e0eb] flex items-center gap-2">
                  <span className="text-[#2e1a47]">{win.icon}</span>
                  <span className="font-semibold text-sm text-[#2e1a47]">{l(win.title, win.titleEn)}</span>
                </div>
                <div className="p-3">
                  <p className="text-xs text-[#4a4458] leading-relaxed mb-3">
                    {l(win.description, win.descriptionEn)}
                  </p>
                  <ul className="space-y-1">
                    {(isSpanish ? win.features : win.featuresEn).map((f, j) => (
                      <li key={j} className="flex items-start gap-2 text-xs text-[#4a4458]">
                        <span className="text-[#827691] mt-0.5">•</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section: Conceptos Clave */}
        <section>
          <h2 className="text-sm font-bold text-[#2e1a47] uppercase tracking-wide mb-3 flex items-center gap-2">
            <Key size={16} />
            {l('Conceptos Clave', 'Key Concepts')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {CONCEPTS.map((c, i) => (
              <div key={i} className="bg-white border border-[#e5e0eb] rounded-lg p-3">
                <h3 className="font-semibold text-sm text-[#2e1a47] mb-1">{l(c.title, c.titleEn)}</h3>
                <p className="text-xs text-[#6c6480] leading-relaxed">{l(c.desc, c.descEn)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Section: Flujo de trabajo */}
        <section>
          <h2 className="text-sm font-bold text-[#2e1a47] uppercase tracking-wide mb-3">
            {l('Flujo de Trabajo Típico', 'Typical Workflow')}
          </h2>
          <div className="bg-white border border-[#e5e0eb] rounded-lg p-4">
            <ol className="space-y-3 text-sm text-[#4a4458]">
              {[
                {
                  es: 'Registrar empleados (departamento, rol y capacidad semanal) desde el panel de administración del backend.',
                  en: 'Register employees (department, role, and weekly capacity) from the backend admin panel.',
                },
                {
                  es: 'Configurar capacidades de equipo (SCIO, subcontratados BUILD, externos PRG) en la "Matriz de Capacidad".',
                  en: 'Configure team capacities (SCIO, BUILD subcontracted, PRG external) in the "Capacity Matrix".',
                },
                {
                  es: 'Crear proyectos en "Proyectos" con nombre, cliente, fechas, facility y presupuesto de horas por departamento.',
                  en: 'Create projects in "Projects" with name, client, dates, facility, and department hour budgets.',
                },
                {
                  es: 'Configurar etapas (stages) por departamento para cada proyecto, definiendo semanas de inicio y fin.',
                  en: 'Configure department stages for each project, defining start and end weeks.',
                },
                {
                  es: 'En la "Matriz de Capacidad", asignar horas a empleados en proyectos y semanas específicas.',
                  en: 'In the "Capacity Matrix", assign hours to employees in specific projects and weeks.',
                },
                {
                  es: 'Monitorear la utilización en el panel Global (colores indican nivel de ocupación).',
                  en: 'Monitor utilization in the Global panel (colors indicate occupancy level).',
                },
                {
                  es: 'Revisar el "Registro de Actividad" para auditar cambios realizados en el sistema.',
                  en: 'Check the "Activity Log" to audit changes made in the system.',
                },
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#2e1a47] text-white text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{l(step.es, step.en)}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Section: Tareas comunes paso a paso */}
        <section>
          <h2 className="text-sm font-bold text-[#2e1a47] uppercase tracking-wide mb-3 flex items-center gap-2">
            <Edit3 size={16} />
            {l('Tareas Comunes Paso a Paso', 'Common Tasks Step-by-Step')}
          </h2>
          <div className="space-y-4">
            {HOW_TO_GUIDES.map((guide, i) => (
              <div key={i} className="bg-white border border-[#e5e0eb] rounded-lg overflow-hidden">
                <div className="p-3 bg-[#faf8fc] border-b border-[#e5e0eb]">
                  <span className="font-semibold text-sm text-[#2e1a47]">{l(guide.title, guide.titleEn)}</span>
                  {guide.note && (
                    <p className="text-[11px] text-[#6c6480] mt-1">{l(guide.note, guide.noteEn || guide.note)}</p>
                  )}
                </div>
                <div className="p-3">
                  <ol className="space-y-2.5">
                    {guide.steps.map((step, j) => (
                      <li key={j} className="flex items-start gap-3 text-xs text-[#4a4458]">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#ece6f5] text-[#2e1a47] text-[10px] font-bold flex items-center justify-center">
                          {j + 1}
                        </span>
                        <span className="pt-0.5 leading-relaxed">{l(step.es, step.en)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section: Sesiones */}
        <section>
          <h2 className="text-sm font-bold text-[#2e1a47] uppercase tracking-wide mb-3">
            {l('Gestión de Sesiones', 'Session Management')}
          </h2>
          <div className="bg-white border border-[#e5e0eb] rounded-lg p-4 text-sm text-[#4a4458] leading-relaxed space-y-2">
            <p>
              {l(
                'Cada usuario puede tener máximo 2 sesiones activas simultáneas (2 dispositivos). Si intenta iniciar sesión en un tercer dispositivo, se rechazará hasta que cierre sesión en uno de los anteriores.',
                'Each user can have a maximum of 2 simultaneous active sessions (2 devices). Attempting to log in on a third device will be rejected until logging out from a previous one.'
              )}
            </p>
            <p>
              {l(
                'Las sesiones expiran tras 90 minutos de inactividad. El sistema verifica la actividad del usuario cada minuto y cierra automáticamente las sesiones inactivas.',
                'Sessions expire after 90 minutes of inactivity. The system checks user activity every minute and automatically closes inactive sessions.'
              )}
            </p>
          </div>
        </section>

        <div className="text-center text-[10px] text-[#9ca3af] pt-4 border-t">
          {l(
            'Capacity Planner v1.2 — Documentación generada automáticamente a partir del análisis del código fuente.',
            'Capacity Planner v1.2 — Documentation automatically generated from source code analysis.'
          )}
        </div>
      </div>
    </div>
  );
}
