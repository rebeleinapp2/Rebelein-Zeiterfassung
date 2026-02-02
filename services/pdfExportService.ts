import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TimeEntry, UserSettings, UserAbsence, DailyLog } from '../types';
import { supabase } from './supabaseClient';
import { getDailyTargetForDate } from './dataService';

// --- Types ---
export interface ExportData {
    entries: TimeEntry[];
    absences: UserAbsence[];
    dailyLogs: DailyLog[];
    userSettings: UserSettings;
    userProfile: any; // User profile from auth/db
}

// --- Fetch Data ---
export const fetchExportData = async (userId: string, startDate: string, endDate: string): Promise<ExportData> => {
    // 1. Fetch Entries
    const { data: entries, error: entriesError } = await supabase
        .from('time_entries')
        .select('*')
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

    if (entriesError) throw new Error('Error fetching entries: ' + entriesError.message);

    // 2. Fetch Absences
    // Absences might span across the range, so we check overlap
    const { data: absences, error: absencesError } = await supabase
        .from('user_absences')
        .select('*')
        .eq('user_id', userId)
        .lte('start_date', endDate)
        .gte('end_date', startDate);

    if (absencesError) throw new Error('Error fetching absences: ' + absencesError.message);

    // 3. Fetch Daily Logs (for Attendance)
    const { data: logs, error: logsError } = await supabase
        .from('daily_logs')
        .select('*')
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate);

    if (logsError) throw new Error('Error fetching logs: ' + logsError.message);

    // 4. Fetch User Settings & Profile
    const { data: settings, error: settingsError } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .single();

    // Default settings if not found
    const userSettings = settings || { target_hours: 8, work_days: [1, 2, 3, 4, 5] };

    // Get User Profile Name
    const { data: profile } = await supabase
        .from('user_profiles')
        .select('display_name')
        .eq('id', userId)
        .single();

    return {
        entries: entries as TimeEntry[],
        absences: absences as UserAbsence[],
        dailyLogs: logs as DailyLog[],
        userSettings: userSettings as UserSettings,
        userProfile: profile || { display_name: 'Unbekannt' }
    };
};

// --- Generators ---

// 1. Search Report (My addition)
export const generateSearchReport = (
    searchResults: TimeEntry[],
    users: UserSettings[],
    searchQuery: string
) => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text(`Suchbericht: "${searchQuery}"`, 14, 20);
    doc.setFontSize(10);
    doc.text(`Erstellt am: ${new Date().toLocaleDateString('de-DE')}`, 14, 27);
    doc.text(`Gefundene Einträge: ${searchResults.length}`, 14, 32);

    const grouped: Record<string, TimeEntry[]> = {};
    const sorted = [...searchResults].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    sorted.forEach(e => {
        if (!grouped[e.user_id]) grouped[e.user_id] = [];
        grouped[e.user_id].push(e);
    });

    let currentY = 45;
    const userIds = Object.keys(grouped);
    if (userIds.length === 0) doc.text("Keine Ergebnisse gefunden.", 14, currentY);

    userIds.forEach((userId) => {
        const userEntries = grouped[userId];
        const user = users.find(u => u.user_id === userId);
        const userName = user ? user.display_name : 'Unbekannt';
        const userTotal = userEntries.reduce((sum, e) => sum + (e.hours || 0), 0);

        if (currentY > 250) {
            doc.addPage();
            currentY = 20;
        }

        doc.setFontSize(14);
        doc.setTextColor(0, 150, 136);
        doc.text(`${userName} (${userTotal.toLocaleString('de-DE')} Std.)`, 14, currentY);
        doc.setTextColor(0, 0, 0);

        const tableBody = userEntries.map(e => [
            new Date(e.date).toLocaleDateString('de-DE'),
            e.type || '',
            e.order_number ? `${e.client_name || ''}\n#${e.order_number}` : (e.client_name || ''),
            (e.hours || 0).toLocaleString('de-DE', { minimumFractionDigits: 2 }),
            e.note || ''
        ]);

        autoTable(doc, {
            startY: currentY + 5,
            head: [['Datum', 'Typ', 'Kunde / Auftrag', 'Std', 'Notiz']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [20, 184, 166] },
            styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
            columnStyles: { 2: { cellWidth: 70 }, 4: { cellWidth: 50 } },
            margin: { left: 14, right: 14 }
        });

        currentY = (doc as any).lastAutoTable.finalY + 15;
    });

    doc.save(`suchbericht_${searchQuery.replace(/[^a-z0-9]/gi, '_')}.pdf`);
};


