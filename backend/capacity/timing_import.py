"""
Timing file import.

Parses a "Timing <project>.xlsx" Gantt file (the PM-authored schedule template
used to plan a project) and extracts, per app department, the start/end dates
needed to pre-fill DepartmentStageConfig when a project is created or when its
schedule changes and a revised Timing file is re-uploaded.

The file's "Timing" sheet lists one row per Gantt item (Type 'S' = Stage,
'M' = Milestone, 'T' = Task). Only Stage ('S') rows are read here -- they
already carry a fully resolved Start/End date computed by the file's own
dependency chain, so no date-math/CPM logic needs to be reimplemented here.
"""
from datetime import date, datetime

import openpyxl

TYPE_COL = 3
DESC_COL = 4
START_COL = 16
END_COL = 17

# Departments whose app-level date range comes from a single Timing stage.
SIMPLE_DEPARTMENT_STAGE_MAP = {
    'MED': 'MED',
    'HD': 'HD',
    'MFG': 'MFG',
    'PURCHASING': 'PUR',
}

# Departments split into named sub-phases in the app; each sub-phase pulls
# from its own Timing stage. Commissioning is a separate, later Gantt stage
# (on-site work after shipping), not part of the "BUILD" stage itself.
SPLIT_DEPARTMENT_STAGE_MAP = {
    'BUILD': {
        'ASSEMBLY': 'BUILD',
        'COMMISSIONING': 'Commissioning',
    },
    'PRG': {
        'OFFLINE': 'PRG OFFLINE',
        'ONLINE': 'PRG ONLINE',
        'DEBUG': 'PRG DEBUG',
    },
}

IGNORED_STAGES = {'RAW MATERIAL PUR'}

MIN_SANE_DATE = date(2000, 1, 1)
MAX_SANE_DATE = date(2100, 1, 1)


class TimingParseError(Exception):
    """Raised when the uploaded file isn't a recognizable Timing file."""


def _to_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def _is_sane_date(d):
    return d is not None and MIN_SANE_DATE <= d <= MAX_SANE_DATE


def parse_timing_file(file_obj):
    """
    Parse an uploaded Timing .xlsx file.

    Returns a dict:
        {
            "project_start_date": "YYYY-MM-DD" | None,
            "project_end_date": "YYYY-MM-DD" | None,
            "number_of_weeks": int | None,
            "departments": {
                "MED": {"start": "...", "end": "..."},
                "HD": {...}, "MFG": {...}, "PURCHASING": {...},
                "PM": {...},
                "BUILD": {"ASSEMBLY": {...}, "COMMISSIONING": {...}},
                "PRG": {"OFFLINE": {...}, "ONLINE": {...}, "DEBUG": {...}},
            },
            "warnings": ["..."],
        }

    Any stage that couldn't be read cleanly is left out of "departments" (with
    a warning explaining why) rather than guessed at -- the caller is expected
    to show this as an editable preview before anything is saved.
    """
    try:
        wb = openpyxl.load_workbook(file_obj, data_only=True)
    except Exception as exc:
        raise TimingParseError(f"No se pudo abrir el archivo: {exc}")

    if 'Timing' not in wb.sheetnames:
        raise TimingParseError("El archivo no tiene una hoja llamada 'Timing'.")

    ws = wb['Timing']

    header_row_idx = None
    for row in ws.iter_rows(min_row=1, max_row=30):
        if len(row) > 1 and row[1].value == 'id':
            header_row_idx = row[0].row
            break
    if header_row_idx is None:
        raise TimingParseError("No se encontró la fila de encabezado ('id') en la hoja 'Timing'.")

    stage_rows = {}
    warnings = []

    for row in ws.iter_rows(min_row=header_row_idx + 1, max_row=ws.max_row, max_col=END_COL + 1):
        if row[TYPE_COL].value != 'S':
            continue
        description = row[DESC_COL].value
        if not description:
            continue
        description = str(description).strip()

        start = _to_date(row[START_COL].value)
        end = _to_date(row[END_COL].value)

        if not _is_sane_date(start) or not _is_sane_date(end) or start > end:
            warnings.append(
                f"El stage '{description}' tiene fechas inválidas en el archivo y se omitió "
                "(requiere captura manual)."
            )
            continue

        stage_rows[description] = {'start': start.isoformat(), 'end': end.isoformat()}

    departments = {}

    for dept, stage_name in SIMPLE_DEPARTMENT_STAGE_MAP.items():
        if stage_name in stage_rows:
            departments[dept] = stage_rows[stage_name]
        else:
            warnings.append(f"No se encontró el stage '{stage_name}' para el departamento {dept}.")

    for dept, subphases in SPLIT_DEPARTMENT_STAGE_MAP.items():
        dept_result = {}
        for subphase, stage_name in subphases.items():
            if stage_name in stage_rows:
                dept_result[subphase] = stage_rows[stage_name]
            else:
                warnings.append(f"No se encontró el stage '{stage_name}' para {dept} / {subphase}.")
        if dept_result:
            departments[dept] = dept_result

    for ignored in IGNORED_STAGES:
        if ignored in stage_rows:
            warnings.append(
                f"Se encontró el stage '{ignored}' pero se ignora (no corresponde a un "
                "departamento propio de la app)."
            )

    project_start = None
    project_end = None
    number_of_weeks = None

    if 'Settings' in wb.sheetnames:
        ws_settings = wb['Settings']
        for row in ws_settings.iter_rows(min_row=1, max_row=ws_settings.max_row, max_col=5):
            label = row[2].value if len(row) > 2 else None
            if not isinstance(label, str):
                continue
            label = label.strip()
            value = row[3].value if len(row) > 3 else None
            if label == 'Project Start Date:':
                candidate = _to_date(value)
                if _is_sane_date(candidate):
                    project_start = candidate
            elif label == 'Project Weeks:' and isinstance(value, (int, float)):
                number_of_weeks = int(value)

    all_starts = [datetime.fromisoformat(v['start']).date() for v in stage_rows.values()]
    all_ends = [datetime.fromisoformat(v['end']).date() for v in stage_rows.values()]

    if project_start is None and all_starts:
        project_start = min(all_starts)
    if all_ends:
        project_end = max(all_ends)

    if project_start and project_end and not number_of_weeks:
        number_of_weeks = max(1, (project_end - project_start).days // 7 + 1)

    departments['PM'] = {
        'start': project_start.isoformat() if project_start else None,
        'end': project_end.isoformat() if project_end else None,
    }
    if not project_start or not project_end:
        warnings.append("No se pudo determinar el rango general del proyecto (PM) -- requiere captura manual.")

    return {
        'project_start_date': project_start.isoformat() if project_start else None,
        'project_end_date': project_end.isoformat() if project_end else None,
        'number_of_weeks': number_of_weeks,
        'departments': departments,
        'warnings': warnings,
    }
