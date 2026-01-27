import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from './supabaseClient';
import { TimeEntry, DailyLog, UserAbsence, UserSettings } from '../types';
import { formatDuration, calculateDurationInMinutes, formatMinutesToDecimal, calculateOverlapInMinutes } from './utils/timeUtils';
import { getLocalISOString, getDailyTargetForDate } from './dataService';

// --- Types ---
export interface ExportData {
    userId: string;
    userDisplayName: string;
    entries: TimeEntry[];
    dailyLogs: DailyLog[];
    absences: UserAbsence[];
    yearAbsenceEntries: TimeEntry[];
    historyEntries: TimeEntry[];
    historyAbsences: UserAbsence[];
    employmentStartDate?: string;
    initialBalance: number;
    settings: UserSettings;
}

export type ExportType = 'projects' | 'attendance' | 'monthly_report';

// --- Fetch Data ---
export const fetchExportData = async (userId: string, startDate: string, endDate: string): Promise<ExportData> => {
    // 1. Fetch User Profile for Display Name & Settings
    const { data: userData, error: userError } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (userError || !userData) throw new Error(`User not found: ${userError?.message}`);

    // 2. Fetch Time Entries
    const { data: entriesData } = await supabase
        .from('time_entries')
        .select('*')
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate);

    // 3. Fetch Daily Logs
    const { data: logsData } = await supabase
        .from('daily_logs')
        .select('*')
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate);

    // 4. Fetch Absences (Whole Year for Stats)
    const yearStart = `${new Date(startDate).getFullYear()}-01-01`;
    const yearEnd = `${new Date(startDate).getFullYear()}-12-31`;

    const { data: absData } = await supabase
        .from('user_absences')
        .select('*')
        .eq('user_id', userId)
        .lte('start_date', yearEnd)
        .gte('end_date', yearStart);

    // 5. Fetch Absence Entries (Whole Year for Stats - Legacy/Daily Entry Absences)
    const { data: yearEntriesData } = await supabase
        .from('time_entries')
        .select('*')
        .eq('user_id', userId)
        .gte('date', yearStart)
        .lte('date', yearEnd)
        .in('type', ['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay', 'special_holiday']);

    // 6. INJECT VIRTUAL ENTRIES (24.12. / 31.12.) - Mirroring dataService logic
    const entryList = (entriesData as TimeEntry[]) || [];
    const requestedStart = new Date(startDate);
    const requestedEnd = new Date(endDate);
    const yearsToCheck = new Set<number>();
    let yC = new Date(requestedStart);
    while (yC <= requestedEnd) {
        yearsToCheck.add(yC.getFullYear());
        yC.setDate(yC.getDate() + 10); // jump 10 days
    }

    yearsToCheck.forEach(year => {
        [24, 31].forEach(day => {
            const dateStr = `${year}-12-${day}`;
            const d = new Date(dateStr);
            const dow = d.getDay();
            // Only Mo-Fr
            if (dow >= 1 && dow <= 5) {
                // Check if already covered by physical entry of type special_holiday
                const exists = entryList.some(e => e.date === dateStr && e.type === 'special_holiday');
                if (!exists) {
                    // Check if data range covers this date (optimization)
                    const dateMs = new Date(dateStr).getTime();
                    if (dateMs >= requestedStart.getTime() && dateMs <= requestedEnd.getTime()) {
                        entryList.push({
                            id: `virtual-${dateStr}-special-export`,
                            user_id: userId,
                            date: dateStr,
                            client_name: 'Sonderurlaub',
                            type: 'special_holiday',
                            hours: getDailyTargetForDate(dateStr, userData.target_hours), // Use calculated target (halved)
                            note: 'Automatisch: ½ Tag Sonderurlaub',
                            created_at: new Date().toISOString(),
                            start_time: '',
                            end_time: ''
                        });
                    }
                }
            }
        });
    });

    // 7. FETCH HISTORY DATA (For Cumulative Balance)
    let historyStart = userData.employment_start_date;

    if (!historyStart) {
        // Fallback: Find the very first entry for this user
        const { data: firstEntry } = await supabase
            .from('time_entries')
            .select('date')
            .eq('user_id', userId)
            .order('date', { ascending: true })
            .limit(1)
            .single();

        if (firstEntry) {
            historyStart = firstEntry.date;
        } else {
            historyStart = startDate; // No history, start from report start
        }
    }

    // Fetch all entries from historyStart to endDate
    const { data: histEntriesData } = await supabase
        .from('time_entries')
        .select('*')
        .eq('user_id', userId)
        .gte('date', historyStart)
        .lte('date', endDate);

    const { data: histAbsData } = await supabase
        .from('user_absences')
        .select('*')
        .eq('user_id', userId)
        .gte('end_date', historyStart)
        .lte('start_date', endDate); // Overlap check simplified

    let historyEntries = (histEntriesData as TimeEntry[]) || [];
    const historyAbsences = (histAbsData as UserAbsence[]) || [];

    // Inject virtuals into history
    const histStartObj = new Date(historyStart);
    const histEndObj = new Date(endDate);
    const histYears = new Set<number>();
    let hY = new Date(histStartObj);
    while (hY <= histEndObj) {
        histYears.add(hY.getFullYear());
        hY.setDate(hY.getDate() + 100); // lighter step
    }
    histYears.add(histEndObj.getFullYear());

    histYears.forEach(year => {
        [24, 31].forEach(day => {
            const dateStr = `${year}-12-${day}`;
            const d = new Date(dateStr);
            const dow = d.getDay();
            if (dow >= 1 && dow <= 5) {
                const exists = historyEntries.some(e => e.date === dateStr && e.type === 'special_holiday');
                if (!exists) {
                    if (dateStr >= historyStart && dateStr <= endDate) {
                        historyEntries.push({
                            id: `virtual-hist-${dateStr}`,
                            user_id: userId,
                            date: dateStr,
                            client_name: 'Sonderurlaub',
                            type: 'special_holiday',
                            hours: getDailyTargetForDate(dateStr, userData.target_hours),
                            note: 'Automatisch',
                            created_at: new Date().toISOString(),
                            start_time: '',
                            end_time: ''
                        });
                    }
                }
            }
        });
    });


    return {
        userId,
        userDisplayName: userData.display_name,
        entries: entryList,
        dailyLogs: (logsData as DailyLog[]) || [],
        absences: (absData as UserAbsence[]) || [],
        yearAbsenceEntries: (yearEntriesData as TimeEntry[]) || [],
        historyEntries,
        historyAbsences,
        employmentStartDate: historyStart,
        initialBalance: userData.initial_overtime_balance || 0,
        settings: userData as UserSettings
    };
};

