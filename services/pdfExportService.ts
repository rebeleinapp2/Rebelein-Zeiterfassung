import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from './supabaseClient';
import { TimeEntry, DailyLog, UserAbsence, UserSettings } from '../types';
import { formatDuration } from './utils/timeUtils';
import { getLocalISOString, getDailyTargetForDate } from './dataService';

// --- Types ---
export interface ExportData {
    userId: string;
    userDisplayName: string;
    entries: TimeEntry[];
    dailyLogs: DailyLog[];
    absences: UserAbsence[];
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

    return {
        userId,
        userDisplayName: userData.display_name,
        entries: (entriesData as TimeEntry[]) || [],
        dailyLogs: (logsData as DailyLog[]) || [],
        absences: (absData as UserAbsence[]) || [],
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

        const tableData = dayEntries.map(e => [
            e.start_time || '-',
            e.end_time || '-',
            e.client_name,
            e.hours.toFixed(2).replace('.', ',')
        ]);

        const minRows = 12;
        for (let i = tableData.length; i < minRows; i++) tableData.push(['', '', '', '']);

        autoTable(doc, {
            startY: startY + 5,
            margin: { left: offsetX + marginX, right: pageWidth - (offsetX + contentWidth + marginX) },
            tableWidth: contentWidth,
            head: [['Von', 'Bis', 'Baustelle - Tätigkeit', 'Std']],
            body: tableData,
            theme: 'grid',
            styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0], cellPadding: 1.5 },
            headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', lineWidth: 0.2, lineColor: [0, 0, 0] },
            columnStyles: {
                0: { cellWidth: 15, halign: 'center' },
                1: { cellWidth: 15, halign: 'center' },
                2: { cellWidth: 'auto' },
                3: { cellWidth: 15, halign: 'right' }
            },
            didParseCell: function (data) {
                const cellText = Array.isArray(data.cell.raw) ? data.cell.raw.join('') : String(data.cell.raw);
                if (cellText === 'Pause' && data.section === 'body') {
                    data.cell.styles.textColor = [150, 150, 150];
                }
            },
            didDrawCell: function (data) {
                // Add Note next to Client Name (Column Index 2)
                if (data.section === 'body' && data.column.index === 2) {
                    const entry = dayEntries[data.row.index];
                    if (entry && entry.note) {
                        const clientNameWidth = doc.getTextWidth(entry.client_name);
                        const startX = data.cell.x + data.cell.padding('left') + clientNameWidth + 2; // 2mm padding

                        doc.setFont("helvetica", "normal");
                        doc.setTextColor(150, 150, 150);
                        doc.setFontSize(9); // Match table font size

                        // Align with the text baseline of the cell
                        // @ts-ignore - textPos might be missing
                        const textPos = (data.cell as any).textPos;
                        const textY = textPos ? textPos.y : (data.cell.y + (data.cell.height / 2) + 1);

                        doc.text(entry.note, startX, textY);
                    }
                }
            }
        });

        // @ts-ignore
        const finalY = doc.lastAutoTable.finalY;
        const totalHours = dayEntries.reduce((acc, curr) => (curr.type === 'break' ? acc : acc + curr.hours), 0);

        doc.setLineWidth(0.3);
        doc.rect(offsetX + marginX, finalY, contentWidth, 8);
        doc.setFont("helvetica", "normal");
        doc.text("Gesamtstunden (Verrechenbar)", offsetX + marginX + 2, finalY + 5.5);
        doc.setFont("helvetica", "bold");
        doc.text(totalHours.toFixed(2).replace('.', ','), offsetX + contentWidth - 2, finalY + 5.5, { align: 'right' });
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
    const { entries, absences, settings, userDisplayName } = data;
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
        // Check local entries as fallback (legacy)
        const entryAbs = entries.find(e => e.date === dateStr && ['vacation', 'sick', 'holiday'].includes(e.type || ''));
        if (entryAbs) return getDailyTargetForDate(dateStr, settings.target_hours);
        return 0;
    };

    let curr = new Date(start);
    while (curr <= end) {
        const dateStr = getLocalISOString(curr);
        const dailyTarget = getDailyTargetForDate(dateStr, settings.target_hours);

        // Find Absence
        // Find Absence
        const abs = absences.find(a => dateStr >= a.start_date && dateStr <= a.end_date);
        const isUnpaid = (abs && ['unpaid', 'sick_child', 'sick_pay'].includes(abs.type)) || entries.some(e => e.date === dateStr && e.type === 'unpaid');

        if (!isUnpaid) {
            monthlyTarget += dailyTarget;
        }

        // Actuals: Projects + Credits
        const dayEntries = entries.filter(e => e.date === dateStr && e.type !== 'break' && e.type !== 'overtime_reduction');
        const dayHours = dayEntries.reduce((sum, e) => sum + e.hours, 0);
        const credits = calculateCredits(dateStr);

        monthlyActual += (dayHours + credits);

        curr.setDate(curr.getDate() + 1);
    }
    monthlyDifference = monthlyActual - monthlyTarget;

    // 2. Yearly Stats (Vacation, Sick) - Based on fetched yearly absences
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

    while (yCurr <= yearEnd) {
        const dStr = getLocalISOString(yCurr);
        const dailyTarget = getDailyTargetForDate(dStr, settings.target_hours);

        if (dailyTarget > 0) {
            const abs = absMap.get(dStr);
            if (abs) {
                if (abs.type === 'vacation') vacationDays++;
                if (abs.type === 'sick') sickDays++;
                if (abs.type === 'sick_child') sickChildDays++;
                if (abs.type === 'sick_pay') sickPayDays++;
                if (abs.type === 'unpaid') unpaidDays++;
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
    const combinedList: any[] = [...monthEntries];

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
                        'sick_pay': 'Krankengeld'
                    };
                    combinedList.push({
                        date: dStr,
                        client_name: labelMap[abs.type] || 'Abwesend',
                        hours: (!['unpaid', 'sick_child', 'sick_pay'].includes(abs.type) ? getDailyTargetForDate(dStr, settings.target_hours) : 0),
                        note: abs.note,
                        isAbsence: true,
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
    const tableBody: any[] = [];

    sortedDates.forEach(dateStr => {
        const dateObj = new Date(dateStr);
        const dateDisplay = dateObj.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

        const dayItems = daysMap[dateStr];
        // Sort items
        dayItems.sort((a, b) => {
            if (a.isAbsence && !b.isAbsence) return -1;
            return (a.start_time || '').localeCompare(b.start_time || '');
        });

        dayItems.forEach((item, idx) => {
            const label = item.client_name + (item.type === 'break' ? ' (Pause)' : '');
            const hoursStr = item.hours > 0 ? item.hours.toFixed(2).replace('.', ',') : '-';

            // First row of the day shows the date
            const dCol = idx === 0 ? dateDisplay : '';

            tableBody.push([
                dCol,
                label,
                hoursStr,
                item.note || ''
            ]);
        });
    });

    autoTable(doc, {
        startY: 45,
        margin: { left: margin, right: margin },
        head: [['Datum', 'Projekt / Tätigkeit', 'Std', 'Notiz']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [55, 65, 81], textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: {
            0: { cellWidth: 25, fontStyle: 'bold' },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 15, halign: 'right' },
            3: { cellWidth: 50, fontStyle: 'italic', textColor: [100, 100, 100] }
        },
    });

    // @ts-ignore
    let finalY = doc.lastAutoTable.finalY + 10;

    // Check if we need a new page for summary
    if (finalY > pageHeight - 60) {
        doc.addPage();
        finalY = 20;
    }

    // --- Summary Block ---
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.1);
    doc.rect(margin, finalY, pageWidth - (margin * 2), 55);

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
    doc.text(`${monthlyTarget.toFixed(2).replace('.', ',')} h`, leftColX + 40, lineH, { align: 'right' });

    doc.text(`Monat Ist:`, leftColX, lineH + gap);
    doc.text(`${monthlyActual.toFixed(2).replace('.', ',')} h`, leftColX + 40, lineH + gap, { align: 'right' });

    doc.setFont("helvetica", "bold");
    doc.text(`Differenz:`, leftColX, lineH + (gap * 2));
    const diffPrefix = monthlyDifference > 0 ? '+' : '';
    const diffColor = monthlyDifference >= 0 ? [0, 100, 0] : [200, 0, 0];
    doc.setTextColor(diffColor[0], diffColor[1], diffColor[2]);
    doc.text(`${diffPrefix}${Math.abs(monthlyDifference).toFixed(2).replace('.', ',')} h`, leftColX + 40, lineH + (gap * 2), { align: 'right' });
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");

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
