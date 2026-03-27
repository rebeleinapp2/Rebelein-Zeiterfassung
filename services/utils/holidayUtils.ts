
export interface Holiday {
    id: string;
    name: string;
    date: Date;
    fixed: boolean;
    day?: number;
    month?: number;
}

/**
 * Calculates Easter Sunday for a given year using Gauss's formula.
 */
export const getEasterSunday = (year: number): Date => {
    const a = year % 19;
    const b = year % 4;
    const c = year % 7;
    const k = Math.floor(year / 100);
    const p = Math.floor((8 * k + 13) / 25);
    const q = Math.floor(k / 4);
    const M = (15 + k - p - q) % 30;
    const N = (4 + k - q) % 7;
    const d = (19 * a + M) % 30;
    const e = (2 * b + 4 * c + 6 * d + N) % 7;
    const day = 22 + d + e;

    if (day <= 31) {
        return new Date(year, 2, day); // March is 2
    } else {
        // Special case for April 26th and April 25th
        let actualDay = day - 31;
        if (actualDay === 26) actualDay = 19;
        if (actualDay === 25 && d === 28 && e === 6 && a > 10) actualDay = 18;
        return new Date(year, 3, actualDay); // April is 3
    }
};

/**
 * Returns all public holidays in Bavaria for a given year.
 */
export const getBavarianHolidays = (year: number): Holiday[] => {
    const easterSunday = getEasterSunday(year);

    const addDays = (date: Date, days: number): Date => {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    };

    const holidays: Holiday[] = [
        { id: 'neujahr', name: 'Neujahr', date: new Date(year, 0, 1), fixed: true, day: 1, month: 0 },
        { id: 'h3k', name: 'Heilige Drei Könige', date: new Date(year, 0, 6), fixed: true, day: 6, month: 0 },
        { id: 'karfreitag', name: 'Karfreitag', date: addDays(easterSunday, -2), fixed: false },
        { id: 'ostermontag', name: 'Ostermontag', date: addDays(easterSunday, 1), fixed: false },
        { id: 'tag_der_arbeit', name: 'Tag der Arbeit', date: new Date(year, 4, 1), fixed: true, day: 1, month: 4 },
        { id: 'christi_himmelfahrt', name: 'Christi Himmelfahrt', date: addDays(easterSunday, 39), fixed: false },
        { id: 'pfingstmontag', name: 'Pfingstmontag', date: addDays(easterSunday, 50), fixed: false },
        { id: 'fronleichnam', name: 'Fronleichnam', date: addDays(easterSunday, 60), fixed: false },
        { id: 'friedensfest', name: 'Augsburger Friedensfest', date: new Date(year, 7, 8), fixed: true, day: 8, month: 7 },
        { id: 'mariae_himmelfahrt', name: 'Mariä Himmelfahrt', date: new Date(year, 7, 15), fixed: true, day: 15, month: 7 },
        { id: 'tag_der_deutschen_einheit', name: 'Tag der Deutschen Einheit', date: new Date(year, 9, 3), fixed: true, day: 3, month: 9 },
        { id: 'allerheiligen', name: 'Allerheiligen', date: new Date(year, 10, 1), fixed: true, day: 1, month: 10 },
        { id: 'weihnachten_1', name: '1. Weihnachtstag', date: new Date(year, 11, 25), fixed: true, day: 25, month: 11 },
        { id: 'weihnachten_2', name: '2. Weihnachtstag', date: new Date(year, 11, 26), fixed: true, day: 26, month: 11 },
    ];

    return holidays;
};

export const DEFAULT_HOLIDAY_CONFIG: Record<string, boolean> = {
    'neujahr': true,
    'h3k': true,
    'karfreitag': true,
    'ostermontag': true,
    'tag_der_arbeit': true,
    'christi_himmelfahrt': true,
    'pfingstmontag': true,
    'fronleichnam': true,
    'friedensfest': false, // Nur in Augsburg
    'mariae_himmelfahrt': true, // In katholischen Gemeinden
    'tag_der_deutschen_einheit': true,
    'allerheiligen': true,
    'weihnachten_1': true,
    'weihnachten_2': true,
};