// --- Helper: Calculate Duration from Log ---
const calculateDuration = (log: any) => {
    if (!log) return 0;
    if (log.segments && log.segments.length > 0) {
        let totalMs = 0;
        log.segments.forEach((seg: any) => {
            if (seg.type === 'work' && seg.start && seg.end) {
                const start = new Date(`1970-01-01T${seg.start}`);
                const end = new Date(`1970-01-01T${seg.end}`);
                const diff = end.getTime() - start.getTime();
                if (diff > 0) totalMs += diff;
            }
        });
        return totalMs / (1000 * 60 * 60);
    }
    if (!log.start_time || !log.end_time) return 0;
    const start = new Date(`1970-01-01T${log.start_time}`);
    const end = new Date(`1970-01-01T${log.end_time}`);
    let diffMs = end.getTime() - start.getTime();
    if (log.break_start && log.break_end) {
        const bStart = new Date(`1970-01-01T${log.break_start}`);
        const bEnd = new Date(`1970-01-01T${log.break_end}`);
        const breakDiff = bEnd.getTime() - bStart.getTime();
        if (breakDiff > 0) diffMs -= breakDiff;
    }
    return Math.max(0, diffMs / (1000 * 60 * 60));
};

// --- Generate Project PDF ---
export const generateProjectPdfBlob = (data: ExportData, startDate: string, endDate: string): Blob => {
    const { entries, absences, settings, userDisplayName } = data;
    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    let combinedExportData = entries.filter(e => {
        const d = new Date(e.date);
        return d >= start && d <= end;
    });

    if (absences && absences.length > 0) {
        absences.forEach(abs => {
            let current = new Date(abs.start_date);
            const absEnd = new Date(abs.end_date);
            current.setHours(0, 0, 0, 0);
            absEnd.setHours(0, 0, 0, 0);

            while (current <= absEnd) {
                if (current >= start && current <= end) {
                    const dateStr = getLocalISOString(current);
                    let targetHours = 0;

                    if (!['unpaid', 'sick_child', 'sick_pay'].includes(abs.type)) {
                        targetHours = getDailyTargetForDate(dateStr, settings.target_hours);
                    }
                    const labelMap: Record<string, string> = {
                        'vacation': 'Urlaub',
                        'sick': 'Krank',
                        'holiday': 'Feiertag',
                        'unpaid': 'Unbezahlt',
                        'sick_child': 'Kind krank',
                        'sick_pay': 'Krankengeld'
                    };
                    const absenceEntry: TimeEntry = {
                        id: `abs-export-${abs.id}-${dateStr}`,
                        user_id: abs.user_id,
                        date: dateStr,
                        client_name: labelMap[abs.type] || 'Abwesend',
                        hours: targetHours,
                        type: abs.type,
                        created_at: new Date().toISOString(),
                        isAbsence: true,
                        note: abs.note,
                        start_time: '',
                        end_time: ''
                    };
                    combinedExportData.push(absenceEntry);
                }
                current.setDate(current.getDate() + 1);
            }
        });
    }

    if (combinedExportData.length === 0) {
        // Return mostly empty PDF or handle upstream? 
        // For batch export, we might still want a file saying "No Data" or just skip it.
        // Let's generate a basic PDF saying "No Data".
        const doc = new jsPDF('l', 'mm', 'a4');
        doc.text(`Keine Projektdaten für ${userDisplayName} im Zeitraum ${startDate} - ${endDate}`, 10, 20);
        return doc.output('blob');
    }

    const daysMap: Record<string, typeof entries> = {};
    combinedExportData.forEach(e => {
        if (!daysMap[e.date]) daysMap[e.date] = [];
        daysMap[e.date].push(e);
    });

    Object.values(daysMap).forEach(list => list.sort((a, b) => {
        if (a.isAbsence && !b.isAbsence) return -1;
        if (!a.isAbsence && b.isAbsence) return 1;
        return (a.start_time || '').localeCompare(b.start_time || '');
    }));

    const sortedDates = Object.keys(daysMap).sort();

    const doc = new jsPDF('l', 'mm', 'a4');
    const pageWidth = 297;
    const pageHeight = 210;
    const halfWidth = pageWidth / 2;

    const drawDay = (dateStr: string, dayEntries: typeof entries, offsetX: number) => {
        const dateObj = new Date(dateStr);
        const formattedDate = dateObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

        const marginX = 10;
        const startY = 20;
        const contentWidth = halfWidth - (marginX * 2);

        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text(`Monteur: ${userDisplayName}`, offsetX + marginX, startY);
        doc.text(formattedDate, offsetX + halfWidth - marginX, startY, { align: 'right' });

        const tableData = dayEntries.map(e => {
            let durationMin = calculateDurationInMinutes(e.start_time || '', e.end_time || '', 0);

            // Deduct Overlaps with BREAKS
            if (e.type !== 'break') {
                const breaks = dayEntries.filter(b => b.type === 'break');
                breaks.forEach(b => {
                    const overlap = calculateOverlapInMinutes(e.start_time || '', e.end_time || '', b.start_time || '', b.end_time || '');
                    durationMin -= overlap;
                });
                durationMin = Math.max(0, durationMin);
            }

            // Check for paid absence types with 0 duration
            const paidAbsenceTypes = ['vacation', 'sick', 'holiday', 'special_holiday'];
            if (durationMin === 0 && paidAbsenceTypes.includes(e.type || '')) {
                // Use daily target hours
                const targetHours = getDailyTargetForDate(e.date, settings.target_hours);
                durationMin = targetHours * 60;
            }

            let hoursStr = formatMinutesToDecimal(durationMin);
            let label = e.client_name;

            if (e.type === 'emergency_service' && e.surcharge) {
                const totalMin = durationMin * (1 + e.surcharge / 100);
                hoursStr = formatMinutesToDecimal(totalMin);
                label = `Notdienst / ${e.client_name} (+${e.surcharge}%)`;
            }

            // [UPDATED] Add Order Number
            if (e.order_number) {
                label += ` #${e.order_number}`;
            }

            // [UPDATED] Add Note on new line
            if (e.note) {
                label += `\n${e.note}`;
            }

            // Hide hours for Break entries as requested
            if (e.type === 'break') {
                hoursStr = '';
            }

            return [
                e.start_time || '-', // Von
                e.end_time || '-',   // Bis
                label,
                hoursStr
            ];
        });

        const minRows = 12;
        for (let i = tableData.length; i < minRows; i++) tableData.push(['', '', '', '']);

        autoTable(doc, {
            startY: startY + 5,
            margin: { left: offsetX + marginX, right: pageWidth - (offsetX + contentWidth + marginX) },
            tableWidth: contentWidth,
            head: [['Von', 'Bis', 'Baustelle - Tätigkeit', 'Std']],
            body: tableData,
            theme: 'grid',
            styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0], cellPadding: 1.5, overflow: 'linebreak' }, // Enabled linebreak
            headStyles: { fillColor: [50, 50, 50], textColor: [255, 255, 255], fontStyle: 'bold', lineWidth: 0.2, lineColor: [0, 0, 0] },
            columnStyles: {
                0: { cellWidth: 20, halign: 'center' }, // Von
                1: { cellWidth: 20, halign: 'center' }, // Bis
                2: { cellWidth: 'auto' },
                3: { cellWidth: 20, halign: 'right' }
            },
            didParseCell: function (data) {
                const cellText = Array.isArray(data.cell.raw) ? data.cell.raw.join('') : String(data.cell.raw);
                if (cellText === 'Pause' && data.section === 'body') {
                    data.cell.styles.textColor = [150, 150, 150];
                }
            }
            // [REMOVED] didDrawCell logic for Notes (now in content)
        });

        // @ts-ignore
        const finalY = doc.lastAutoTable.finalY;
        const totalMinutes = dayEntries.reduce((acc, curr) => {
            if (curr.type === 'break') return acc;

            let dur = calculateDurationInMinutes(curr.start_time || '', curr.end_time || '', 0);

            // Deduct Overlaps with BREAKS
            const breaks = dayEntries.filter(b => b.type === 'break');
            breaks.forEach(b => {
                const overlap = calculateOverlapInMinutes(curr.start_time || '', curr.end_time || '', b.start_time || '', b.end_time || '');
                dur -= overlap;
            });
            dur = Math.max(0, dur);

            // FIX: Use Target for Absences if 0
            const paidAbsenceTypes = ['vacation', 'sick', 'holiday', 'special_holiday'];
            if (dur === 0 && paidAbsenceTypes.includes(curr.type || '')) {
                const target = getDailyTargetForDate(curr.date, settings.target_hours);
                dur = target * 60;
            }

            if (curr.type === 'emergency_service' && curr.surcharge) {
                dur = dur * (1 + curr.surcharge / 100);
            }
            return acc + dur;
        }, 0);

        doc.setLineWidth(0.3);
        doc.rect(offsetX + marginX, finalY, contentWidth, 8);
        doc.setFont("helvetica", "normal");
        doc.text("Gesamtstunden (Verrechenbar)", offsetX + marginX + 2, finalY + 5.5);
        doc.setFont("helvetica", "bold");
        doc.text(formatMinutesToDecimal(totalMinutes), offsetX + contentWidth - 2, finalY + 5.5, { align: 'right' });
    };

    for (let i = 0; i < sortedDates.length; i += 2) {
        if (i > 0) doc.addPage();
        drawDay(sortedDates[i], daysMap[sortedDates[i]], 0);
        doc.setDrawColor(150, 150, 150);
        doc.setLineDashPattern([1, 1], 0);
        doc.line(halfWidth, 10, halfWidth, pageHeight - 10);
        doc.setLineDashPattern([], 0);
        doc.setDrawColor(0, 0, 0);
        if (i + 1 < sortedDates.length) {
            drawDay(sortedDates[i + 1], daysMap[sortedDates[i + 1]], halfWidth);
        }
    }

    return doc.output('blob');
};

