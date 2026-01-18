import { format, parse, differenceInMinutes, addDays, isBefore, isWeekend } from 'date-fns';
import { de } from 'date-fns/locale';

// Helper to parse "HH:mm" string to minutes from start of day
const parseTimeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return (hours * 60) + minutes;
};

// Berechnet die Dauer in Minuten (interner Gebrauch für präzise Addition)
export const calculateDurationInMinutes = (startTime: string, endTime: string, pauseDurationMinutes: number = 0): number => {
  if (!startTime || !endTime) return 0;

  let start = parseTimeToMinutes(startTime);
  let end = parseTimeToMinutes(endTime);

  // Handle crossing midnight (e.g. 23:00 to 01:00)
  if (end < start) {
    end += 24 * 60;
  }

  const duration = end - start - pauseDurationMinutes;
  return Math.max(0, duration);
};

// Formats minutes to decimal string (e.g. 90 min -> "1,50")
export const formatMinutesToDecimal = (minutes: number): string => {
  const decimal = minutes / 60;
  return decimal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Main function used by UI
export const calculateDuration = (startTime: string, endTime: string, pauseTime: string = '0'): number => {
  if (!startTime || !endTime) return 0;

  // Convert pause string (which might be decimal hours or minutes, depending on input) to minutes
  const pauseMinutes = parseInt(pauseTime) || 0;
  const durationInMinutes = calculateDurationInMinutes(startTime, endTime, pauseMinutes);

  // Return as number for calculations, rounded to 2 decimals
  return parseFloat((durationInMinutes / 60).toFixed(2));
};

export const formatDate = (dateString: string): string => {
  if (!dateString) return '';
  try {
    return format(new Date(dateString), 'dd.MM.yyyy', { locale: de });
  } catch (e) {
    return dateString;
  }
};

export const formatTime = (timeString: string): string => {
  if (!timeString) return '';
  return timeString;
};

export const getDayName = (dateString: string): string => {
  if (!dateString) return '';
  try {
    return format(new Date(dateString), 'EEEE', { locale: de });
  } catch (e) {
    return '';
  }
};

export const getCurrentTime = (): string => {
  return format(new Date(), 'HH:mm');
};

export const getCurrentDate = (): string => {
  return format(new Date(), 'yyyy-MM-dd');
};

// Legacy/UI helper: Formats decimal hours (e.g. 1.5) to string "1,50"
export const formatDuration = (hours: number): string => {
  if (isNaN(hours)) return '0,00';
  return hours.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * Calculates working days (Mon-Fri) between two dates inclusive.
 * Does NOT account for holidays (needs external list).
 */
export const calculateWorkingDays = (startDate: string | Date, endDate: string | Date): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (start > end) return 0;

  let days = 0;
  let curr = new Date(start);
  while (curr <= end) {
    if (!isWeekend(curr)) {
      days++;
    }
    curr.setDate(curr.getDate() + 1);
  }
  return days;
};

// --- HOLIDAY LOGIC (Bavaria) ---
const getEasterDate = (year: number): Date => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
};

export const getHolidays = (year: number): string[] => {
  const holidays: string[] = [
    `${year}-01-01`, // New Year
    `${year}-01-06`, // Epiphany
    `${year}-05-01`, // Labor Day
    `${year}-08-15`, // Assumption
    `${year}-10-03`, // Unity Day
    `${year}-11-01`, // All Saints
    `${year}-12-25`, // Christmas 1
    `${year}-12-26`  // Christmas 2
  ];

  const easter = getEasterDate(year);

  // Dynamic Holidays based on Easter
  const karfreitag = addDays(easter, -2);
  const ostermontag = addDays(easter, 1);
  const himmelfahrt = addDays(easter, 39);
  const pfingstmontag = addDays(easter, 50);
  const fronleichnam = addDays(easter, 60);

  holidays.push(format(karfreitag, 'yyyy-MM-dd'));
  holidays.push(format(ostermontag, 'yyyy-MM-dd'));
  holidays.push(format(himmelfahrt, 'yyyy-MM-dd'));
  holidays.push(format(pfingstmontag, 'yyyy-MM-dd'));
  holidays.push(format(fronleichnam, 'yyyy-MM-dd'));

  return holidays;
};

export const calculateWorkingDaysWithHolidays = (startDate: string | Date, endDate: string | Date): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (start > end) return 0;

  let days = 0;
  let curr = new Date(start);

  // Cache holidays for the years involved
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  let holidays = getHolidays(startYear);
  if (endYear !== startYear) {
    holidays = [...holidays, ...getHolidays(endYear)];
  }

  while (curr <= end) {
    const dateStr = format(curr, 'yyyy-MM-dd');
    if (!isWeekend(curr) && !holidays.includes(dateStr)) {
      days++;
    }
    curr.setDate(curr.getDate() + 1);
  }
  return days;
};

// --- GRACE PERIOD LOGIC (2 Working Days) ---

/**
 * Calculates the cutoff date for retrospective entries (2 working days grace period).
 * Weekends are skipped.
 * Example:
 * Today = Wednesday (Grace: Tue, Mon) -> Cutoff is Monday (entries before Monday are late).
 * Today = Monday (Grace: Fri, Thu) -> Cutoff is Thursday (entries before Thursday are late).
 */
export const getGracePeriodDate = (today: Date = new Date()): Date => {
  let daysToGoBack = 2;
  let currentDate = new Date(today);

  // Reset to midnight for correct comparison
  currentDate.setHours(0, 0, 0, 0);

  // Simply subtract working days
  while (daysToGoBack > 0) {
    currentDate.setDate(currentDate.getDate() - 1);
    // If it's a weekend, don't count it as a "Grace Day", just skip over it
    // But we still moved back. Wait.
    // Logic: We grant 2 *working days* of grace.
    // If today is Mon.
    // Back 1 day -> Sun (Skip). Back 1 day -> Sat (Skip). Back 1 day -> Fri (Count 1).
    // Back 1 day -> Thu (Count 2).
    // So valid range is [Thu, Fri, Sat, Sun, Mon].
    // Cutoff is Thu. Anything < Thu is Late.

    // Check if the day we landed on is weekend
    if (isWeekend(currentDate)) {
      // It's a weekend, we don't count this day decrement.
      // So we effectively just skipped it.
      continue;
    }
    daysToGoBack--;
  }

  return currentDate;
};

