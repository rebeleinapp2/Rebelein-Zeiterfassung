import React, { useMemo, useState, useEffect } from 'react';
import { useTimeEntries, useSettings, useDailyLogs, useAbsences, getDailyTargetForDate, getLocalISOString } from '../services/dataService';
import { GlassCard, GlassButton, GlassInput } from '../components/GlassCard';
import { Trash2, FileDown, X, Edit2, Save, CalendarDays, Briefcase, Clock, ChevronLeft, ChevronRight, CheckCircle, Calendar, UserCheck, List, FileText, StickyNote, Coffee, Lock, Hourglass, Building2, Building, Warehouse, Car, Palmtree, Stethoscope, Ban, PartyPopper, TrendingDown, AlertTriangle, Check, Siren, History as HistoryIcon, ThumbsUp, ThumbsDown, RefreshCw, ShieldAlert, Hash } from 'lucide-react';
import GlassDatePicker from '../components/GlassDatePicker';
import { useToast } from '../components/Toast';
import { TimeEntry, DailyLog, UserAbsence } from '../types';
import { supabase } from '../services/supabaseClient';
import { formatDuration } from '../services/utils/timeUtils';
import { SubmissionTimer } from '../components/SubmissionTimer';


const ENTRY_TYPES_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
    'work': { label: 'Arbeit', icon: Briefcase, color: 'text-primary' },
    'break': { label: 'Pause', icon: Coffee, color: 'text-orange-400' },
    'company': { label: 'Firma / Lager', icon: Building2, color: 'text-blue-400' },
    'office': { label: 'Büro', icon: Building, color: 'text-purple-400' },
    'warehouse': { label: 'Lager', icon: Warehouse, color: 'text-amber-400' },
    'car': { label: 'Firmenauto Pflege', icon: Car, color: 'text-slate-400' },
    'vacation': { label: 'Urlaub', icon: Palmtree, color: 'text-purple-400' },
    'sick': { label: 'Krank', icon: Stethoscope, color: 'text-red-400' },
    'holiday': { label: 'Feiertag', icon: PartyPopper, color: 'text-blue-400' },
    'unpaid': { label: 'Unbezahlt', icon: Ban, color: 'text-slate-500' },
    'sick_child': { label: 'Kind krank', icon: Stethoscope, color: 'text-red-400' },
    'sick_pay': { label: 'Krankengeld', icon: TrendingDown, color: 'text-rose-400' },
    'overtime_reduction': { label: 'Überstunden-Abbau', icon: TrendingDown, color: 'text-pink-400' },
    'emergency_service': { label: 'Notdienst', icon: Siren, color: 'text-rose-400' }
};