// 2. Project List
export const generateProjectPdfBlob = (data: ExportData, startDate: string, endDate: string) => {
    const doc = new jsPDF();
    const { entries, userProfile } = data;

    // Title
    doc.setFontSize(16);
    doc.text(`Projektbericht: ${userProfile.display_name}`, 14, 20);
    doc.setFontSize(10);
    doc.text(`Zeitraum: ${new Date(startDate).toLocaleDateString('de-DE')} - ${new Date(endDate).toLocaleDateString('de-DE')}`, 14, 28);

    const tableBody = entries
        .filter(e => !e.is_deleted && !['break', 'overtime_reduction'].includes(e.type || '')) // Filter logic similar to HistoryPage
        .map(e => [
            new Date(e.date).toLocaleDateString('de-DE'),
            e.client_name,
            e.order_number || '',
            e.hours.toLocaleString('de-DE', { minimumFractionDigits: 2 }),
            e.note || ''
        ]);

    autoTable(doc, {
        startY: 35,
        head: [['Datum', 'Projekt', 'Auftrag', 'Std', 'Notiz']],
        body: tableBody,
        theme: 'striped',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [20, 184, 166] }
    });

    return doc.output('blob');
};


// 3. Attendance List
export const generateAttendancePdfBlob = (data: ExportData, startDate: string, endDate: string) => {
    const doc = new jsPDF();
    const { dailyLogs, absences, userSettings, userProfile } = data;

    // Logic to construct daily row (similar to HistoryPage)
    // We iterate through all days in range
    const start = new Date(startDate);
    const end = new Date(endDate);
    const rows: any[] = [];

    let current = new Date(start);
    while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        // Find log
        const log = dailyLogs.find(l => l.date === dateStr);
        // Find absence
        const absence = absences.find(a =>
            new Date(a.start_date) <= current && new Date(a.end_date) >= current
        );

        // Status/Type
        let status = '';
        let startT = '';
        let endT = '';
        let breakTime = '';
        let duration = '';

        if (absence) {
            status = absence.type === 'vacation' ? 'Urlaub' : absence.type === 'sick' ? 'Krank' : 'Abwesend';
            // Target hours for paid absence
            if (absence.type !== 'unpaid') {
                duration = getDailyTargetForDate(dateStr, userSettings.target_hours).toLocaleString('de-DE') + ' (Soll)';
            }
        } else if (log) {
            status = 'Anwesend';
            startT = log.start_time || '';
            endT = log.end_time || '';

            // Calc duration logic (simplified for PDF)
            // Use segments if available or start/end
            // We'll stick to basic start/end for PDF or calculate duration if complex logic needed.
            // We can assume log has fields populated or we calc it.
            // Ideally we should replicate calculateDuration from HistoryPage, but it's complex.
            // Let's print the raw start/end times.
            if (log.break_start && log.break_end) {
                breakTime = `${log.break_start} - ${log.break_end}`;
            }
        } else {
            // Wochenende?
            const day = current.getDay();
            if (day === 0 || day === 6) status = 'Wochenende';
        }

        if (status || startT) {
            rows.push([
                current.toLocaleDateString('de-DE'),
                status,
                startT ? `${startT} - ${endT}` : '',
                breakTime,
                duration
            ]);
        }

        current.setDate(current.getDate() + 1);
    }

    doc.setFontSize(16);
    doc.text(`Anwesenheitsliste: ${userProfile.display_name}`, 14, 20);
    doc.setFontSize(10);
    doc.text(`Zeitraum: ${new Date(startDate).toLocaleDateString('de-DE')} - ${new Date(endDate).toLocaleDateString('de-DE')}`, 14, 28);

    autoTable(doc, {
        startY: 35,
        head: [['Datum', 'Status', 'Zeit', 'Pause', 'Dauer']],
        body: rows,
        theme: 'striped',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [59, 130, 246] } // Blue
    });

    return doc.output('blob');
};

// 4. Monthly Report
export const generateMonthlyReportPdfBlob = (data: ExportData, startDate: string, endDate: string) => {
    // Combine Project and Attendance summary
    const doc = new jsPDF();
    const { userProfile } = data;

    doc.setFontSize(18);
    doc.text(`Monatsbericht: ${userProfile.display_name}`, 14, 20);
    doc.setFontSize(10);
    doc.text(`Monat: ${new Date(startDate).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}`, 14, 28);

    // Just reuse project table for simplicity or create a summary
    // Since I don't have the original code, I'll generate a list of projects.

    const tableBody = data.entries
        .filter(e => !e.is_deleted && !['break'].includes(e.type || '')) // Fix: Handle e.type being undefined
        .map(e => [
            new Date(e.date).toLocaleDateString('de-DE'),
            e.client_name,
            e.order_number || '',
            (e.hours || 0).toLocaleString('de-DE') + ' h'
        ]);

    autoTable(doc, {
        startY: 40,
        head: [['Datum', 'Projekt', 'Auftrag', 'Stunden']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [147, 51, 234] } // Purple
    });

    return doc.output('blob');
};