// --- Generate Attendance PDF ---
export const generateAttendancePdfBlob = (data: ExportData, startDate: string, endDate: string): Blob => {
    const { entries, dailyLogs, absences, settings, userDisplayName } = data;

    const logsMap = new Map<string, DailyLog>(dailyLogs.map(l => [l.date, l]));
    const absMap = new Map<string, UserAbsence>();
    absences.forEach(a => {
        let cur = new Date(a.start_date);
        const end = new Date(a.end_date);
        while (cur <= end) {
            absMap.set(getLocalISOString(cur), a);
            cur.setDate(cur.getDate() + 1);
        }
    });
    const breaksMap = new Map<string, any[]>();
    entries.filter(e => e.type === 'break').forEach(e => {
        if (!breaksMap.has(e.date)) breaksMap.set(e.date, []);
        breaksMap.get(e.date)?.push(e);
    });

    const doc = new jsPDF('p', 'mm', 'a4');
    const margin = 15;

    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Stundennachweis (Anwesenheit)", margin, 20);
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text(`Mitarbeiter: ${userDisplayName}`, margin, 30);
    doc.text(`Zeitraum: ${new Date(startDate).toLocaleDateString('de-DE')} - ${new Date(endDate).toLocaleDateString('de-DE')}`, margin, 36);

    const tableBody = [];
    let totalTarget = 0;
    let totalActual = 0;

    let currDate = new Date(startDate);
    const endObj = new Date(endDate);

    while (currDate <= endObj) {
        const dateStr = getLocalISOString(currDate);
        const dateDisplay = currDate.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' });

        const log = logsMap.get(dateStr);
        const abs = absMap.get(dateStr);
        const dayBreaks = breaksMap.get(dateStr) || [];
        const target = getDailyTargetForDate(dateStr, settings.target_hours);

        let startEndStr = '-';
        let pauseStr = '';
        let actual = 0;

        const breakDuration = dayBreaks.reduce((sum: number, e: any) => sum + e.hours, 0);

        if (log) {
            actual = calculateDuration(log);
            if (log.segments && log.segments.length > 0) {
                const workSegs = log.segments.filter((s: any) => s.type === 'work');
                startEndStr = workSegs.map((s: any) => {
                    let str = `${s.start}-${s.end}`;
                    if (s.note) str += ` ${s.note}`;
                    return str;
                }).join(', ');
            } else {
                if (log.start_time && log.end_time) startEndStr = `${log.start_time}-${log.end_time}`;
            }
        } else if (abs) {
            if (!['unpaid', 'sick_child', 'sick_pay'].includes(abs.type)) actual = target;
            let typeLabel = '';
            if (abs.type === 'vacation') typeLabel = 'Urlaub';
            else if (abs.type === 'sick') typeLabel = 'Krank';
            else if (abs.type === 'holiday') typeLabel = 'Feiertag';
            else if (abs.type === 'sick_child') typeLabel = 'Kind krank';
            else if (abs.type === 'sick_pay') typeLabel = 'Krankengeld';
            else typeLabel = 'Unbezahlt';
            startEndStr = typeLabel.toUpperCase();
        }

        if (dayBreaks.length > 0) {
            const breakTimes = dayBreaks.map((e: any) => e.start_time && e.end_time ? `${e.start_time}-${e.end_time}` : `${e.hours}h`).join(', ');
            pauseStr = pauseStr ? `${pauseStr}, ${breakTimes}` : breakTimes;
        }

        actual = Math.max(0, actual - breakDuration);

        if (target > 0 || log || abs) {
            totalTarget += target;
            totalActual += actual;
            const diff = actual - target;

            tableBody.push([
                dateDisplay,
                formatDuration(target),
                startEndStr,
                pauseStr || '-',
                actual > 0 ? formatDuration(actual) : '-',
                diff === 0 ? '0:00' : (diff > 0 ? `+${formatDuration(diff)}` : formatDuration(diff))
            ]);
        }

        currDate.setDate(currDate.getDate() + 1);
    }

    autoTable(doc, {
        startY: 45,
        margin: { left: margin, right: margin },
        head: [['Datum', 'Soll', 'Zeitraum / Bemerkung', 'Pause', 'Ist (Netto)', 'Diff']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [20, 184, 166], textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: {
            0: { cellWidth: 22 },
            1: { cellWidth: 12, halign: 'right' },
            2: { cellWidth: 'auto' },
            3: { cellWidth: 25 },
            4: { cellWidth: 20, halign: 'right', fontStyle: 'bold' },
            5: { cellWidth: 18, halign: 'right' }
        },
        foot: [[
            'Gesamt:',
            formatDuration(totalTarget),
            '',
            '',
            formatDuration(totalActual),
            formatDuration(totalActual - totalTarget)
        ]],
        footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'right' }
    });

    return doc.output('blob');
};