const HistoryPage: React.FC = () => {
    const { showToast } = useToast();
    const { entries, deleteEntry, updateEntry, markAsSubmitted, loading, lockedDays, entryHistory, fetchEntryHistory, addEntry } = useTimeEntries();
    const { settings } = useSettings();
    const { dailyLogs, fetchDailyLogs } = useDailyLogs();
    const { absences, deleteAbsenceDay, fetchAbsences } = useAbsences();

    const [viewDate, setViewDate] = useState(new Date());
    const [viewMode, setViewMode] = useState<'projects' | 'attendance'>('projects');



    const [showPdfModal, setShowPdfModal] = useState(false);
    // Monats-basierte Abgabe: Standard = letzter Nicht-Holiday-Eintrag
    const [submitMonth, setSubmitMonth] = useState(new Date());
    // Für PDF Export brauchen wir weiterhin Start/End-Datum
    const [startDate, setStartDate] = useState(getLocalISOString());
    const [endDate, setEndDate] = useState(getLocalISOString());
    const [activePdfDatePicker, setActivePdfDatePicker] = useState<'start' | 'end' | null>(null);

    const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
    const [editForm, setEditForm] = useState<{
        date: string;
        client_name: string;
        hours: string;
        start_time: string;
        end_time: string;
        note: string;
        order_number: string;
    }>({ date: '', client_name: '', hours: '', start_time: '', end_time: '', note: '', order_number: '' });

    // NEU: State für das Löschen-Modal (statt window.confirm)
    const [entryToDelete, setEntryToDelete] = useState<TimeEntry | null>(null);

    // NEU: Change Request Modal (für abgegebene Einträge)
    const [changeRequestModal, setChangeRequestModal] = useState<{ isOpen: boolean; reason: string }>({ isOpen: false, reason: '' });
    const [isSubmittingChangeRequest, setIsSubmittingChangeRequest] = useState(false);

    // History Modal State
    const [historyModal, setHistoryModal] = useState<{ isOpen: boolean; entryId: string | null }>({ isOpen: false, entryId: null });
    const [rejectionNote, setRejectionNote] = useState('');
    const [rejectingHistoryId, setRejectingHistoryId] = useState<string | null>(null);

    const handleConfirmChange = async (historyId: string, entryId: string) => {
        const { error } = await supabase.rpc('handle_entry_history_response', {
            p_entry_id: entryId,
            p_action: 'confirm'
        });

        if (error) showToast("Fehler beim Bestätigen: " + error.message, "error");
        else {
            fetchEntryHistory(entryId);
        }
    };

    const handleRejectChange = async (historyId: string) => {
        // historyId lookup to get entryId? 
        // We have entryId in historyModal state!
        if (!historyModal.entryId) return;

        if (!rejectionNote.trim()) {
            showToast("Bitte Begründung angeben.", "warning");
            return;
        }

        const { error } = await supabase.rpc('handle_entry_history_response', {
            p_entry_id: historyModal.entryId,
            p_action: 'reject',
            p_note: rejectionNote
        });

        if (error) showToast("Fehler beim Ablehnen: " + error.message, "error");
        else {
            setRejectingHistoryId(null);
            setRejectionNote('');
            if (historyModal.entryId) fetchEntryHistory(historyModal.entryId);
        }
    };

    useEffect(() => {
        fetchDailyLogs();
    }, [fetchDailyLogs]);

    const nextMonth = () => {
        setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
    };

    const prevMonth = () => {
        setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
    };



    // --- Data Filtering ---
    const currentMonthData = useMemo(() => {
        const targetMonth = viewDate.getMonth();
        const targetYear = viewDate.getFullYear();

        // 1. Filter existing entries by Month
        let combinedEntries = entries.filter(e => {
            const d = new Date(e.date);
            return d.getMonth() === targetMonth && d.getFullYear() === targetYear;
        });

        // 2. Process Absences and merge them as pseudo-entries
        if (absences && absences.length > 0) {
            absences.forEach(abs => {
                let current = new Date(abs.start_date);
                const end = new Date(abs.end_date);

                while (current <= end) {
                    if (current.getMonth() === targetMonth && current.getFullYear() === targetYear) {
                        const dateStr = current.toISOString().split('T')[0];
                        // Use helper to get target hours
                        let targetHours = 0;
                        if (abs.type !== 'unpaid') {
                            targetHours = getDailyTargetForDate(dateStr, settings.target_hours);
                        }

                        const absenceEntry: TimeEntry = {
                            id: `abs-${abs.id}-${dateStr}`,
                            user_id: abs.user_id,
                            date: dateStr,
                            client_name: abs.type === 'vacation' ? 'Urlaub' : abs.type === 'sick' ? 'Krank' : abs.type === 'holiday' ? 'Feiertag' : 'Unbezahlt',
                            hours: targetHours,
                            type: abs.type,
                            created_at: new Date().toISOString(),
                            isAbsence: true,
                            note: abs.note,
                            submitted: abs.submitted
                        };
                        combinedEntries.push(absenceEntry);
                    }
                    current.setDate(current.getDate() + 1);
                }
            });
        }

        const groups: Record<string, typeof entries> = {};
        combinedEntries.forEach(entry => {
            const dayKey = entry.date;
            if (!groups[dayKey]) groups[dayKey] = [];
            groups[dayKey].push(entry);
        });

        Object.keys(groups).forEach(key => {
            groups[key].sort((a, b) => {
                if (a.isAbsence && !b.isAbsence) return -1;
                if (!a.isAbsence && b.isAbsence) return 1;
                return (a.start_time || '00:00').localeCompare(b.start_time || '00:00');
            });
        });

        return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
    }, [entries, absences, viewDate, settings.target_hours]);

    // COMBINED ATTENDANCE VIEW (Includes DailyLogs, Absences AND Project Breaks)
    const currentMonthAttendance = useMemo(() => {
        const targetMonth = viewDate.getMonth();
        const targetYear = viewDate.getFullYear();
        const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

        // Map existing logs by date
        const logsMap = new Map<string, DailyLog>(dailyLogs.map(l => [l.date, l]));

        // Map absences
        const absenceMap = new Map<string, UserAbsence>();
        if (absences) {
            absences.forEach(abs => {
                let cur = new Date(abs.start_date);
                const end = new Date(abs.end_date);
                while (cur <= end) {
                    const ds = cur.toISOString().split('T')[0];
                    absenceMap.set(ds, abs);
                    cur.setDate(cur.getDate() + 1);
                }
            });
        }

        // Map Project Breaks (entries with type 'break')
        const projectBreaksMap = new Map<string, TimeEntry[]>();
        entries.forEach(e => {
            const d = new Date(e.date);
            if (d.getMonth() === targetMonth && d.getFullYear() === targetYear && e.type === 'break') {
                if (!projectBreaksMap.has(e.date)) projectBreaksMap.set(e.date, []);
                projectBreaksMap.get(e.date)?.push(e);
            }
        });

        const combinedList: { date: string; log?: DailyLog; absence?: UserAbsence; projectBreaks?: TimeEntry[] }[] = [];

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(targetYear, targetMonth, d);
            const dateStr = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

            const log = logsMap.get(dateStr);
            const absence = absenceMap.get(dateStr);
            const projectBreaks = projectBreaksMap.get(dateStr);

            if (log || absence || (projectBreaks && projectBreaks.length > 0)) {
                combinedList.push({
                    date: dateStr,
                    log,
                    absence,
                    projectBreaks
                });
            }
        }

        return combinedList.sort((a, b) => b.date.localeCompare(a.date));
    }, [dailyLogs, absences, entries, viewDate]);

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

    const monthlyTotalHours = useMemo(() => {
        if (viewMode === 'projects') {
            return currentMonthData.reduce((acc, [_, dayEntries]) => {
                return acc + dayEntries.reduce((sum, e) => {
                    if (e.is_deleted) return sum;
                    if (e.type === 'break' || e.type === 'overtime_reduction') return sum;

                    let hours = 0;

                    // Priority: Server Calculated Values
                    if (e.calc_duration_minutes !== undefined) {
                        hours = Math.abs(e.calc_duration_minutes) / 60;

                        // Add Surcharge if available (Server calculated or Fallback)
                        if (e.type === 'emergency_service') {
                            if (e.calc_surcharge_hours !== undefined) {
                                hours += e.calc_surcharge_hours;
                            } else if (e.surcharge) {
                                hours = hours * (1 + e.surcharge / 100);
                            }
                        }
                    } else {
                        // Fallback: Client Calculation
                        hours = e.hours; // types.ts check: 'hours' is the field
                        if (e.type === 'emergency_service' && e.surcharge) {
                            hours = hours * (1 + e.surcharge / 100);
                        }
                    }

                    return sum + hours;
                }, 0);
            }, 0);
        } else {
            // For attendance view summary
            return currentMonthAttendance.reduce((acc, item) => {
                let hours = 0;
                // Get raw duration (Start to End)
                if (item.log) hours += calculateDuration(item.log);

                // Or get target hours if it's a paid absence without log
                if (item.absence && item.absence.type !== 'unpaid' && !item.log) {
                    hours += getDailyTargetForDate(item.date, settings.target_hours);
                }

                // SUBTRACT Project Breaks
                const projectBreaks = item.projectBreaks || [];
                const breakHours = projectBreaks.reduce((sum, b) => sum + b.hours, 0);

                // Net Working Time
                return acc + Math.max(0, hours - breakHours);
            }, 0);
        }
    }, [currentMonthData, currentMonthAttendance, viewMode, settings.target_hours]);

    // --- Edit Logic ---
    const handleEditClick = (entry: TimeEntry) => {
        setEditingEntry(entry);
        setEditForm({
            date: entry.date,
            client_name: entry.client_name,
            hours: entry.hours.toString(),
            start_time: entry.start_time || '',
            end_time: entry.end_time || '',
            note: entry.note || '',
            order_number: entry.order_number || ''
        });
    };

    const handleHoursChange = (value: string) => {
        let updates: any = { hours: value };
        const hours = parseFloat(value.replace(',', '.'));

        if (!isNaN(hours) && editForm.start_time) {
            const [h, m] = editForm.start_time.split(':').map(Number);
            const startMins = h * 60 + m;
            const endMins = startMins + Math.round(hours * 60);
            const endH = Math.floor(endMins / 60) % 24;
            const endM = endMins % 60;
            const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

            updates.end_time = endTime;
        }

        setEditForm(prev => ({ ...prev, ...updates }));
    };

    const handleSaveEdit = async () => {
        if (!editingEntry) return;

        const updates: Partial<TimeEntry> = {
            date: editForm.date,
            client_name: editForm.client_name,
            hours: parseFloat(editForm.hours.replace(',', '.')),
            start_time: editForm.start_time || undefined,
            end_time: editForm.end_time || undefined,
            note: editForm.note || undefined,
            order_number: editForm.order_number || undefined
        };

        // NEU: Wenn der Eintrag bereits abgegeben ist, Änderungsantrag erstellen
        if (editingEntry.submitted) {
            setChangeRequestModal({ isOpen: true, reason: '' });
            return; // Warte auf Begründung im Modal
        }

        await updateEntry(editingEntry.id, updates);
        setEditingEntry(null);
    };

    // NEU: Änderungsantrag absenden
    const submitChangeRequest = async () => {
        if (!editingEntry || !changeRequestModal.reason.trim()) return;

        setIsSubmittingChangeRequest(true);

        const updates = {
            date: editForm.date,
            client_name: editForm.client_name,
            hours: parseFloat(editForm.hours.replace(',', '.')),
            start_time: editForm.start_time || null,
            end_time: editForm.end_time || null,
            note: editForm.note || null,
            order_number: editForm.order_number || null
        };

        const { data: { user } } = await supabase.auth.getUser();

        const { error } = await supabase.from('entry_change_history').insert([{
            entry_id: editingEntry.id,
            changed_by: user?.id,
            reason: changeRequestModal.reason,
            old_values: editingEntry,
            new_values: updates,
            status: 'change_requested'
        }]);

        setIsSubmittingChangeRequest(false);

        if (error) {
            console.error('Error creating change request:', error);
            showToast('Fehler beim Erstellen des Änderungsantrags: ' + error.message, "error");
        } else {
            setChangeRequestModal({ isOpen: false, reason: '' });
            setEditingEntry(null);
            showToast('Änderungsantrag wurde an das Büro gesendet. Die Änderung wird nach Genehmigung wirksam.', "success");
        }
    };

    // --- Delete Logic (Modal based) ---
    const handleDeleteClick = (entry: TimeEntry) => {
        setEntryToDelete(entry);
    };

    const confirmDelete = async () => {
        if (!entryToDelete) return;
        if (entryToDelete.isAbsence) {
            await deleteAbsenceDay(entryToDelete.date, entryToDelete.type!);
        } else {
            await deleteEntry(entryToDelete.id);
        }
        setEntryToDelete(null);
    };

    const getEntryIcon = (type: string | undefined) => {
        switch (type) {
            case 'break': return <Coffee size={12} className="inline mr-1 mb-0.5" />;
            case 'company': return <Building2 size={12} className="inline mr-1 mb-0.5" />;
            case 'office': return <Building size={12} className="inline mr-1 mb-0.5" />;
            case 'warehouse': return <Warehouse size={12} className="inline mr-1 mb-0.5" />;
            case 'car': return <Car size={12} className="inline mr-1 mb-0.5" />;
            case 'vacation': return <Palmtree size={12} className="inline mr-1 mb-0.5" />;
            case 'sick': return <Stethoscope size={12} className="inline mr-1 mb-0.5" />;
            case 'holiday': return <PartyPopper size={12} className="inline mr-1 mb-0.5" />;
            case 'unpaid': return <Ban size={12} className="inline mr-1 mb-0.5" />;
            case 'overtime_reduction': return <TrendingDown size={12} className="inline mr-1 mb-0.5" />;
            case 'emergency_service': return <Siren size={12} className="inline mr-1 mb-0.5" />;
            default: return null;
        }
    };

    const getEntryStyle = (entry: TimeEntry) => {
        if (entry.is_deleted) return 'border-red-500/20 bg-red-900/5 text-red-200/50 italic opacity-60 line-through decoration-red-500/30';

        if (entry.isAbsence) {
            switch (entry.type) {
                case 'vacation': return `border-purple-500/20 bg-purple-900/10 text-purple-200 ${entry.submitted ? 'ring-1 ring-emerald-500/50' : ''}`;
                case 'sick': return `border-red-500/20 bg-red-900/10 text-red-200 ${entry.submitted ? 'ring-1 ring-emerald-500/50' : ''}`;
                case 'holiday': return `border-blue-500/20 bg-blue-900/10 text-blue-200 ${entry.submitted ? 'ring-1 ring-emerald-500/50' : ''}`;
                case 'unpaid': return `border-border bg-card text-muted-foreground ${entry.submitted ? 'ring-1 ring-emerald-500/50' : ''}`;
                default: return `border-border bg-muted ${entry.submitted ? 'ring-1 ring-emerald-500/50' : ''}`;
            }
        }
        if (entry.type === 'emergency_service') return 'border-rose-500/20 bg-rose-900/10 text-rose-200';
        if (entry.rejected_at) return 'border-red-500/50 bg-red-900/20 text-red-200 ring-2 ring-red-500/30';

        // Fix: Confirmed takes precedence over Pending Review
        if (entry.confirmed_at) return 'border-emerald-500/20 bg-emerald-900/10 ring-1 ring-emerald-500/50';

        // ALL Pending Reviews (Responsible User OR Late Entry)
        if ((entry.responsible_user_id || entry.late_reason) && !entry.confirmed_at && !entry.rejected_at) {
            return 'border-orange-500/30 bg-orange-900/10 text-orange-200 ring-1 ring-dashed ring-orange-500/50';
        }
        if (entry.submitted) return 'border-emerald-500/20 bg-emerald-900/10';
        switch (entry.type) {
            case 'break': return 'border-orange-500/20 bg-orange-900/10 text-orange-200';
            case 'company': return 'border-blue-500/20 bg-blue-900/10 text-blue-200';
            case 'office': return 'border-purple-500/20 bg-purple-900/10 text-purple-200';
            case 'warehouse': return 'border-amber-500/20 bg-amber-900/10 text-amber-200';
            case 'car': return 'border-border bg-card text-muted-foreground';
            case 'overtime_reduction': return 'border-pink-500/20 bg-pink-900/10 text-pink-200';
            default: return 'md:hover:bg-card transition-colors';
        }
    };


    const handleMarkSubmittedOnly = async () => {
        // Monats-basierte Abgabe
        const monthStart = new Date(submitMonth.getFullYear(), submitMonth.getMonth(), 1);
        const monthEnd = new Date(submitMonth.getFullYear(), submitMonth.getMonth() + 1, 0);
        monthStart.setHours(0, 0, 0, 0);
        monthEnd.setHours(23, 59, 59, 999);

        const startMoment = monthStart.getTime();
        const endMoment = monthEnd.getTime();

        let entriesToProcess = entries.filter(e => {
            const d = new Date(e.date).getTime();
            return d >= startMoment && d <= endMoment && !e.submitted;
        });

        if (entriesToProcess.length === 0) {
            showToast(`Keine offenen Einträge im ${submitMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}.`, "warning");
            return;
        }

        const monthLabel = submitMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

        // Check for blocked entries (rejected or still awaiting peer review)
        const blockedCount = entriesToProcess.filter(e =>
            !e.isAbsence && (
                e.rejected_at ||
                (e.responsible_user_id && !e.confirmed_at)
            )
        ).length;
        if (blockedCount > 0) {
            showToast(`${blockedCount} Einträge sind abgelehnt oder noch in Prüfung und werden NICHT als abgegeben markiert.`, "warning");
        }

        const idsToMark = entriesToProcess
            .filter(e => !e.isAbsence && !e.id.startsWith('virtual-'))
            .filter(e => !e.rejected_at && !(e.responsible_user_id && !e.confirmed_at) && !e.submitted)
            .map(e => e.id);

        if (idsToMark.length > 0) {
            await markAsSubmitted(idsToMark);
        }

        // Handle Absences in the month
        const absenceIds = entriesToProcess
            .filter(e => e.isAbsence && e.id.startsWith('abs-') && !e.submitted)
            .map(e => e.id.split('-')[1])
            .filter((value, index, self) => self.indexOf(value) === index);

        if (absenceIds.length > 0) {
            const { error } = await supabase
                .from('user_absences')
                .update({ submitted: true })
                .in('id', absenceIds);

            if (error) console.error("Error submitting absences:", error);
            else await fetchAbsences();
        }

        showToast(`${idsToMark.length + absenceIds.length} Einträge im ${monthLabel} als abgegeben markiert.`, "success");
        setShowPdfModal(false);
    };

    // --- PDF: Project Report ---
    const generateProjectPDF = async () => {
        try {
            const start = new Date(startDate);
            const end = new Date(endDate);
            // Ensure full day coverage
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);

            const startStr = getLocalISOString(start);
            const endStr = getLocalISOString(end);

            // Verwende den gemeinsamen Export-Service
            // Wir fetchen die Daten neu, um Konsistenz zu gewährleisten und die Logik an einem Ort zu haben.
            // (Alternativ könnte man die lokalen Daten mappen, aber fetchExportData ist robuster)
            const { fetchExportData, generateProjectPdfBlob } = await import('../services/pdfExportService');

            // User ID ist notwendig. Wenn nicht vorhanden (z.B. Fehler), abbrechen.
            // In HistoryPage sehen wir in der Regel die Daten des aktuellen Users.
            // Wir müssen die aktuelle User-ID herausfinden.
            // useTimeEntries liefert 'entries', aber keine user_id direkt.
            // Wir nehmen an, der aktuelle User ist eingeloggt.
            const user = await supabase.auth.getUser();
            const userId = user.data.user?.id;

            if (!userId) {
                showToast("Kein Benutzer gefunden.", "error");
                return;
            }

            const exportData = await fetchExportData(userId, startStr, endStr);
            const blob = generateProjectPdfBlob(exportData, startStr, endStr);

            // Download Blob
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `stundenzettel_projekte_${startStr}_bis_${endStr}.pdf`;
            a.click();
            window.URL.revokeObjectURL(url);

            // Mark submitted Logic (optional, if we want to keep current behavior)
            // Die neue Service-Funktion macht das Markieren nicht automatisch.
            // Wir behalten die lokale Logik bei.
            // Nur echte Projekteinträge als "submitted" markieren, Abwesenheiten sind bereits "final"
            const realEntryIds = exportData.entries.filter(e => !e.isAbsence).map(e => e.id);
            if (realEntryIds.length > 0) {
                await markAsSubmitted(realEntryIds);
            }

            setShowPdfModal(false);

        } catch (error) {
            console.error("PDF Export failed:", error);
            showToast("Fehler beim Exportieren des PDFs.", "error");
        }
    };

    const generateAttendancePDF = async () => {
        try {
            const start = new Date(startDate);
            const end = new Date(endDate);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);

            const startStr = getLocalISOString(start);
            const endStr = getLocalISOString(end);

            const { fetchExportData, generateAttendancePdfBlob } = await import('../services/pdfExportService');

            const user = await supabase.auth.getUser();
            const userId = user.data.user?.id;
            if (!userId) {
                showToast("Kein Benutzer gefunden.", "error");
                return;
            }

            const exportData = await fetchExportData(userId, startStr, endStr);
            const blob = generateAttendancePdfBlob(exportData, startStr, endStr);

            // Download Blob
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `stundenzettel_anwesenheit_${startStr}_bis_${endStr}.pdf`;
            a.click();
            window.URL.revokeObjectURL(url);

            setShowPdfModal(false);

        } catch (error) {
            console.error("Attendance Export failed:", error);
            showToast("Fehler beim Exportieren des Anwesenheits-PDFs.", "error");
        }
    };

    const formatDateDisplay = (isoDate: string) => new Date(isoDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    return (
        <div className="p-6 pb-24 h-full flex flex-col overflow-hidden md:max-w-6xl md:mx-auto w-full">
            <div className="flex flex-col gap-4 mb-4 md:flex-row md:justify-between md:items-center md:mb-6">
                <div className="flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-foreground">Verlauf</h2>
                </div>

                <div className="bg-card/40 backdrop-blur-xl border border-white/10 p-1.5 rounded-2xl flex w-full md:w-auto self-center shadow-xl">
                    <button 
                        onClick={() => setViewMode('projects')} 
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-6 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 ${viewMode === 'projects' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}
                    >
                        <List size={16} /> Projekte
                    </button>
                    <button 
                        onClick={() => setViewMode('attendance')} 
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-6 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 ${viewMode === 'attendance' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}
                    >
                        <UserCheck size={16} /> Anwesenheit
                    </button>
                </div>

                <div className="flex gap-3 justify-between md:justify-end">
                    <div className="flex items-center bg-card/40 backdrop-blur-xl border border-white/10 rounded-2xl p-1 shadow-xl w-full md:w-auto justify-between md:justify-center">
                        <button onClick={prevMonth} className="p-2 hover:bg-white/5 rounded-xl text-foreground transition-colors"><ChevronLeft size={20} /></button>
                        <span className="mx-4 text-sm font-black text-foreground whitespace-nowrap min-w-[140px] text-center uppercase tracking-widest">
                            {viewDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
                        </span>
                        <button onClick={nextMonth} className="p-2 hover:bg-white/5 rounded-xl text-foreground transition-colors"><ChevronRight size={20} /></button>
                    </div>
                    <GlassButton 
                        onClick={() => setShowPdfModal(true)} 
                        className="flex !w-auto !py-2 !px-6"
                        variant="primary"
                    >
                        <Check size={18} /> Abgeben
                    </GlassButton>
                </div>
            </div>

            <div className="mb-6">
                <GlassCard className={`py-3 px-4 flex justify-between items-center border md:p-6 ${viewMode === 'projects' ? 'bg-card border-border' : 'bg-blue-900/20 border-blue-400/30'}`}>
                    <span className="text-sm text-muted-foreground font-medium uppercase tracking-wide md:text-lg">
                        {viewMode === 'projects' ? 'Projektstunden' : 'Anwesenheit (Netto)'} {viewDate.toLocaleDateString('de-DE', { month: 'long' })}
                    </span>
                    <span className={`text-xl font-bold font-mono md:text-3xl ${viewMode === 'projects' ? 'text-teal-300' : 'text-blue-300'}`}>
                        {viewMode === 'projects' ? monthlyTotalHours.toFixed(2).replace('.', ',') : formatDuration(monthlyTotalHours)} h
                    </span>
                </GlassCard>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6 pr-1 -mr-2 pb-12 md:pr-4">
                {/* PROJECTS VIEW */}
                {viewMode === 'projects' && (
                    <>
                        {currentMonthData.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                                <List size={48} className="mb-2 opacity-50" />
                                <p>Keine Projektdaten in diesem Monat</p>
                            </div>
                        )}

                        {currentMonthData.map(([dateStr, dayEntries]) => {
                            const dateObj = new Date(dateStr);
                            const isLocked = lockedDays.includes(dateStr);
                            const dayTotal = dayEntries.reduce((sum, e) => {
                                const isDeleted = e.is_deleted === true;
                                if (isDeleted) return sum; // Filter out deleted entries from total
                                if (e.type === 'break' || e.type === 'overtime_reduction') return sum;
                                let hours = e.hours;
                                if (e.type === 'emergency_service' && e.surcharge) {
                                    hours = hours * (1 + e.surcharge / 100);
                                }
                                return sum + hours;
                            }, 0);
                            const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
                            const allSubmitted = dayEntries.every(e => e.submitted || e.isAbsence || e.is_deleted);

                            return (
                                <div key={dateStr} className="relative md:bg-muted md:p-4 md:rounded-2xl md:border md:border-border">
                                    <div className={`flex items-center justify-between mb-2 px-1 md:px-0 ${allSubmitted ? 'text-emerald-300' : 'text-muted-foreground'}`}>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-sm font-bold md:text-base ${isWeekend ? 'text-red-300/70' : ''}`}>
                                                {dateObj.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                                            </span>
                                            {isLocked && <span title="Tag gesperrt"><Lock size={14} className="text-red-400" /></span>}
                                            {allSubmitted && !dayEntries.every(e => e.isAbsence) && <div className="flex items-center gap-1 text-xs bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30"><CheckCircle size={12} /> <span>Abgegeben</span></div>}
                                            {dayEntries.some(e => e.rejected_at) && <div className="flex items-center gap-1 text-xs bg-red-500/20 px-2 py-0.5 rounded-full border border-red-500/30 text-red-300"><AlertTriangle size={12} /> <span>Abgelehnt</span></div>}
                                            {dayEntries.some(e => (e.responsible_user_id || e.late_reason) && !e.rejected_at && !e.confirmed_at) && <div className="flex items-center gap-1 text-xs bg-orange-500/20 px-2 py-0.5 rounded-full border border-orange-500/30 text-orange-300"><Hourglass size={12} /> <span>In Prüfung</span></div>}
                                        </div>
                                        <span className="text-xs font-mono bg-muted px-2 py-1 rounded text-muted-foreground md:text-sm md:bg-card">{dayTotal.toFixed(2)} h</span>
                                    </div>

                                    <div className="space-y-2 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-4 md:space-y-0">
                                        {dayEntries.map(entry => (
                                            <div
        key={entry.id}
        className="relative w-full overflow-hidden rounded-2xl p-4 bg-slate-900/30 backdrop-blur-xl border border-white/10 shadow-lg transition-all duration-500 hover:scale-[1.01] hover:shadow-2xl hover:border-white/20 group"
    >
            {editingEntry?.id === entry.id && !entry.isAbsence ? (
                /* EDIT MODE (Kept similar but styled for the card) */
                <div className="w-full space-y-3">
                    <div className="flex gap-3">
                        <div className="flex-1 relative bg-black/40 rounded-xl border border-white/10 shadow-inner p-1">
                            <span className="absolute top-0.5 left-2 text-[8px] text-muted-foreground uppercase font-black tracking-widest opacity-60">Kunde</span>
                            <input type="text" value={editForm.client_name} onChange={e => setEditForm({ ...editForm, client_name: e.target.value })} className="w-full bg-transparent border-none text-foreground text-sm h-10 pt-3 px-2 focus:outline-none" />
                        </div>
                        <div className="w-24 relative bg-black/40 rounded-xl border border-white/10 shadow-inner p-1">
                            <span className="absolute top-0.5 left-2 text-[8px] text-muted-foreground uppercase font-black tracking-widest opacity-60">Nr.</span>
                            <input type="text" value={editForm.order_number} onChange={e => setEditForm({ ...editForm, order_number: e.target.value })} className="w-full bg-transparent border-none text-foreground font-mono text-sm h-10 pt-3 px-2 focus:outline-none" />
                        </div>
                    </div>
                    <div className="flex gap-2 items-center">
                        <div className="flex-1 flex gap-2 items-center bg-black/40 rounded-xl border border-white/10 p-1">
                             <input type="time" value={editForm.start_time} onChange={e => setEditForm({ ...editForm, start_time: e.target.value })} className="bg-transparent border-none text-center text-foreground font-mono text-sm h-8 flex-1 focus:outline-none" />
                             <span className="text-white/20">-</span>
                             <input type="time" value={editForm.end_time} onChange={e => setEditForm({ ...editForm, end_time: e.target.value })} className="bg-transparent border-none text-center text-foreground font-mono text-sm h-8 flex-1 focus:outline-none" />
                        </div>
                        <div className="w-20 relative bg-black/40 rounded-xl border border-white/10 p-1">
                             <span className="absolute top-0.5 left-0 w-full text-center text-[8px] text-cyan-400 font-black tracking-widest">Std</span>
                             <input type="text" value={editForm.hours} onChange={e => handleHoursChange(e.target.value)} className="w-full bg-transparent border-none text-center text-cyan-300 font-bold h-8 pt-2 focus:outline-none" />
                        </div>
                    </div>
                    <div className="flex gap-2 justify-end pt-2">
                        <button onClick={() => setEditingEntry(null)} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white transition-colors"><X size={16} /></button>
                        <button onClick={handleSaveEdit} className="p-2 bg-emerald-500/20 hover:bg-emerald-500/40 border border-emerald-500/30 rounded-lg text-emerald-400 transition-colors"><Save size={16} /></button>
                    </div>
                </div>
            ) : (
                /* VIEW MODE - TWEET STYLE */
                <>
                    <div className="flex gap-3">
                        <div className="shrink-0">
                            <div className={`h-10 w-10 rounded-full flex items-center justify-center border border-white/10 shadow-inner ${entry.type === 'break' ? 'bg-orange-500/20 text-orange-400' : entry.isAbsence ? 'bg-purple-500/20 text-purple-300' : 'bg-primary/20 text-primary'}`}>
                                {getEntryIcon(entry.type)}
                            </div>
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex flex-col min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className={`font-black tracking-tight truncate ${entry.type === 'break' ? 'text-orange-300' : entry.isAbsence ? 'text-purple-200' : 'text-white'}`}>
                                            {entry.client_name}
                                        </span>
                                        {entry.submitted && (
                                            <div className="bg-emerald-500/20 p-0.5 rounded-full border border-emerald-500/30">
                                                <CheckCircle size={10} className="text-emerald-400" />
                                            </div>
                                        )}
                                        {entry.order_number && (
                                            <span className="text-[10px] font-mono text-white/40 bg-white/5 px-1.5 py-0.5 rounded border border-white/5 uppercase tracking-widest">
                                                #{entry.order_number}
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-[11px] font-bold text-white/40 uppercase tracking-widest flex items-center gap-2 mt-0.5">
                                        {entry.type ? ENTRY_TYPES_CONFIG[entry.type]?.label.split(' / ')[0] : 'Unbekannt'}
                                        {entry.start_time && <span>• {entry.start_time} - {entry.end_time}</span>}
                                    </span>
                                </div>

                                <div className="flex gap-1.5 transition-all">
                                    {isLocked ? (
                                         entry.submitted && !entry.isAbsence && (
                                            <button onClick={() => handleEditClick(entry)} className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/20 rounded-lg transition-all" title="Änderungsantrag">
                                                <RefreshCw size={14} />
                                            </button>
                                         )
                                    ) : (
                                        <>
                                            <button onClick={() => handleEditClick(entry)} className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white transition-all">
                                                <Edit2 size={14} />
                                            </button>
                                            <button onClick={() => handleDeleteClick(entry)} className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg transition-all">
                                                <Trash2 size={14} />
                                            </button>
                                        </>
                                    )}
                                    <button onClick={() => { setHistoryModal({ isOpen: true, entryId: entry.id }); fetchEntryHistory(entry.id); }} className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/60 transition-all">
                                        <HistoryIcon size={14} />
                                    </button>
                                </div>
                            </div>

                            {entry.note && (
                                <div className="mt-2 text-sm text-white/70 italic bg-white/5 p-2 rounded-xl border border-white/5 relative group/note">
                                    <StickyNote size={12} className="absolute -top-1 -left-1 text-white/20 rotate-12" />
                                    {entry.note}
                                </div>
                            )}

                            {entry.late_reason && (
                                <div className="mt-2 text-xs text-orange-200/80 bg-orange-500/10 p-2 rounded-xl border border-orange-500/20 flex items-start gap-2">
                                    <ShieldAlert size={14} className="shrink-0 text-orange-400" />
                                    <span>"{entry.late_reason}"</span>
                                </div>
                            )}

                            <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <SubmissionTimer entryDate={entry.date} submitted={!!entry.submitted} isAbsence={!!entry.isAbsence} />
                                    {entry.confirmed_at ? (
                                        <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-emerald-400/70">
                                            <CheckCircle size={10} /> Bestätigt
                                        </div>
                                    ) : (entry.responsible_user_id || entry.late_reason) && (
                                        <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-orange-400/70 animate-pulse">
                                            <Hourglass size={10} /> Prüfung
                                        </div>
                                    )}
                                </div>
                                <div className="text-lg font-black tracking-tighter text-white">
                                    {entry.type === 'emergency_service' && entry.surcharge ? (
                                        <span className="flex items-baseline gap-1">
                                            {(entry.hours * (1 + entry.surcharge / 100)).toFixed(2)}
                                            <span className="text-[10px] opacity-40 font-bold uppercase">h (+{entry.surcharge}%)</span>
                                        </span>
                                    ) : (
                                        <span className="flex items-baseline gap-1">
                                            {entry.hours.toFixed(2)}
                                            <span className="text-[10px] opacity-40 font-bold uppercase">h</span>
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
    </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </>
                )}

                {/* ATTENDANCE VIEW */}
                {viewMode === 'attendance' && (
                    <>
                        {currentMonthAttendance.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                                <UserCheck size={48} className="mb-2 opacity-50" />
                                <p>Keine Anwesenheitszeiten erfasst</p>
                            </div>
                        )}
                        <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
                            {currentMonthAttendance.map(item => {
                                const dateObj = new Date(item.date);
                                const log = item.log;
                                const absence = item.absence;
                                const projectBreaks = item.projectBreaks || [];

                                // Calculate Break Duration
                                const breakDuration = projectBreaks.reduce((sum, b) => sum + b.hours, 0);

                                // Calculate Raw Duration (Total Attendance)
                                let rawDuration = log ? calculateDuration(log) : (absence && absence.type !== 'unpaid' ? getDailyTargetForDate(item.date, settings.target_hours) : 0);

                                // Net Duration = Attendance - Breaks
                                const netDuration = Math.max(0, rawDuration - breakDuration);

                                let cardStyle = 'border-blue-500/20';
                                if (absence) cardStyle = 'border-purple-500/20 bg-purple-900/10';
                                else if (netDuration === 0) cardStyle = 'opacity-50';

                                return (
                                    <GlassCard key={item.date} className={`${cardStyle}`}>
                                        <div className="flex items-center justify-between border-b border-border pb-2 mb-2">
                                            <div className="flex items-center gap-2">
                                                <Calendar size={14} className={absence ? 'text-purple-300' : 'text-blue-300'} />
                                                <span className="text-sm font-bold text-foreground">{dateObj.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })}</span>
                                            </div>
                                            <span className={`text-lg font-mono font-bold ${absence ? 'text-purple-300' : 'text-blue-300'}`}>{formatDuration(netDuration)} h</span>
                                        </div>
                                        <div className="grid grid-cols-1 gap-2 text-xs">
                                            {log ? (
                                                <>
                                                    <div>
                                                        <span className="text-muted-foreground block uppercase text-[10px] tracking-wider">Zeiten</span>
                                                        <div className="flex flex-col gap-2 mt-1">
                                                            {log.segments && log.segments.length > 0 ? (
                                                                log.segments.map((s: any, i: number) => (
                                                                    <div key={i} className="flex justify-between items-start">
                                                                        <span className={`${s.type === 'work' ? 'bg-teal-500/10 text-teal-100' : 'bg-orange-500/10 text-orange-100'} px-1.5 py-0.5 rounded border border-border`}>
                                                                            {s.start}-{s.end}
                                                                        </span>
                                                                        {s.note && <span className="text-muted-foreground italic ml-2 text-right max-w-[150px] truncate">{s.note}</span>}
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                /* Fallback for legacy data without segments */
                                                                <>
                                                                    <div className="flex justify-between items-start">
                                                                        <span className="bg-teal-500/10 text-teal-100 px-1.5 py-0.5 rounded border border-border">
                                                                            {log.start_time}-{log.end_time}
                                                                        </span>
                                                                    </div>
                                                                    {log.break_start && log.break_end && (
                                                                        <div className="flex justify-between items-start">
                                                                            <span className="bg-orange-500/10 text-orange-100 px-1.5 py-0.5 rounded border border-border">
                                                                                Pause: {log.break_start}-{log.break_end}
                                                                            </span>
                                                                        </div>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                </>
                                            ) : absence ? (
                                                <div className="text-purple-200 uppercase font-bold text-xs flex items-center gap-2">
                                                    {absence.type === 'vacation' ? <Palmtree size={12} /> : absence.type === 'sick' ? <Stethoscope size={12} /> : <Ban size={12} />}
                                                    {absence.type === 'vacation' ? 'Urlaub' : absence.type === 'sick' ? 'Krank' : absence.type === 'holiday' ? 'Feiertag' : 'Unbezahlt'}
                                                </div>
                                            ) : null}
                                            {projectBreaks.length > 0 && (
                                                <div>
                                                    <span className="text-muted-foreground block uppercase text-[10px] tracking-wider mt-2">Pausen (Erfasst)</span>
                                                    <div className="flex flex-col gap-1 mt-1">
                                                        {projectBreaks.map(pb => (
                                                            <div key={pb.id} className="flex justify-between items-center text-orange-200 bg-orange-900/20 px-2 py-1 rounded border border-orange-500/20">
                                                                <span className="font-mono">{pb.start_time}-{pb.end_time}</span>
                                                                <span className="text-[10px] opacity-70">Pause</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </GlassCard>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

            {/* CHANGE REQUEST MODAL (für abgegebene Einträge) */}
            {changeRequestModal.isOpen && editingEntry && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-input backdrop-blur-sm animate-in fade-in duration-200">
                    <GlassCard className="w-full max-w-sm relative shadow-2xl border-blue-500/30">
                        <div className="flex items-center gap-3 text-blue-400 mb-4">
                            <FileText size={28} />
                            <h3 className="text-xl font-bold">Änderungsantrag</h3>
                        </div>
                        <p className="text-muted-foreground text-sm mb-2">
                            Dieser Eintrag wurde bereits abgegeben. Deine Änderung wird als <strong className="text-blue-300">Antrag</strong> an das Büro gesendet und erst nach Genehmigung wirksam.
                        </p>
                        <div className="bg-muted rounded-lg p-3 mb-4 border border-border text-xs text-muted-foreground">
                            <div className="flex justify-between mb-1">
                                <span className="font-bold text-muted-foreground">{editForm.client_name}</span>
                                <span className="font-mono">{editForm.hours} h</span>
                            </div>
                            <div className="flex gap-2">
                                <span>{editForm.date}</span>
                                {editForm.start_time && <span>{editForm.start_time} - {editForm.end_time}</span>}
                            </div>
                        </div>
                        <div className="mb-4">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Grund der Änderung *</label>
                            <input
                                type="text"
                                value={changeRequestModal.reason}
                                onChange={(e) => setChangeRequestModal(prev => ({ ...prev, reason: e.target.value }))}
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                placeholder="Warum muss der Eintrag geändert werden?"
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter' && changeRequestModal.reason.trim()) submitChangeRequest(); }}
                            />
                        </div>
                        <div className="flex gap-3">
                            <GlassButton
                                onClick={() => { setChangeRequestModal({ isOpen: false, reason: '' }); setEditingEntry(null); }}
                                variant="secondary"
                            >
                                Abbrechen
                            </GlassButton>
                            <GlassButton
                                onClick={submitChangeRequest}
                                disabled={!changeRequestModal.reason.trim() || isSubmittingChangeRequest}
                                variant="primary"
                                className="!bg-blue-600 after:!bg-blue-500"
                            >
                                {isSubmittingChangeRequest ? 'Sende...' : 'Antrag senden'}
                            </GlassButton>
                        </div>
                    </GlassCard>
                </div>
            )}

            {/* CONFIRMATION MODAL FOR DELETE */}
            {
                entryToDelete && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-input backdrop-blur-sm animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-sm relative shadow-2xl border-red-500/30">
                            <div className="flex items-center gap-3 text-red-400 mb-4">
                                <AlertTriangle size={28} />
                                <h3 className="text-xl font-bold">Löschen bestätigen</h3>
                            </div>
                            <p className="text-muted-foreground mb-6">
                                Möchtest du den Eintrag <strong>{entryToDelete.client_name}</strong> wirklich endgültig löschen?
                            </p>
                            <div className="flex gap-3">
                                <GlassButton
                                    onClick={() => setEntryToDelete(null)}
                                    variant="secondary"
                                >
                                    Abbrechen
                                </GlassButton>
                                <GlassButton
                                    onClick={confirmDelete}
                                    variant="danger"
                                >
                                    Löschen
                                </GlassButton>
                            </div>
                        </GlassCard>
                    </div>
                )
            }



            {/* HISTORY MODAL */}
            {
                historyModal.isOpen && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-input backdrop-blur-md animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-lg max-h-[80vh] overflow-y-auto relative shadow-2xl border-border">
                            <button onClick={() => setHistoryModal({ isOpen: false, entryId: null })} className="absolute top-4 right-4 p-2 bg-card hover:bg-accent rounded-full text-foreground transition-colors"><X size={20} /></button>
                            <h3 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2"><HistoryIcon size={20} /> Änderungsverlauf</h3>

                            <div className="space-y-4">
                                {entryHistory.length === 0 ? (
                                    <p className="text-muted-foreground italic text-center py-4">Keine Änderungen protokolliert.</p>
                                ) : (
                                    entryHistory.map(h => (
                                        <div key={h.id} className="bg-muted p-3 rounded-lg border border-border text-sm">
                                            <div className="flex justify-between items-start mb-2">
                                                <span className="text-foreground font-bold">{h.changer_name || 'Unbekannt'}</span>
                                                <span className="text-muted-foreground text-xs">{new Date(h.changed_at).toLocaleString('de-DE')}</span>
                                            </div>
                                            <div className="bg-input p-2 rounded mb-2 font-mono text-xs text-orange-200">
                                                {h.reason ? `Grund: ${h.reason}` : 'Kein Grund angegeben'}
                                            </div>
                                            <div className="space-y-1 text-xs mb-3">
                                                {Object.keys(h.new_values).map(key => {
                                                    if (key === 'updated_at' || key === 'last_changed_by' || key === 'change_reason' || key === 'change_confirmed_by_user') return null;

                                                    const fieldLabels: Record<string, string> = {
                                                        client_name: 'Kunde/Projekt',
                                                        hours: 'Stunden',
                                                        start_time: 'Von',
                                                        end_time: 'Bis',
                                                        note: 'Notiz',
                                                        date: 'Datum',
                                                        type: 'Typ',
                                                    };

                                                    const label = fieldLabels[key] || key;
                                                    const oldVal = (h.old_values as any)?.[key];
                                                    const newVal = (h.new_values as any)?.[key];

                                                    return (
                                                        <div key={key} className="grid grid-cols-[100px_1fr] gap-2 items-center bg-muted p-1.5 rounded">
                                                            <span className="text-muted-foreground uppercase font-bold text-[10px]">{label}</span>
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span className="text-red-300 line-through decoration-red-500/50">{oldVal !== undefined && oldVal !== null ? String(oldVal) : '(leer)'}</span>
                                                                <span className="text-muted-foreground">→</span>
                                                                <span className="text-emerald-300 font-bold">{newVal !== undefined && newVal !== null ? String(newVal) : '(gelöscht)'}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {h.status === 'pending' && (
                                                <div className="flex gap-2 justify-end border-t border-border pt-2">
                                                    {rejectingHistoryId === h.id ? (
                                                        <div className="flex-1 flex gap-2">
                                                            <input
                                                                autoFocus
                                                                type="text"
                                                                value={rejectionNote}
                                                                onChange={e => setRejectionNote(e.target.value)}
                                                                placeholder="Grund für Ablehnung..."
                                                                className="flex-1 bg-input border border-border rounded px-2 text-xs text-foreground"
                                                            />
                                                            <button onClick={() => handleRejectChange(h.id)} className="bg-red-500 hover:bg-red-600 text-foreground px-2 py-1 rounded text-xs font-bold">Senden</button>
                                                            <button onClick={() => setRejectingHistoryId(null)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <button onClick={() => setRejectingHistoryId(h.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-300 hover:bg-red-500/20 text-xs font-bold transition-colors">
                                                                <ThumbsDown size={12} /> Ablehnen
                                                            </button>
                                                            <button onClick={() => handleConfirmChange(h.id, h.entry_id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-xs font-bold transition-colors">
                                                                <ThumbsUp size={12} /> Bestätigen
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                            {h.status === 'confirmed' && (
                                                <div className="mt-2 text-emerald-300 text-xs font-bold border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 rounded inline-block">
                                                    <div className="flex items-center gap-1">
                                                        <CheckCircle size={12} />
                                                        <span>Bestätigt am {h.user_response_at ? new Date(h.user_response_at).toLocaleString('de-DE') : 'Unbekannt'}</span>
                                                    </div>
                                                </div>
                                            )}
                                            {h.status === 'rejected' && (
                                                <div className="mt-2 text-red-300 text-xs font-bold border border-red-500/30 bg-red-500/10 px-2 py-1 rounded inline-block">
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex items-center gap-1">
                                                            <X size={12} />
                                                            <span>Abgelehnt am {h.user_response_at ? new Date(h.user_response_at).toLocaleString('de-DE') : 'Unbekannt'}</span>
                                                        </div>
                                                        {h.user_response_note && <span className="text-muted-foreground font-normal">"{h.user_response_note}"</span>}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </GlassCard>
                    </div>
                )
            }

            {
                showPdfModal && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-input backdrop-blur-sm">
                        <GlassCard className="w-full max-w-sm relative shadow-2xl border-teal-500/30">
                            <button onClick={() => setShowPdfModal(false)} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"><X size={20} /></button>
                            <div className="flex items-center gap-3 text-teal-300 mb-6"><FileDown size={24} /><h3 className="text-xl font-bold">PDF Exportieren</h3></div>
                            <div className="space-y-4">

                                {/* MONATS-SELEKTOR FÜR ABGABE */}
                                <div className="flex items-center justify-between bg-muted p-3 rounded-lg border border-border">
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold text-foreground">Monat abgeben</span>
                                        <span className="text-[10px] text-muted-foreground">Alle Einträge im Monat als abgegeben markieren</span>
                                    </div>
                                </div>
                                <div className="flex items-center justify-center bg-muted rounded-lg p-2 border border-border">
                                    <button onClick={() => setSubmitMonth(new Date(submitMonth.getFullYear(), submitMonth.getMonth() - 1, 1))} className="p-1.5 hover:bg-card rounded text-foreground">
                                        <ChevronLeft size={18} />
                                    </button>
                                    <span className="mx-3 text-sm font-bold text-foreground w-36 text-center">
                                        {submitMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
                                    </span>
                                    <button onClick={() => setSubmitMonth(new Date(submitMonth.getFullYear(), submitMonth.getMonth() + 1, 1))} className="p-1.5 hover:bg-card rounded text-foreground">
                                        <ChevronRight size={18} />
                                    </button>
                                </div>

                                <hr className="border-border" />
                                
                                {/* DATUMSBEREICH FÜR PDF EXPORT */}
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs uppercase font-bold text-muted-foreground mb-1 block">Von Datum</label>
                                        <div onClick={() => setActivePdfDatePicker('start')} className="flex items-center justify-between w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground cursor-pointer hover:bg-card"><span>{formatDateDisplay(startDate)}</span><Calendar size={18} className="text-muted-foreground" /></div>
                                    </div>
                                    <div>
                                        <label className="text-xs uppercase font-bold text-muted-foreground mb-1 block">Bis Datum</label>
                                        <div onClick={() => setActivePdfDatePicker('end')} className="flex items-center justify-between w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground cursor-pointer hover:bg-card"><span>{formatDateDisplay(endDate)}</span><Calendar size={18} className="text-muted-foreground" /></div>
                                    </div>
                                </div>

                                <div className="bg-muted rounded-lg p-3 space-y-3">
                                    <button onClick={generateProjectPDF} className="w-full flex items-center gap-3 p-3 rounded-lg bg-teal-600/20 border border-teal-500/30 hover:bg-teal-600/40 group"><FileText className="text-teal-300" size={20} /><div className="text-left"><div className="text-sm font-bold text-teal-100">Projekte Exportieren</div><div className="text-[10px] text-teal-200/60">Querformat • Mit Start/Ende</div><div className="text-[10px] text-emerald-300 mt-0.5">Markiert Einträge als abgegeben</div></div></button>
                                    <button onClick={generateAttendancePDF} className="w-full flex items-center gap-3 p-3 rounded-lg bg-blue-600/20 border border-blue-500/30 hover:bg-blue-600/40 group"><UserCheck className="text-blue-300" size={20} /><div className="text-left"><div className="text-sm font-bold text-blue-100">Anwesenheit Exportieren</div><div className="text-[10px] text-blue-200/60">Hochformat • Detailübersicht</div></div></button>
                                    <button onClick={handleMarkSubmittedOnly} className="w-full flex items-center gap-3 p-3 rounded-lg bg-emerald-600/20 border border-emerald-500/30 hover:bg-emerald-600/40 group"><CheckCircle className="text-emerald-300" size={20} /><div className="text-left"><div className="text-sm font-bold text-emerald-100">{submitMonth.toLocaleDateString('de-DE', { month: 'long' })} abschließen</div><div className="text-[10px] text-emerald-200/60">Nur als "Abgegeben" markieren</div></div></button>
                                </div>
                            </div>
                        </GlassCard>
                    </div>
                )
            }
            {activePdfDatePicker && <GlassDatePicker value={activePdfDatePicker === 'start' ? startDate : endDate} onChange={(newDate) => { if (activePdfDatePicker === 'start') setStartDate(newDate); else setEndDate(newDate); setActivePdfDatePicker(null); }} onClose={() => setActivePdfDatePicker(null)} />}
        </div >
    );
};

export default HistoryPage;