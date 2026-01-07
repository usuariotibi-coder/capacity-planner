/**
 * Obtiene el lunes (inicio de semana) de una fecha dada
 */
export const getWeekStart = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Ajusta al lunes
  return new Date(d.setDate(diff));
};

/**
 * Obtiene un array de strings con las fechas de inicio de semana en un rango
 */
export const getWeeksInRange = (startDate: string, endDate: string): string[] => {
  const weeks: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

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

/**
 * Obtiene el lunes de la semana 1 del año especificado (o actual)
 */
export const getWeek1Start = (year?: number): Date => {
  const targetYear = year || new Date().getFullYear();
  const jan1 = new Date(targetYear, 0, 1);
  return getWeekStart(jan1);
};

/**
 * Obtiene todas las 52 semanas del año como array de strings (ISO format)
 */
export const getAllWeeksOfYear = (year?: number): string[] => {
  const targetYear = year || new Date().getFullYear();
  const weeks: string[] = [];
  let current = getWeek1Start(targetYear);

  // Generar 52 semanas
  for (let i = 0; i < 52; i++) {
    weeks.push(current.toISOString().split('T')[0]);
    current = new Date(current);
    current.setDate(current.getDate() + 7);
  }

  return weeks;
};

/**
 * Obtiene el número de semana (1-52) para una fecha dada
 */
export const getWeekNumber = (dateStr: string, year?: number): number => {
  const targetYear = year || new Date().getFullYear();
  const week1Start = getWeek1Start(targetYear);
  const date = new Date(dateStr);

  const diff = date.getTime() - week1Start.getTime();
  const weekNum = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;

  return Math.max(1, Math.min(52, weekNum));
};

/**
 * Obtiene el número de la semana actual (1-52)
 */
export const getCurrentWeekNumber = (): number => {
  return getWeekNumber(formatToISO(new Date()));
};

/**
 * Obtiene las semanas del año actual más las primeras semanas del próximo año
 * Retorna un array de objetos con: { date: string, weekNum: number, isNextYear: boolean }
 * Las semanas del próximo año empiezan en 1
 */
export const getAllWeeksWithNextYear = (year?: number): Array<{ date: string; weekNum: number; isNextYear: boolean }> => {
  const targetYear = year || new Date().getFullYear();
  const weeks: Array<{ date: string; weekNum: number; isNextYear: boolean }> = [];

  // Get all 52 weeks of current year
  let current = getWeek1Start(targetYear);
  for (let i = 0; i < 52; i++) {
    weeks.push({
      date: current.toISOString().split('T')[0],
      weekNum: i + 1,
      isNextYear: false
    });
    current = new Date(current);
    current.setDate(current.getDate() + 7);
  }

  // Add first 10 weeks of next year - numbering starts at 1
  const nextYear = targetYear + 1;
  let nextYearCurrent = getWeek1Start(nextYear);
  for (let i = 0; i < 10; i++) {
    weeks.push({
      date: nextYearCurrent.toISOString().split('T')[0],
      weekNum: i + 1,  // Reset to 1 for next year
      isNextYear: true
    });
    nextYearCurrent = new Date(nextYearCurrent);
    nextYearCurrent.setDate(nextYearCurrent.getDate() + 7);
  }

  return weeks;
};