// --- Generate Monthly Report PDF (Gesamtliste) ---
export const generateMonthlyReportPdfBlob = (data: ExportData, startDate: string, endDate: string): Blob => {
    const { entries, absences, yearAbsenceEntries, settings, userDisplayName } = data;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const year = start.getFullYear();

    // --- Statistics Calculations ---

    // 1. Monthly Target & Actual
    let monthlyTarget = 0;
    let monthlyActual = 0;
    let monthlyDifference = 0;

    // Helper calculateAbsenceCredits (Simplified version of AnalysisPage logic)
    const calculateCredits = (dateStr: string) => {
        // Check if day is a paid absence
        const abs = absences.find(a => dateStr >= a.start_date && dateStr <= a.end_date && ['vacation', 'sick', 'holiday'].includes(a.type));
        if (abs) return getDailyTargetForDate(dateStr, settings.target_hours);
        // Check local entries as fallback (legacy) - INCLUDE special_holiday for virtual logic matching
        const entryAbs = entries.find(e => e.date === dateStr && ['vacation', 'sick', 'holiday', 'special_holiday'].includes(e.type || ''));
        if (entryAbs) return getDailyTargetForDate(dateStr, settings.target_hours);
        return 0;
    };

    const absenceTypes = ['vacation', 'sick', 'holiday', 'special_holiday', 'sick_child', 'sick_pay', 'unpaid'];

    let curr = new Date(start);
    while (curr <= end) {
        const dateStr = getLocalISOString(curr);
        const dailyTarget = getDailyTargetForDate(dateStr, settings.target_hours);

        // Find Absence
        // Find Absence
        const abs = absences.find(a => dateStr >= a.start_date && dateStr <= a.end_date);
        const isUnpaid = (abs && ['unpaid', 'sick_child', 'sick_pay'].includes(abs.type)) ||
            entries.some(e => e.date === dateStr && ['unpaid', 'sick_child', 'sick_pay'].includes(e.type || ''));

        if (!isUnpaid) {
            monthlyTarget += dailyTarget;
        }

        // Actuals: Projects + Credits
        // INCLUDE overtime_reduction to match App "Project Hours"
        const dayBreaks = entries.filter(e => e.date === dateStr && e.type === 'break');
        const dayEntries = entries.filter(e => e.date === dateStr && e.type !== 'break' && !absenceTypes.includes(e.type || ''));
        const dayHours = dayEntries.reduce((sum, e) => {
            let h = e.hours;
            // Fallback if hours is NaN (e.g. from old malformed entry)
            if (isNaN(h)) {
                h = calculateDurationInMinutes(e.start_time || '', e.end_time || '', 0) / 60;
            }

            // Deduct Overlaps
            dayBreaks.forEach(b => {
                const overlap = calculateOverlapInMinutes(e.start_time || '', e.end_time || '', b.start_time || '', b.end_time || '');
                h -= (overlap / 60);
            });
            h = Math.max(0, h);

            if (e.type === 'emergency_service' && e.surcharge) {
                return sum + (h * (1 + e.surcharge / 100));
            }
            return sum + h;
        }, 0);
        const credits = calculateCredits(dateStr);

        monthlyActual += (dayHours + credits);

        curr.setDate(curr.getDate() + 1);
    }
    monthlyDifference = monthlyActual - monthlyTarget;

    // 2. Yearly Stats (Vacation, Sick) - Based on fetched yearly absences AND yearly entries
    let vacationDays = 0;
    let sickDays = 0;
    let sickChildDays = 0;
    let sickPayDays = 0;
    let unpaidDays = 0;

    // Iterate over the whole year for absence stats
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    // We iterate days to count explicitly
    let yCurr = new Date(yearStart);
    // Optimization: Pre-calculate map of absences for faster lookup
    const absMap = new Map<string, UserAbsence>();
    absences.forEach(a => {
        let ac = new Date(a.start_date);
        const ae = new Date(a.end_date);
        while (ac <= ae) {
            absMap.set(getLocalISOString(ac), a);
            ac.setDate(ac.getDate() + 1);
        }
    });

    // Map for entries
    const entryAbsMap = new Map<string, TimeEntry>();
    if (yearAbsenceEntries) {
        yearAbsenceEntries.forEach(e => {
            entryAbsMap.set(e.date, e);
        });
    }

    while (yCurr <= yearEnd) {
        const dStr = getLocalISOString(yCurr);
        const dailyTarget = getDailyTargetForDate(dStr, settings.target_hours);

        if (dailyTarget > 0) {
            const abs = absMap.get(dStr);
            const entryAbs = entryAbsMap.get(dStr);

            // Prioritize absence (if both exist, usually absence planner is more authoritative, but entry is fine too)
            // If they conflict, strict absences logic usually wins in UI.
            const type = abs ? abs.type : (entryAbs ? entryAbs.type : null);

            if (type) {
                if (type === 'vacation') vacationDays++;
                if (type === 'sick') sickDays++;
                if (type === 'sick_child') sickChildDays++;
                if (type === 'sick_pay') sickPayDays++;
                if (type === 'unpaid') unpaidDays++;
            }
        }
        yCurr.setDate(yCurr.getDate() + 1);
    }

    const yearlyAllowance = settings.vacation_days_yearly || 30;
    const remainingVacation = yearlyAllowance - vacationDays;


    // --- PDF Generation ---
    const doc = new jsPDF('p', 'mm', 'a4'); // Portrait
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 15;

    // Header
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("Monatsbericht (Gesamt)", margin, 20);

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text(`Mitarbeiter: ${userDisplayName}`, margin, 30);
    doc.text(`Monat: ${start.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}`, margin, 36);

    // Filter entries for the month
    const monthEntries = entries.filter(e => {
        const d = new Date(e.date);
        return d >= start && d <= end;
    });

    // Merge with absences for the list view
    // Fix hours for special_holiday (virtual entries have 0 hours initially)
    const combinedList: any[] = monthEntries.map(e => {
        if (e.type === 'special_holiday') {
            // Credit for special holiday is the daily target of that day (which is already halved by getDailyTargetForDate)
            return { ...e, hours: getDailyTargetForDate(e.date, settings.target_hours) };
        }
        return e;
    });

    // Add absences as synthetic entries if not already present as entries
    absences.forEach(abs => {
        let ac = new Date(abs.start_date);
        const ae = new Date(abs.end_date);
        while (ac <= ae) {
            if (ac >= start && ac <= end) {
                const dStr = getLocalISOString(ac);
                // Check if already covered by an entry (e.g. legacy)
                if (!monthEntries.some(e => e.date === dStr && e.isAbsence)) {
                    const labelMap: Record<string, string> = {
                        'vacation': 'Urlaub',
                        'sick': 'Krank',
                        'holiday': 'Feiertag',
                        'unpaid': 'Unbezahlt',
                        'sick_child': 'Kind krank',
                        'sick_pay': 'Krankengeld',
                        'special_holiday': 'Sonderurlaub'
                    };
                    combinedList.push({
                        date: dStr,
                        client_name: labelMap[abs.type] || 'Abwesend',
                        hours: (!['unpaid', 'sick_child', 'sick_pay'].includes(abs.type) ? getDailyTargetForDate(dStr, settings.target_hours) : 0),
                        note: abs.note,
                        isAbsence: true, // Only true absences from planner
                        type: abs.type
                    });
                }
            }
            ac.setDate(ac.getDate() + 1);
        }
    });

    // Group by Date
    const daysMap: Record<string, any[]> = {};
    combinedList.forEach(e => {
        if (!daysMap[e.date]) daysMap[e.date] = [];
        daysMap[e.date].push(e);
    });

    const sortedDates = Object.keys(daysMap).sort();

    // Flatten list with Headers
    const tableBody: any[] = [];

    sortedDates.forEach((dateStr, index) => {
        const dateObj = new Date(dateStr);
        const dateDisplay = dateObj.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

        const dayItems = daysMap[dateStr];
        // Sort items
        dayItems.sort((a, b) => {
            if (a.isAbsence && !b.isAbsence) return -1;
            return (a.start_time || '').localeCompare(b.start_time || '');
        });

        // Add Spacer Row if not first item
        if (index > 0) {
            tableBody.push([{
                content: '',
                colSpan: 4,
                styles: {
                    fillColor: [255, 255, 255],
                    lineWidth: 0,
                    minCellHeight: 2
                }
            }]);
        }

        // Calculate Day Total for Header (using minutes) - With Overlap Deduction
        const dayTotalMinutes = dayItems.reduce((sum: number, item: any) => {
            if (item.type !== 'break' && !item.isAbsence) {
                let duration = calculateDurationInMinutes(item.start_time || '', item.end_time || '', 0);

                // Deduct Overlaps with BREAKS (New Logic)
                const breaks = dayItems.filter((b: any) => b.type === 'break');
                breaks.forEach((b: any) => {
                    const overlap = calculateOverlapInMinutes(item.start_time || '', item.end_time || '', b.start_time || '', b.end_time || '');
                    duration -= overlap;
                });
                duration = Math.max(0, duration);

                if (item.type === 'emergency_service' && item.surcharge) {
                    duration = duration * (1 + item.surcharge / 100);
                }
                return sum + duration;
            }
            if (item.isAbsence && item.hours) {
                // For absences (vacation etc.) we take hours * 60
                return sum + (item.hours * 60);
            }
            return sum;
        }, 0);

        // Header Row
        tableBody.push([{
            content: dateDisplay,
            colSpan: 2,
            styles: { fillColor: [240, 240, 240], fontStyle: 'bold', lineWidth: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 } }
        }, {
            content: dayTotalMinutes > 0 ? formatMinutesToDecimal(dayTotalMinutes) : '-',
            styles: { fillColor: [240, 240, 240], fontStyle: 'bold', halign: 'right', lineWidth: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 } }
        }, {
            content: '',
            styles: { fillColor: [240, 240, 240], lineWidth: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 } }
        }]);

        dayItems.forEach((item) => {
            const isBreak = item.type === 'break';
            let label = item.client_name;
            let hoursStr = '-';
            let durationMin = 0;

            if (isBreak) {
                // Calculate break duration
                durationMin = calculateDurationInMinutes(item.start_time || '', item.end_time || '', 0);
                label += ` (${durationMin} Min Pause)`;
                hoursStr = '-'; // Explicitly show - for pause hours as requested
            } else if (item.isAbsence) {
                // Absence hours
                hoursStr = formatDuration(item.hours);
            } else {
                // Work entry
                durationMin = calculateDurationInMinutes(item.start_time || '', item.end_time || '', 0);

                // Deduct Overlaps with BREAKS (New Logic)
                const breaks = dayItems.filter(b => b.type === 'break');
                breaks.forEach(b => {
                    const overlap = calculateOverlapInMinutes(item.start_time || '', item.end_time || '', b.start_time || '', b.end_time || '');
                    durationMin -= overlap;
                });
                durationMin = Math.max(0, durationMin);

                if (item.type === 'emergency_service' && item.surcharge) {
                    const totalMin = durationMin * (1 + item.surcharge / 100);
                    hoursStr = `${formatMinutesToDecimal(totalMin)}`;
                    label = `Notdienst / ${item.client_name} (+${item.surcharge}%)`;
                    // Show calculation in note
                    const noteAddition = `Basis: ${formatMinutesToDecimal(durationMin)}h + ${item.surcharge}%`;
                    item.note = item.note ? `${item.note} | ${noteAddition}` : noteAddition;
                } else {
                    hoursStr = formatMinutesToDecimal(durationMin);
                }
            }

            tableBody.push([
                item.start_time ? `${item.start_time}${item.end_time ? ' - ' + item.end_time : ''}` : '', // Time Range Column
                { content: label, order_number: item.order_number }, // Object for cell
                { content: hoursStr, styles: { halign: 'right', textColor: isBreak ? [150, 150, 150] : [0, 0, 0] } },
                item.note || ''
            ]);
        });
    });

    autoTable(doc, {
        startY: 45,
        margin: { left: margin, right: margin },
        head: [['Zeit', 'Projekt / Tätigkeit', 'Std', 'Notiz']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185], textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: {
            0: { cellWidth: 30 }, // Zeit
            1: { cellWidth: 'auto' }, // Project
            2: { cellWidth: 20, halign: 'right' }, // Hours
            3: { cellWidth: 50, fontStyle: 'italic', textColor: [100, 100, 100] } // Note
        },
        didParseCell: function (data) {
            // Handle Object in Column 1 logic safely (default autoTable barely handles objects well without custom draw)
            if (data.column.index === 1 && typeof data.cell.raw === 'object' && data.cell.raw !== null) {
                data.cell.text = [(data.cell.raw as any).content]; // Set text for calculation
            }
        },
        didDrawCell: function (data) {
            // Add Order Number in Gray next to Project Name
            if (data.section === 'body' && data.column.index === 1) {
                const rawObj = data.cell.raw as any;
                if (rawObj && rawObj.content && rawObj.order_number) {
                    const textWidth = doc.getTextWidth(rawObj.content);
                    const startX = data.cell.x + data.cell.padding('left') + textWidth + 2; // 2mm spacer

                    doc.setFont("helvetica", "normal");
                    doc.setTextColor(150, 150, 150); // Gray
                    doc.setFontSize(10); // Match table font

                    // Align
                    const textPos = (data.cell as any).textPos;
                    const textY = textPos ? textPos.y : (data.cell.y + (data.cell.height / 2) + 1.5);

                    doc.text(`#${rawObj.order_number}`, startX, textY);
                }
            }
        }
    });

    // @ts-ignore
    let finalY = doc.lastAutoTable.finalY + 10;

    // --- Cumulative Balance Calculation ---
    const historyStartStr = data.employmentStartDate || `${new Date().getFullYear()}-01-01`;
    // If we have history data, calculate total balance
    let cumulativeBalance = 0;

    if (data.historyEntries && data.historyAbsences) {
        const hStart = new Date(historyStartStr);
        const hEnd = new Date(endDate);

        // Helper for history credits
        const getHistoryCredits = (dStr: string) => {
            const hAbs = data.historyAbsences.find(a => dStr >= a.start_date && dStr <= a.end_date && ['vacation', 'sick', 'holiday'].includes(a.type));
            if (hAbs) return getDailyTargetForDate(dStr, settings.target_hours);
            // Check legacy local entries in history
            const entryAbs = data.historyEntries.find(e => e.date === dStr && ['vacation', 'sick', 'holiday', 'special_holiday'].includes(e.type || ''));
            if (entryAbs) return getDailyTargetForDate(dStr, settings.target_hours);
            return 0;
        };

        const hCurr = new Date(hStart);
        while (hCurr <= hEnd) {
            const dStr = getLocalISOString(hCurr);
            let dTarget = getDailyTargetForDate(dStr, settings.target_hours);

            // Check Unpaid
            const hAbs = data.historyAbsences.find(a => dStr >= a.start_date && dStr <= a.end_date);
            const isUnpaid = (hAbs && ['unpaid', 'sick_child', 'sick_pay'].includes(hAbs.type)) ||
                data.historyEntries.some(e => e.date === dStr && ['unpaid', 'sick_child', 'sick_pay'].includes(e.type || ''));

            if (isUnpaid) dTarget = 0;

            const dEntries = data.historyEntries.filter(e => e.date === dStr && e.type !== 'break' && !absenceTypes.includes(e.type || ''));
            const dHours = dEntries.reduce((s, e) => s + e.hours, 0);
            const dCredits = getHistoryCredits(dStr);

            cumulativeBalance += (dHours + dCredits - dTarget);
            hCurr.setDate(hCurr.getDate() + 1);
        }
    }

    const initialBalance = data.initialBalance || 0;
    const finalTotalBalance = initialBalance + cumulativeBalance;
    const calcStartFormatted = new Date(historyStartStr).toLocaleDateString('de-DE');


    // Check if we need a new page for summary
    const SUMMARY_HEIGHT = 85;
    if (finalY > pageHeight - (SUMMARY_HEIGHT + 10)) {
        doc.addPage();
        finalY = 20;
    }

    // --- Summary Block ---
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.1);
    doc.rect(margin, finalY, pageWidth - (margin * 2), SUMMARY_HEIGHT);

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Zusammenfassung", margin + 5, finalY + 8);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");

    const leftColX = margin + 5;
    const rightColX = margin + 90;
    let lineH = finalY + 18;
    const gap = 6;

    // Monthly Stats
    doc.text(`Monat Soll:`, leftColX, lineH);
    doc.text(`${monthlyTarget.toFixed(2).replace('.', ',')} h`, leftColX + 65, lineH, { align: 'right' });

    doc.text(`Monat Ist:`, leftColX, lineH + gap);
    doc.text(`${monthlyActual.toFixed(2).replace('.', ',')} h`, leftColX + 65, lineH + gap, { align: 'right' });

    doc.setFont("helvetica", "bold");
    doc.text(`Differenz:`, leftColX, lineH + (gap * 2));
    const diffPrefix = monthlyDifference > 0 ? '+' : '';
    const diffColor = monthlyDifference >= 0 ? [0, 100, 0] : [200, 0, 0];
    doc.setTextColor(diffColor[0], diffColor[1], diffColor[2]);
    doc.text(`${diffPrefix}${Math.abs(monthlyDifference).toFixed(2).replace('.', ',')} h`, leftColX + 65, lineH + (gap * 2), { align: 'right' });
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");

    // Total Stats (New)
    const totalY = lineH + (gap * 4); // Spacer
    doc.text(`Startsaldo (Übertrag):`, leftColX, totalY);
    doc.text(`${initialBalance.toFixed(2).replace('.', ',')} h`, leftColX + 65, totalY, { align: 'right' });

    doc.setFont("helvetica", "bold");
    doc.text(`Gesamtsaldo:`, leftColX, totalY + gap);
    const totalPrefix = finalTotalBalance > 0 ? '+' : '';
    const totalColor = finalTotalBalance >= 0 ? [0, 100, 0] : [200, 0, 0];
    doc.setTextColor(totalColor[0], totalColor[1], totalColor[2]);
    doc.text(`${totalPrefix}${Math.abs(finalTotalBalance).toFixed(2).replace('.', ',')} h`, leftColX + 65, totalY + gap, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");

    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(`(Berechnung ab: ${calcStartFormatted})`, leftColX, totalY + (gap * 2) + 2);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);


    // Yearly Stats
    doc.text(`Urlaubstage (Gesamt):`, rightColX, lineH);
    doc.text(`${yearlyAllowance}`, rightColX + 60, lineH, { align: 'right' });

    doc.text(`Urlaubstage (Genommen):`, rightColX, lineH + gap);
    doc.text(`${vacationDays}`, rightColX + 60, lineH + gap, { align: 'right' });

    doc.setFont("helvetica", "bold");
    doc.text(`Urlaubstage (Rest):`, rightColX, lineH + (gap * 2));
    doc.text(`${remainingVacation}`, rightColX + 60, lineH + (gap * 2), { align: 'right' });
    doc.setFont("helvetica", "normal");

    doc.text(`Krankheitstage (Jahr):`, rightColX, lineH + (gap * 3.5));
    doc.text(`${sickDays}`, rightColX + 60, lineH + (gap * 3.5), { align: 'right' });

    doc.text(`Kind krank (Jahr):`, rightColX, lineH + (gap * 4.5));
    doc.text(`${sickChildDays}`, rightColX + 60, lineH + (gap * 4.5), { align: 'right' });

    doc.text(`Krankengeld (Jahr):`, rightColX, lineH + (gap * 5.5));
    doc.text(`${sickPayDays}`, rightColX + 60, lineH + (gap * 5.5), { align: 'right' });

    doc.text(`Unbezahlt (Jahr):`, rightColX, lineH + (gap * 6.5));
    doc.text(`${unpaidDays}`, rightColX + 60, lineH + (gap * 6.5), { align: 'right' });


    return doc.output('blob');
};
