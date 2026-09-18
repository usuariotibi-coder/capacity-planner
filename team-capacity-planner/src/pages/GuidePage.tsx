import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';
import { BookOpen, Users, Briefcase, Grid3x3, FileText, Shield, Key, Eye, Edit3, UserCheck, Lock } from 'lucide-react';

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
    title: 'Recursos',
    titleEn: 'Resources',
    icon: <Users size={18} />,
    description: 'Gestión de empleados y capacidades de equipo. Permite administrar el personal, sus horas disponibles, y las capacidades de equipos externos y subcontratados.',
    descriptionEn: 'Employee and team capacity management. Allows managing personnel, their available hours, and external/subcontracted team capacities.',
    features: [
      'Lista de empleados con nombre, rol, departamento, capacidad semanal y estado',
      'Crear nuevo empleado: nombre, rol, departamento, capacidad (default 45h/semana)',
      'Editar empleado existente (nombre, rol, capacidad, estado activo/inactivo)',
      'Eliminar empleado',
      'Gestión de SCIO Team Capacity: capacidad del equipo interno por departamento y semana, incluyendo PTO y training',
      'Gestión de Subcontracted Team Capacity (BUILD): personal subcontratado por compañía y semana',
      'Gestión de PRG External Team Capacity: equipos externos de programación por nombre y semana',
      'Vista de asignaciones por empleado (horas por proyecto/semana)',
      'Exportación a Excel de la tabla de empleados',
      'Botón para eliminar todos los datos (solo admin, con confirmación)',
    ],
    featuresEn: [
      'Employee list with name, role, department, weekly capacity and status',
      'Create new employee: name, role, department, capacity (default 45h/week)',
      'Edit existing employee (name, role, capacity, active/inactive status)',
      'Delete employee',
      'SCIO Team Capacity management: internal team capacity by department and week, including PTO and training',
      'Subcontracted Team Capacity management (BUILD): subcontracted personnel by company and week',
      'PRG External Team Capacity management: external programming teams by name and week',
      'Assignment view per employee (hours per project/week)',
      'Export employee table to Excel',
      'Delete all data button (admin only, with confirmation)',
    ],
  },
  {
    title: 'Proyectos',
    titleEn: 'Projects',
    icon: <Briefcase size={18} />,
    description: 'Gestión completa del ciclo de vida de proyectos. Permite crear, editar, importar y eliminar proyectos, configurar presupuestos por departamento, etapas, change orders, y visualizar métricas de utilización.',
    descriptionEn: 'Complete project lifecycle management. Allows creating, editing, importing and deleting projects, configuring department budgets, stages, change orders, and viewing utilization metrics.',
    features: [
      'Crear proyecto nuevo: nombre, cliente, fechas inicio/fin, facility, project manager',
      'Configurar presupuesto de horas por departamento (horas cotizadas)',
      'Configurar etapas (stages) por departamento con fechas de inicio y duración',
      'Marcar proyecto como "alta probabilidad" para priorización visual',
      'Importar proyecto existente (hereda configuración de stages y presupuesto)',
      'Editar proyecto: modificar datos, stages, presupuestos',
      'Eliminar proyecto (soft-delete: se oculta pero conserva datos históricos)',
      'Gestión de Change Orders por departamento con horas cotizadas',
      'Asignar Project Manager desde lista de empleados',
      'Filtro de visibilidad: elegir en qué departamentos se muestra el proyecto (General o específicos)',
      'Filtro de búsqueda por nombre, cliente o PM',
      'Indicadores de presupuesto: horas cotizadas vs utilizadas vs forecast',
      'Métrica de utilización por departamento (%)',
    ],
    featuresEn: [
      'Create new project: name, client, start/end dates, facility, project manager',
      'Configure department hour budget (quoted hours)',
      'Configure department stages with start dates and duration',
      'Mark project as "high probability" for visual prioritization',
      'Import existing project (inherits stage and budget configuration)',
      'Edit project: modify data, stages, budgets',
      'Delete project (soft-delete: hidden but preserves historical data)',
      'Change Orders management by department with quoted hours',
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
];

const DEPARTMENT_INFO = [
  { code: 'PM', name: 'Project Manager', nameEn: 'Project Manager', desc: 'Gestión de proyectos, planificación y coordinación.', descEn: 'Project management, planning and coordination.' },
  { code: 'MED', name: 'Mechanical Design', nameEn: 'Mechanical Design', desc: 'Diseño mecánico: etapas Concept y Detail Design.', descEn: 'Mechanical design: Concept and Detail Design stages.' },
  { code: 'HD', name: 'Hardware Design', nameEn: 'Hardware Design', desc: 'Diseño de hardware: etapas Switch Layout Revision y Controls Design.', descEn: 'Hardware design: Switch Layout Revision and Controls Design stages.' },
  { code: 'MFG', name: 'Manufacturing', nameEn: 'Manufacturing', desc: 'Manufactura. Puede editar BUILD y viceversa. No tiene etapas específicas.', descEn: 'Manufacturing. Can edit BUILD and vice versa. No specific stages.' },
  { code: 'BUILD', name: 'Assembly', nameEn: 'Assembly', desc: 'Ensamblaje: etapas Cabinets/Frames, Overall Assembly, Fine Tuning, Commissioning. Soporta equipos subcontratados.', descEn: 'Assembly: Cabinets/Frames, Overall Assembly, Fine Tuning, Commissioning stages. Supports subcontracted teams.' },
  { code: 'PRG', name: 'Programming PLC', nameEn: 'Programming PLC', desc: 'Programación PLC: etapas Offline, Online, Debug, Commissioning. Soporta equipos externos.', descEn: 'PLC Programming: Offline, Online, Debug, Commissioning stages. Supports external teams.' },
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
    desc: 'Órdenes de cambio que agregan horas cotizadas adicionales a un proyecto por departamento. Las asignaciones pueden vincularse a un Change Order específico.',
    descEn: 'Change orders adding additional quoted hours to a project per department. Assignments can be linked to a specific Change Order.',
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
    title: 'PRG External Team Capacity',
    titleEn: 'PRG External Team Capacity',
    desc: 'Equipos externos de programación PLC por nombre de equipo y semana para el departamento PRG.',
    descEn: 'External PLC programming teams by team name and week for the PRG department.',
  },
];

const FACILITIES = [
  { code: 'AL', name: 'Facility A', nameEn: 'Facility A' },
  { code: 'MI', name: 'Facility B', nameEn: 'Facility B' },
  { code: 'MX', name: 'Facility C', nameEn: 'Facility C' },
];

export function GuidePage() {
  const { language } = useLanguage();
  const t = useTranslation(language);
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
                  es: 'Registrar empleados en la ventana "Recursos" con su departamento, rol y capacidad semanal.',
                  en: 'Register employees in the "Resources" window with their department, role, and weekly capacity.',
                },
                {
                  es: 'Configurar capacidades de equipo (SCIO, subcontratados BUILD, externos PRG) en "Recursos".',
                  en: 'Configure team capacities (SCIO, BUILD subcontracted, PRG external) in "Resources".',
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
            'Capacity Planner v1.1 — Documentación generada automáticamente a partir del análisis del código fuente.',
            'Capacity Planner v1.1 — Documentation automatically generated from source code analysis.'
          )}
        </div>
      </div>
    </div>
  );
}
