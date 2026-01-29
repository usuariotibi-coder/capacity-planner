/**
 * Obtiene el lunes (inicio de semana) de una fecha dada
 */
export const getWeekStart = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Ajusta al lunes
  return new Date(d.setDate(diff));
};

export const parseISODate = (dateStr: string): Date => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};

/**
 * Obtiene un array de strings con las fechas de inicio de semana en un rango
 */
export const getWeeksInRange = (startDate: string, endDate: string): string[] => {
  const weeks: string[] = [];
  const start = parseISODate(startDate);
  const end = parseISODate(endDate);

  let current = getWeekStart(start);

  while (current <= end) {
    weeks.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 7);
  }

  return weeks;
};

/**
 * Formatea una fecha a formato YYYY-MM-DD
 */
export const formatToISO = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const getISOWeekInfo = (date: Date): { year: number; week: number } => {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0 ... Sunday = 6
  d.setDate(d.getDate() - day + 3); // Shift to Thursday

  const isoYear = d.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4);
  const firstThursdayDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstThursdayDay + 3);

  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * MS_PER_DAY));
  return { year: isoYear, week };
};

const getISOWeeksInYear = (year: number): number => {
  const dec28 = new Date(year, 11, 28);
  return getISOWeekInfo(dec28).week;
};

/**
 * Obtiene el lunes de la semana que contiene el 1 de enero del aÃ±o especificado (o actual)
 */
export const getWeek1Start = (year?: number): Date => {
  const targetYear = year || new Date().getFullYear();
  const jan1 = new Date(targetYear, 0, 1);
  return getWeekStart(jan1);
};

/**
 * Obtiene todas las semanas del aÃ±o como array de strings (ISO format)
 * Incluye la semana de inicio si pertenece al aÃ±o anterior (cuando el 1 de enero cae Vie/Sab/Dom)
 */
export const getAllWeeksOfYear = (year?: number): string[] => {
  const targetYear = year || new Date().getFullYear();
  const weeks: string[] = [];
  let current = getWeek1Start(targetYear);

  while (true) {
    const info = getISOWeekInfo(current);
    if (info.year > targetYear) {
      break;
    }

    weeks.push(current.toISOString().split('T')[0]);
    current = new Date(current);
    current.setDate(current.getDate() + 7);
  }

  return weeks;
};

/**
 * Obtiene el nÃºmero de semana ISO para una fecha dada
 */
export const getWeekNumber = (dateStr: string, year?: number): number => {
  const date = parseISODate(dateStr);
  const { year: isoYear, week } = getISOWeekInfo(date);

  if (year !== undefined && isoYear !== year) {
    const weeksInTarget = getISOWeeksInYear(year);
    return isoYear < year ? weeksInTarget : 1;
  }

  return week;
};

/**
 * Obtiene el nÃºmero de la semana actual (ISO)
 */
export const getCurrentWeekNumber = (): number => {
  return getWeekNumber(formatToISO(new Date()));
};

/**
 * Obtiene las semanas del aÃ±o actual mÃ¡s las primeras semanas del prÃ³ximo aÃ±o
 * Retorna un array de objetos con: { date: string, weekNum: number, isNextYear: boolean }
 * Las semanas del prÃ³ximo aÃ±o empiezan en 1
 */
export const getAllWeeksWithNextYear = (year?: number): Array<{ date: string; weekNum: number; isNextYear: boolean }> => {
  const targetYear = year || new Date().getFullYear();
  const weeks: Array<{ date: string; weekNum: number; isNextYear: boolean }> = [];

  let current = getWeek1Start(targetYear);

  // Current year (calendar view): include leading overlap + all ISO weeks of the year
  while (true) {
    const info = getISOWeekInfo(current);
    if (info.year > targetYear) {
      break;
    }

    weeks.push({
      date: current.toISOString().split('T')[0],
      weekNum: info.week,
      isNextYear: false
    });

    current = new Date(current);
    current.setDate(current.getDate() + 7);
  }

  // Add first 10 weeks of next year
  for (let i = 0; i < 10; i++) {
    const info = getISOWeekInfo(current);
    weeks.push({
      date: current.toISOString().split('T')[0],
      weekNum: info.week,
      isNextYear: true
    });
    current = new Date(current);
    current.setDate(current.getDate() + 7);
  }

  return weeks;
};
