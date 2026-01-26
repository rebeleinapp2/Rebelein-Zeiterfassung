import React, { useMemo, useState, useEffect } from 'react';
import { useTimeEntries, useSettings, useDailyLogs, useAbsences, getDailyTargetForDate, getLocalISOString } from '../services/dataService';
import { GlassCard, GlassButton, GlassInput } from '../components/GlassCard';
import { Trash2, FileDown, X, Edit2, Save, CalendarDays, Briefcase, Clock, ChevronLeft, ChevronRight, CheckCircle, Calendar, UserCheck, List, FileText, StickyNote, Coffee, Lock, Hourglass, Building2, Building, Warehouse, Car, Palmtree, Stethoscope, Ban, PartyPopper, TrendingDown, AlertTriangle, Check, Siren, History as HistoryIcon, ThumbsUp, ThumbsDown, RefreshCw, ShieldAlert, Hash } from 'lucide-react';
import GlassDatePicker from '../components/GlassDatePicker';
import { TimeEntry, DailyLog, UserAbsence } from '../types';
import { supabase } from '../services/supabaseClient';
import { formatDuration } from '../services/utils/timeUtils';

const HistoryPage: React.FC = () => {
    const { entries, deleteEntry, updateEntry, markAsSubmitted, loading, lockedDays, entryHistory, fetchEntryHistory } = useTimeEntries();
    const { settings } = useSettings();
    const { dailyLogs, fetchDailyLogs } = useDailyLogs();
    const { absences, deleteAbsenceDay, fetchAbsences } = useAbsences();

    const [viewDate, setViewDate] = useState(new Date());
    const [viewMode, setViewMode] = useState<'projects' | 'attendance'>('projects');

    const [touchStart, setTouchStart] = useState<number | null>(null);
    const [touchEnd, setTouchEnd] = useState<number | null>(null);

    const [showPdfModal, setShowPdfModal] = useState(false);
    // Nutzung von getLocalISOString für korrekte Vorbelegung
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

    // History Modal State
    const [historyModal, setHistoryModal] = useState<{ isOpen: boolean; entryId: string | null }>({ isOpen: false, entryId: null });
    const [rejectionNote, setRejectionNote] = useState('');
    const [rejectingHistoryId, setRejectingHistoryId] = useState<string | null>(null);

    const handleConfirmChange = async (historyId: string, entryId: string) => {
        const { error } = await supabase.rpc('handle_entry_history_response', {
            p_entry_id: entryId,
            p_action: 'confirm'
        });

        if (error) alert("Fehler beim Bestätigen: " + error.message);
        else {
            fetchEntryHistory(entryId);
        }
    };

    const handleRejectChange = async (historyId: string) => {
        // historyId lookup to get entryId? 
        // We have entryId in historyModal state!
        if (!historyModal.entryId) return;

        if (!rejectionNote.trim()) {
            alert("Bitte Begründung angeben.");
            return;
        }

        const { error } = await supabase.rpc('handle_entry_history_response', {
            p_entry_id: historyModal.entryId,
            p_action: 'reject',
            p_note: rejectionNote
        });

        if (error) alert("Fehler beim Ablehnen: " + error.message);
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

    const minSwipeDistance = 50;
    const onTouchStart = (e: React.TouchEvent) => {
        setTouchEnd(null);
        setTouchStart(e.targetTouches[0].clientX);
    };
    const onTouchMove = (e: React.TouchEvent) => {
        setTouchEnd(e.targetTouches[0].clientX);
    };
    const onTouchEnd = () => {
        if (!touchStart || !touchEnd) return;
        const distance = touchStart - touchEnd;
        if (distance > minSwipeDistance) nextMonth();
        else if (distance < -minSwipeDistance) prevMonth();
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
                    if (e.type === 'break' || e.type === 'overtime_reduction') return sum;
                    let hours = e.hours;
                    if (e.type === 'emergency_service' && e.surcharge) {
                        hours = hours * (1 + e.surcharge / 100);
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

        await updateEntry(editingEntry.id, updates);
        setEditingEntry(null);
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
        if (entry.isAbsence) {
            switch (entry.type) {
                case 'vacation': return `border-purple-500/20 bg-purple-900/10 text-purple-200 ${entry.submitted ? 'ring-1 ring-emerald-500/50' : ''}`;
                case 'sick': return `border-red-500/20 bg-red-900/10 text-red-200 ${entry.submitted ? 'ring-1 ring-emerald-500/50' : ''}`;
                case 'holiday': return `border-blue-500/20 bg-blue-900/10 text-blue-200 ${entry.submitted ? 'ring-1 ring-emerald-500/50' : ''}`;
                case 'unpaid': return `border-gray-500/20 bg-gray-800/30 text-gray-300 ${entry.submitted ? 'ring-1 ring-emerald-500/50' : ''}`;
                default: return `border-white/10 bg-white/5 ${entry.submitted ? 'ring-1 ring-emerald-500/50' : ''}`;
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
            case 'car': return 'border-gray-500/20 bg-gray-800/30 text-gray-300';
            case 'overtime_reduction': return 'border-pink-500/20 bg-pink-900/10 text-pink-200';
            default: return 'md:hover:bg-white/10 transition-colors';
        }
    };

    const handleMarkSubmittedOnly = async () => {
        const start = new Date(startDate);
        const end = new Date(endDate);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        const filteredEntries = entries.filter(e => {
            const d = new Date(e.date);
            return d >= start && d <= end;
        });

        if (filteredEntries.length === 0) {
            alert("Keine Einträge im gewählten Zeitraum.");
            return;
        }

        // Check if there are rejected or pending items that would be blocked
        const blockedCount = filteredEntries.filter(e => !e.isAbsence && (e.rejected_at || e.responsible_user_id)).length;
        if (blockedCount > 0) {
            alert(`${blockedCount} Einträge sind abgelehnt oder noch in Prüfung und werden NICHT als abgegeben markiert.`);
        }

        const idsToMark = filteredEntries
            .filter(e => !e.isAbsence && !e.id.startsWith('virtual-'))
            // NEU: Nur EInträge markieren, die NICHT abgelehnt sind und NICHT in Prüfung sind
            .filter(e => !e.rejected_at && !e.responsible_user_id)
            .map(e => e.id);

        if (idsToMark.length > 0) {
            await markAsSubmitted(idsToMark);
        }

        // Handle Absences
        const absenceIds = filteredEntries
            .filter(e => e.isAbsence && e.id.startsWith('abs-'))
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
                alert("Kein Benutzer gefunden.");
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
            alert("Fehler beim Exportieren des PDFs.");
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
                alert("Kein Benutzer gefunden.");
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
            alert("Fehler beim Exportieren des Anwesenheits-PDFs.");
        }
    };

    const formatDateDisplay = (isoDate: string) => new Date(isoDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    return (
        <div className="p-6 pb-24 h-full flex flex-col overflow-hidden md:max-w-6xl md:mx-auto w-full">
            <div className="flex flex-col gap-4 mb-4 md:flex-row md:justify-between md:items-center md:mb-6">
                <div className="flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-white">Verlauf</h2>
                    <button onClick={() => setShowPdfModal(true)} className="bg-white/10 p-2 rounded-lg text-white hover:bg-white/20 transition-colors flex items-center md:hidden">
                        <Check size={20} />
                    </button>
                </div>

                <div className="bg-white/10 p-1 rounded-xl flex w-full md:w-auto self-center">
                    <button onClick={() => setViewMode('projects')} className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${viewMode === 'projects' ? 'bg-teal-500 text-white shadow-lg' : 'text-white/50 hover:text-white'}`}>
                        <List size={16} /> Projekte
                    </button>
                    <button onClick={() => setViewMode('attendance')} className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${viewMode === 'attendance' ? 'bg-blue-500 text-white shadow-lg' : 'text-white/50 hover:text-white'}`}>
                        <UserCheck size={16} /> Anwesenheit
                    </button>
                </div>

                <div className="flex gap-2 justify-between md:justify-end">
                    <div className="flex items-center bg-white/5 rounded-lg p-1 backdrop-blur-md w-full md:w-auto justify-between md:justify-center">
                        <button onClick={prevMonth} className="p-1.5 hover:bg-white/10 rounded text-white"><ChevronLeft size={18} /></button>
                        <span className="mx-2 text-sm font-medium text-white whitespace-nowrap w-32 text-center">
                            {viewDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
                        </span>
                        <button onClick={nextMonth} className="p-1.5 hover:bg-white/10 rounded text-white"><ChevronRight size={18} /></button>
                    </div>
                    <button onClick={() => setShowPdfModal(true)} className="hidden md:flex bg-gradient-to-r from-teal-500 to-emerald-600 p-2 px-4 rounded-lg text-white shadow-lg hover:scale-105 transition-transform items-center justify-center gap-2">
                        <Check size={20} /> <span className="text-sm font-medium">Abgeben</span>
                    </button>
                </div>
            </div>

            <div className="mb-6">
                <GlassCard className={`py-3 px-4 flex justify-between items-center border md:p-6 ${viewMode === 'projects' ? 'bg-white/10 border-white/20' : 'bg-blue-900/20 border-blue-400/30'}`}>
                    <span className="text-sm text-white/60 font-medium uppercase tracking-wide md:text-lg">
                        {viewMode === 'projects' ? 'Projektstunden' : 'Anwesenheit (Netto)'} {viewDate.toLocaleDateString('de-DE', { month: 'long' })}
                    </span>
                    <span className={`text-xl font-bold font-mono md:text-3xl ${viewMode === 'projects' ? 'text-teal-300' : 'text-blue-300'}`}>
                        {viewMode === 'projects' ? monthlyTotalHours.toFixed(2).replace('.', ',') : formatDuration(monthlyTotalHours)} h
                    </span>
                </GlassCard>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6 pr-1 -mr-2 pb-12 md:pr-4" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
                {/* PROJECTS VIEW */}
                {viewMode === 'projects' && (
                    <>
                        {currentMonthData.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-40 text-white/30">
                                <List size={48} className="mb-2 opacity-50" />
                                <p>Keine Projektdaten in diesem Monat</p>
                            </div>
                        )}

                        {currentMonthData.map(([dateStr, dayEntries]) => {
                            const dateObj = new Date(dateStr);
                            const isLocked = lockedDays.includes(dateStr);
                            const dayTotal = dayEntries.reduce((sum, e) => {
                                if (e.type === 'break' || e.type === 'overtime_reduction') return sum;
                                let hours = e.hours;
                                if (e.type === 'emergency_service' && e.surcharge) {
                                    hours = hours * (1 + e.surcharge / 100);
                                }
                                return sum + hours;
                            }, 0);
                            const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
                            const allSubmitted = dayEntries.every(e => e.submitted || e.isAbsence);

                            return (
                                <div key={dateStr} className="relative md:bg-white/5 md:p-4 md:rounded-2xl md:border md:border-white/5">
                                    <div className={`flex items-center justify-between mb-2 px-1 md:px-0 ${allSubmitted ? 'text-emerald-300' : 'text-white/70'}`}>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-sm font-bold md:text-base ${isWeekend ? 'text-red-300/70' : ''}`}>
                                                {dateObj.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                                            </span>
                                            {isLocked && <span title="Tag gesperrt"><Lock size={14} className="text-red-400" /></span>}
                                            {allSubmitted && !dayEntries.every(e => e.isAbsence) && <div className="flex items-center gap-1 text-xs bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30"><CheckCircle size={12} /> <span>Abgegeben</span></div>}
                                            {dayEntries.some(e => e.rejected_at) && <div className="flex items-center gap-1 text-xs bg-red-500/20 px-2 py-0.5 rounded-full border border-red-500/30 text-red-300"><AlertTriangle size={12} /> <span>Abgelehnt</span></div>}
                                            {dayEntries.some(e => (e.responsible_user_id || e.late_reason) && !e.rejected_at && !e.confirmed_at) && <div className="flex items-center gap-1 text-xs bg-orange-500/20 px-2 py-0.5 rounded-full border border-orange-500/30 text-orange-300"><Hourglass size={12} /> <span>In Prüfung</span></div>}
                                        </div>
                                        <span className="text-xs font-mono bg-white/5 px-2 py-1 rounded text-white/50 md:text-sm md:bg-white/10">{dayTotal.toFixed(2)} h</span>
                                    </div>

                                    <div className="space-y-2 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-4 md:space-y-0">
                                        {dayEntries.map(entry => (
                                            <GlassCard key={entry.id} className={`!p-3 flex flex-col justify-between group ${getEntryStyle(entry)}`}>
                                                {editingEntry?.id === entry.id && !entry.isAbsence ? (
                                                    <div className="w-full space-y-2">
                                                        <div className="flex gap-2">
                                                            <GlassInput type="text" value={editForm.client_name} onChange={e => setEditForm({ ...editForm, client_name: e.target.value })} className="!py-1 !text-sm h-8 flex-[2]" placeholder="Projekt..." />
                                                            <GlassInput type="text" value={editForm.order_number} onChange={e => setEditForm({ ...editForm, order_number: e.target.value })} className="!py-1 !text-sm h-8 flex-1 font-mono text-white/70" placeholder="Auftrag #" />
                                                        </div>
                                                        <div className="flex gap-1 items-center">
                                                            <GlassInput type="time" value={editForm.start_time} onChange={e => setEditForm({ ...editForm, start_time: e.target.value })} className="!py-1 !text-sm h-8 text-center flex-1" />
                                                            <span className="text-white/50">-</span>
                                                            <GlassInput type="time" value={editForm.end_time} onChange={e => setEditForm({ ...editForm, end_time: e.target.value })} className="!py-1 !text-sm h-8 text-center flex-1" />
                                                            <div className="mx-1 w-px h-6 bg-white/10"></div>
                                                            <GlassInput
                                                                type="text"
                                                                value={editForm.hours}
                                                                onChange={e => handleHoursChange(e.target.value)}
                                                                className="!py-1 !text-sm h-8 w-16 text-center font-bold text-teal-300"
                                                                placeholder="h"
                                                            />
                                                        </div>
                                                        <input
                                                            type="text"
                                                            value={editForm.note}
                                                            onChange={e => setEditForm({ ...editForm, note: e.target.value })}
                                                            placeholder="Notiz..."
                                                            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none"
                                                        />

                                                        <div className="flex gap-2 justify-end mt-1">
                                                            <button onClick={() => setEditingEntry(null)} className="p-1.5 bg-white/10 rounded text-white"><X size={16} /></button>
                                                            <button onClick={handleSaveEdit} className="p-1.5 bg-teal-500 rounded text-white"><Save size={16} /></button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="w-full">
                                                        <div className="flex justify-between items-start">
                                                            <p className={`text-sm font-medium truncate flex-1 ${entry.type === 'break' ? 'text-orange-300' :
                                                                entry.isAbsence && entry.type === 'vacation' ? 'text-purple-100' :
                                                                    entry.isAbsence && entry.type === 'sick' ? 'text-red-100' :
                                                                        entry.isAbsence && entry.type === 'holiday' ? 'text-blue-100' :
                                                                            entry.isAbsence ? 'text-white/70' :
                                                                                entry.type === 'overtime_reduction' ? 'text-pink-200' :
                                                                                    'text-white'
                                                                }`}>
                                                                {getEntryIcon(entry.type)}
                                                                {entry.client_name}
                                                                {entry.order_number && (
                                                                    <span
                                                                        onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(entry.order_number || ''); }}
                                                                        className="ml-2 inline-flex items-center gap-0.5 bg-white/10 px-1.5 py-0.5 rounded text-[10px] text-white/50 font-mono tracking-wide border border-white/5 cursor-pointer hover:bg-white/20 active:scale-95 transition-all"
                                                                        title="Klicken zum Kopieren"
                                                                    >
                                                                        {entry.order_number}
                                                                    </span>
                                                                )}
                                                                {entry.has_history && (
                                                                    <span title="Bearbeitungsverlauf vorhanden" className="ml-2 inline-flex">
                                                                        <HistoryIcon size={14} className="text-purple-300" />
                                                                    </span>
                                                                )}
                                                            </p>
                                                            {(entry.start_time || entry.end_time) && !entry.isAbsence && (
                                                                <span className="text-[10px] text-white/40 font-mono bg-white/5 px-1.5 py-0.5 rounded ml-2 whitespace-nowrap">
                                                                    {entry.start_time || '??:??'} - {entry.end_time || '??:??'}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {entry.note && (
                                                            <div className="flex items-start gap-1 mt-1 mb-1">
                                                                <StickyNote size={10} className="text-white/20 mt-0.5" />
                                                                <p className="text-xs text-white/40 italic">{entry.note}</p>
                                                            </div>
                                                        )}

                                                        {entry.late_reason && (
                                                            <div className="flex items-start gap-1 mt-1 mb-1 bg-orange-900/20 p-1.5 rounded border border-orange-500/20">
                                                                <ShieldAlert size={10} className="text-orange-400 mt-0.5 shrink-0" />
                                                                <p className="text-xs text-orange-200 italic">"Grund: {entry.late_reason}"</p>
                                                            </div>
                                                        )}

                                                        {/* Modification: Show Pending/Confirmed status for ALL types if relevant (e.g. late entry) or if it's a specific type requiring confirmation */}
                                                        {(['company', 'office', 'warehouse', 'car'].includes(entry.type || '') || entry.late_reason || entry.responsible_user_id) && (
                                                            <div className="mt-2 text-[10px] flex items-center gap-1 border-t border-white/5 pt-1">
                                                                {entry.confirmed_at ? (
                                                                    <span className="text-emerald-400 flex items-center gap-1"><CheckCircle size={10} /> Bestätigt</span>
                                                                ) : (
                                                                    <span className="text-orange-400 flex items-center gap-1">
                                                                        {entry.late_reason ? <ShieldAlert size={10} /> : <Hourglass size={10} />}
                                                                        {entry.late_reason ? 'Admin-Freigabe erforderlich' : 'Bestätigung ausstehend'}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}

                                                        <div className="flex justify-between items-center mt-2">
                                                            <div className="flex items-center gap-2">
                                                                {entry.isAbsence ? (
                                                                    <span className="text-xs text-white/40 flex items-center gap-1 md:text-sm">
                                                                        <Clock size={10} className="md:w-4 md:h-4" /> {entry.hours.toFixed(2)} h (Soll)
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-xs text-white/40 flex items-center gap-1 md:text-sm">
                                                                        <Clock size={10} className="md:w-4 md:h-4" /> 
                                                                        {entry.type === 'emergency_service' && entry.surcharge ? (
                                                                            <span title={`Basis: ${entry.hours.toFixed(2)}h + ${entry.surcharge}% Zuschlag`}>
                                                                                {(entry.hours * (1 + entry.surcharge / 100)).toFixed(2)} h <span className="text-[10px] opacity-70">(+{entry.surcharge}%)</span>
                                                                            </span>
                                                                        ) : (
                                                                            `${entry.hours.toFixed(2)} h`
                                                                        )}
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {!isLocked && (!entry.submitted || entry.rejected_at) && settings?.is_active !== false && (
                                                                <div className="flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                                                    {!entry.isAbsence && (
                                                                        <button onClick={() => handleEditClick(entry)} className={`p-1.5 rounded-lg transition-colors ${entry.rejected_at ? 'text-teal-300 bg-teal-500/10 hover:bg-teal-500/20' : 'text-white/30 hover:text-white hover:bg-white/10'}`}>
                                                                            {entry.rejected_at ? <RefreshCw size={14} /> : <Edit2 size={14} />}
                                                                        </button>
                                                                    )}

                                                                    <button
                                                                        onClick={() => {
                                                                            setHistoryModal({ isOpen: true, entryId: entry.id });
                                                                            fetchEntryHistory(entry.id);
                                                                        }}
                                                                        title="Verlauf anzeigen"
                                                                        className="p-1.5 text-white/30 hover:text-teal-300 hover:bg-teal-500/10 rounded-lg transition-colors"
                                                                    >
                                                                        <HistoryIcon size={14} />
                                                                    </button>
                                                                    {/* HIER: Aufruf der neuen Lösch-Funktion statt confirm() */}
                                                                    <button
                                                                        onClick={() => handleDeleteClick(entry)}
                                                                        className="p-1.5 text-red-400/50 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                                                    >
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </div>
                                                            )}
                                                            {entry.submitted && <span className="text-emerald-500/50 p-1"><CheckCircle size={14} /></span>}
                                                        </div>
                                                    </div>
                                                )}
                                            </GlassCard>
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
                            <div className="flex flex-col items-center justify-center h-40 text-white/30">
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
                                        <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-2">
                                            <div className="flex items-center gap-2">
                                                <Calendar size={14} className={absence ? 'text-purple-300' : 'text-blue-300'} />
                                                <span className="text-sm font-bold text-white">{dateObj.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })}</span>
                                            </div>
                                            <span className={`text-lg font-mono font-bold ${absence ? 'text-purple-300' : 'text-blue-300'}`}>{formatDuration(netDuration)} h</span>
                                        </div>
                                        <div className="grid grid-cols-1 gap-2 text-xs">
                                            {log ? (
                                                <>
                                                    <div>
                                                        <span className="text-white/40 block uppercase text-[10px] tracking-wider">Zeiten</span>
                                                        <div className="flex flex-col gap-2 mt-1">
                                                            {log.segments && log.segments.length > 0 ? (
                                                                log.segments.map((s: any, i: number) => (
                                                                    <div key={i} className="flex justify-between items-start">
                                                                        <span className={`${s.type === 'work' ? 'bg-teal-500/10 text-teal-100' : 'bg-orange-500/10 text-orange-100'} px-1.5 py-0.5 rounded border border-white/10`}>
                                                                            {s.start}-{s.end}
                                                                        </span>
                                                                        {s.note && <span className="text-white/50 italic ml-2 text-right max-w-[150px] truncate">{s.note}</span>}
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                /* Fallback for legacy data without segments */
                                                                <>
                                                                    <div className="flex justify-between items-start">
                                                                        <span className="bg-teal-500/10 text-teal-100 px-1.5 py-0.5 rounded border border-white/10">
                                                                            {log.start_time}-{log.end_time}
                                                                        </span>
                                                                    </div>
                                                                    {log.break_start && log.break_end && (
                                                                        <div className="flex justify-between items-start">
                                                                            <span className="bg-orange-500/10 text-orange-100 px-1.5 py-0.5 rounded border border-white/10">
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
                                                    <span className="text-white/40 block uppercase text-[10px] tracking-wider mt-2">Pausen (Erfasst)</span>
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

            {/* CONFIRMATION MODAL FOR DELETE */}
            {
                entryToDelete && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-sm relative shadow-2xl border-red-500/30">
                            <div className="flex items-center gap-3 text-red-400 mb-4">
                                <AlertTriangle size={28} />
                                <h3 className="text-xl font-bold">Löschen bestätigen</h3>
                            </div>
                            <p className="text-white/80 mb-6">
                                Möchtest du den Eintrag <strong>{entryToDelete.client_name}</strong> wirklich endgültig löschen?
                            </p>
                            <div className="flex gap-3">
                                <GlassButton
                                    onClick={() => setEntryToDelete(null)}
                                    className="bg-white/10 hover:bg-white/20 border-white/10 text-white"
                                >
                                    Abbrechen
                                </GlassButton>
                                <GlassButton
                                    onClick={confirmDelete}
                                    variant="danger"
                                    className="bg-red-500 hover:bg-red-600 border-red-500 text-white"
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
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-lg max-h-[80vh] overflow-y-auto relative shadow-2xl border-white/20">
                            <button onClick={() => setHistoryModal({ isOpen: false, entryId: null })} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"><X size={20} /></button>
                            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><HistoryIcon size={20} /> Änderungsverlauf</h3>

                            <div className="space-y-4">
                                {entryHistory.length === 0 ? (
                                    <p className="text-white/40 italic text-center py-4">Keine Änderungen protokolliert.</p>
                                ) : (
                                    entryHistory.map(h => (
                                        <div key={h.id} className="bg-white/5 p-3 rounded-lg border border-white/10 text-sm">
                                            <div className="flex justify-between items-start mb-2">
                                                <span className="text-white font-bold">{h.changer_name || 'Unbekannt'}</span>
                                                <span className="text-white/40 text-xs">{new Date(h.changed_at).toLocaleString('de-DE')}</span>
                                            </div>
                                            <div className="bg-black/20 p-2 rounded mb-2 font-mono text-xs text-orange-200">
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
                                                        <div key={key} className="grid grid-cols-[100px_1fr] gap-2 items-center bg-white/5 p-1.5 rounded">
                                                            <span className="text-white/40 uppercase font-bold text-[10px]">{label}</span>
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span className="text-red-300 line-through decoration-red-500/50">{oldVal !== undefined && oldVal !== null ? String(oldVal) : '(leer)'}</span>
                                                                <span className="text-white/30">→</span>
                                                                <span className="text-emerald-300 font-bold">{newVal !== undefined && newVal !== null ? String(newVal) : '(gelöscht)'}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {h.status === 'pending' && (
                                                <div className="flex gap-2 justify-end border-t border-white/5 pt-2">
                                                    {rejectingHistoryId === h.id ? (
                                                        <div className="flex-1 flex gap-2">
                                                            <input
                                                                autoFocus
                                                                type="text"
                                                                value={rejectionNote}
                                                                onChange={e => setRejectionNote(e.target.value)}
                                                                placeholder="Grund für Ablehnung..."
                                                                className="flex-1 bg-black/20 border border-white/10 rounded px-2 text-xs text-white"
                                                            />
                                                            <button onClick={() => handleRejectChange(h.id)} className="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-xs font-bold">Senden</button>
                                                            <button onClick={() => setRejectingHistoryId(null)} className="text-white/40 hover:text-white"><X size={14} /></button>
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
                                                        {h.user_response_note && <span className="text-white/60 font-normal">"{h.user_response_note}"</span>}
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
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
                        <GlassCard className="w-full max-w-sm relative shadow-2xl border-teal-500/30">
                            <button onClick={() => setShowPdfModal(false)} className="absolute top-4 right-4 text-white/50 hover:text-white"><X size={20} /></button>
                            <div className="flex items-center gap-3 text-teal-300 mb-6"><FileDown size={24} /><h3 className="text-xl font-bold">PDF Exportieren</h3></div>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs uppercase font-bold text-white/50 mb-1 block">Von Datum</label>
                                    <div onClick={() => setActivePdfDatePicker('start')} className="flex items-center justify-between w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white cursor-pointer hover:bg-white/10"><span>{formatDateDisplay(startDate)}</span><Calendar size={18} className="text-white/50" /></div>
                                </div>
                                <div>
                                    <label className="text-xs uppercase font-bold text-white/50 mb-1 block">Bis Datum</label>
                                    <div onClick={() => setActivePdfDatePicker('end')} className="flex items-center justify-between w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white cursor-pointer hover:bg-white/10"><span>{formatDateDisplay(endDate)}</span><Calendar size={18} className="text-white/50" /></div>
                                </div>
                                <div className="bg-white/5 rounded-lg p-3 space-y-3">
                                    <button onClick={generateProjectPDF} className="w-full flex items-center gap-3 p-3 rounded-lg bg-teal-600/20 border border-teal-500/30 hover:bg-teal-600/40 group"><FileText className="text-teal-300" size={20} /><div className="text-left"><div className="text-sm font-bold text-teal-100">Projekte Exportieren</div><div className="text-[10px] text-teal-200/60">Querformat • Mit Start/Ende</div><div className="text-[10px] text-emerald-300 mt-0.5">Markiert Einträge als abgegeben</div></div></button>
                                    <button onClick={generateAttendancePDF} className="w-full flex items-center gap-3 p-3 rounded-lg bg-blue-600/20 border border-blue-500/30 hover:bg-blue-600/40 group"><UserCheck className="text-blue-300" size={20} /><div className="text-left"><div className="text-sm font-bold text-blue-100">Anwesenheit Exportieren</div><div className="text-[10px] text-blue-200/60">Hochformat • Detailübersicht</div></div></button>
                                    <button onClick={handleMarkSubmittedOnly} className="w-full flex items-center gap-3 p-3 rounded-lg bg-emerald-600/20 border border-emerald-500/30 hover:bg-emerald-600/40 group"><CheckCircle className="text-emerald-300" size={20} /><div className="text-left"><div className="text-sm font-bold text-emerald-100">Zeitraum abschließen</div><div className="text-[10px] text-emerald-200/60">Nur als "Abgegeben" markieren</div></div></button>
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