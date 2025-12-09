
import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTimeEntries, useOfficeService, useDailyLogs, useAbsences, useVacationRequests, getDailyTargetForDate, getLocalISOString } from '../services/dataService';
import { GlassCard, GlassButton, GlassInput } from '../components/GlassCard';
import { ChevronLeft, ChevronRight, CheckCircle, Hourglass, Calendar, Briefcase, UserCheck, Clock, Edit2, Trash2, X, Save, Coffee, Building2, Building, Warehouse, Car, ShieldAlert, Stethoscope, Palmtree, Filter, ChevronDown, Plus, AlertTriangle, CalendarDays, Ban, CalendarHeart, Info, CalendarCheck, XCircle, Printer, FileDown, FileText, Table, TrendingUp, TrendingDown, Scale, Lock, Unlock, RotateCcw, MessageSquareText, StickyNote, Calculator } from 'lucide-react';
import { TimeEntry, UserAbsence, VacationRequest } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import GlassDatePicker from '../components/GlassDatePicker';
import { formatDuration } from '../services/utils/timeUtils';

const OfficeUserPage: React.FC = () => {
    const { userId } = useParams();
    const navigate = useNavigate();
    const { fetchAllUsers, users, updateOfficeUserSettings } = useOfficeService();

    const { entries, confirmEntry, updateEntry, deleteEntry, addEntry } = useTimeEntries(userId);
    const { dailyLogs, fetchDailyLogs } = useDailyLogs(userId);
    const { absences, addAbsence, deleteAbsence, deleteAbsenceDay } = useAbsences(userId);
    const { requests, approveRequest, rejectRequest } = useVacationRequests(userId);

    const [currentUser, setCurrentUser] = useState<any>(null);
    const [selectedMonth, setSelectedMonth] = useState(new Date());

    // Vacation View Year State
    const [vacationViewYear, setVacationViewYear] = useState(new Date().getFullYear());

    // Analysis Date Range State
    const [analysisStart, setAnalysisStart] = useState('');
    const [analysisEnd, setAnalysisEnd] = useState('');
    const [showAnalysisStartPicker, setShowAnalysisStartPicker] = useState(false);
    const [showAnalysisEndPicker, setShowAnalysisEndPicker] = useState(false);

    // Filters
    const [activeFilters, setActiveFilters] = useState<string[]>(['company', 'office', 'warehouse', 'car']);

    // Modal & Editing
    const [selectedDay, setSelectedDay] = useState<Date | null>(null);
    const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
    const [editForm, setEditForm] = useState({ date: '', client_name: '', hours: '', start_time: '', end_time: '', note: '' });
    const [newEntryForm, setNewEntryForm] = useState({ client_name: '', hours: '', start_time: '', end_time: '', type: 'work' });

    // Unpaid Reason State in Modal
    const [unpaidReason, setUnpaidReason] = useState('');

    // Vacation Edit
    const [vacationDaysEdit, setVacationDaysEdit] = useState<number | null>(null);

    // --- WORK MODEL EDIT STATE ---
    const [isEditingWorkModel, setIsEditingWorkModel] = useState(false);
    const [workModelTargets, setWorkModelTargets] = useState<any>({});
    const [workModelConfig, setWorkModelConfig] = useState<any>({});
    const [isWorkModelLocked, setIsWorkModelLocked] = useState(false);

    // --- INITIAL OVERTIME BALANCE EDIT STATE ---
    const [initialBalanceEdit, setInitialBalanceEdit] = useState<number>(0);

    useEffect(() => {
        if (users.length === 0) fetchAllUsers();
        else {
            const u = users.find(u => u.user_id === userId);
            setCurrentUser(u);
            if (u) {
                setVacationDaysEdit(u.vacation_days_yearly || 30);
                setIsWorkModelLocked(u.work_config_locked || false);
                setInitialBalanceEdit(u.initial_overtime_balance || 0);

                // Initialize form with current settings as default
                setWorkModelTargets(u.target_hours || { 1: 8.5, 2: 8.5, 3: 8.5, 4: 8.5, 5: 4.5, 6: 0, 0: 0 });
                setWorkModelConfig(u.work_config || { 1: "07:00", 2: "07:00", 3: "07:00", 4: "07:00", 5: "07:00", 6: "07:00", 0: "07:00" });
            }
        }
    }, [users, userId]);

    useEffect(() => {
        fetchDailyLogs();
    }, [fetchDailyLogs]);

    // Use getLocalISOString for accurate initialization
    useEffect(() => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        setAnalysisStart(getLocalISOString(start));
        setAnalysisEnd(getLocalISOString(end));
    }, []);

    // --- Calculations ---
    const year = selectedMonth.getFullYear();
    const month = selectedMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const startDayIndex = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const blanks = Array.from({ length: startDayIndex }, (_, i) => i);

    const monthEntries = useMemo(() => entries.filter(e => {
        if (!e.date) return false;
        const [y, m] = e.date.split('-').map(Number);
        return m === month + 1 && y === year;
    }), [entries, month, year]);

    const analysisEntries = useMemo(() => {
        if (!analysisStart || !analysisEnd) return [];
        return entries.filter(e => {
            if (!e.date) return false;
            return e.date >= analysisStart &&
                e.date <= analysisEnd &&
                activeFilters.includes(e.type || 'work');
        }).sort((a, b) => a.date.localeCompare(b.date));
    }, [entries, analysisStart, analysisEnd, activeFilters]);

    const pendingEntries = useMemo(() => {
        const types = ['company', 'office', 'warehouse', 'car', 'overtime_reduction'];
        return monthEntries.filter(e => types.includes(e.type || '') && !e.confirmed_at);
    }, [monthEntries]);

    const pendingRequests = useMemo(() => requests.filter(r => r.status === 'pending'), [requests]);
    const analysisTotal = analysisEntries.reduce((acc, e) => acc + e.hours, 0);

    // --- LIFETIME BALANCE LOGIC ---

    const totalBalanceStats = useMemo(() => {
        if (!currentUser) return { target: 0, actual: 0, diff: 0, startStr: '' };

        let startStr = currentUser.employment_start_date;
        if (!startStr && entries.length > 0) {
            const sortedEntries = [...entries].sort((a, b) => a.date.localeCompare(b.date));
            startStr = sortedEntries[0].date;
        }
        if (!startStr) startStr = getLocalISOString();

        const todayStr = getLocalISOString();

        if (startStr > todayStr) return { target: 0, actual: 0, diff: 0, startStr };

        // CUTOFF: Submitted regular entries only (ignore overtime_reduction for cutoff to not extend range artificially)
        const relevantEntries = entries.filter(e => e.submitted && e.date <= todayStr);
        const lastRelevantEntry = relevantEntries.sort((a, b) => b.date.localeCompare(a.date))[0];

        if (!lastRelevantEntry) {
            return { target: 0, actual: 0, diff: 0, startStr, cutoffStr: null };
        }

        let cutoffDateStr = lastRelevantEntry.date;
        if (cutoffDateStr < startStr) cutoffDateStr = startStr;

        let totalTarget = 0;
        let totalCredits = 0;

        let curr = new Date(startStr);
        curr.setHours(12, 0, 0, 0);
        const end = new Date(cutoffDateStr);
        end.setHours(12, 0, 0, 0);

        // Fallback targets from user settings
        const currentTargets = currentUser.target_hours || {};

        while (curr.getTime() <= end.getTime()) {
            const dateStr = getLocalISOString(curr);

            // Simplified Target Calculation (No History)
            const dailyTarget = getDailyTargetForDate(dateStr, currentTargets);

            const absence = absences.find(a => dateStr >= a.start_date && dateStr <= a.end_date);
            const entryAbsence = entries.find(e => e.date === dateStr && ['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay'].includes(e.type || ''));

            let isUnpaid = false;
            let isPaidAbsence = false;

            if (absence) {
                if (absence.type === 'unpaid' || absence.type === 'sick_child' || absence.type === 'sick_pay') isUnpaid = true;
                else isPaidAbsence = true;
            } else if (entryAbsence) {
                if (entryAbsence.type === 'unpaid' || entryAbsence.type === 'sick_child' || entryAbsence.type === 'sick_pay') isUnpaid = true;
                else isPaidAbsence = true;
            }

            if (!isUnpaid) {
                totalTarget += dailyTarget;
                if (isPaidAbsence) {
                    totalCredits += dailyTarget;
                }
            }
            curr.setDate(curr.getDate() + 1);
        }

        const projectHours = entries
            .filter(e => {
                // EXCLUDE overtime_reduction from "Actuals" so it reduces the balance
                return e.date >= startStr &&
                    e.date <= cutoffDateStr &&
                    !['break', 'vacation', 'sick', 'holiday', 'unpaid', 'overtime_reduction'].includes(e.type || '');
            })
            .reduce((sum, e) => sum + e.hours, 0);

        // FUTURE OVERTIME REDUCTION
        // Check for any CONFIRMED overtime_reduction entries AFTER the cutoff date
        const futureReductions = entries
            .filter(e => {
                return e.type === 'overtime_reduction' &&
                    e.confirmed_at && // Must be confirmed by office
                    e.date > cutoffDateStr; // Only count those strictly AFTER the normal calculation period
            })
            .reduce((sum, e) => sum + e.hours, 0);

        // ADD INITIAL BALANCE
        const initialBalance = currentUser.initial_overtime_balance || 0;

        return {
            target: totalTarget,
            actual: projectHours + totalCredits,
            diff: (projectHours + totalCredits) - totalTarget - futureReductions + initialBalance,
            startStr,
            cutoffStr: cutoffDateStr
        };

    }, [currentUser, entries, absences]);


    // --- ABSENCE ANALYSIS ---
    const unpaidDaysInYear = useMemo(() => {
        if (!absences) return 0;
        return absences
            .filter(a => a.type === 'unpaid')
            .reduce((total, a) => {
                const start = new Date(a.start_date);
                const end = new Date(a.end_date);
                let daysCount = 0;
                let current = new Date(start);
                while (current <= end) {
                    if (current.getFullYear() === vacationViewYear) {
                        const dayOfWeek = current.getDay();
                        if (dayOfWeek !== 0 && dayOfWeek !== 6) daysCount++;
                    }
                    current.setDate(current.getDate() + 1);
                }
                return total + daysCount;
            }, 0);
    }, [absences, vacationViewYear]);

    // --- MONTHLY ATTENDANCE CALCULATION ---
    const monthlyAttendance = useMemo(() => {
        let total = 0;
        const startOfMonth = new Date(year, month, 1);
        const endOfMonth = new Date(year, month + 1, 0);
        const startStr = getLocalISOString(startOfMonth);
        const endStr = getLocalISOString(endOfMonth);

        // Filter logs for this month
        const logs = dailyLogs.filter(l => l.date >= startStr && l.date <= endStr);

        logs.forEach(log => {
            if (log.start_time && log.end_time) {
                const start = new Date(`2000-01-01T${log.start_time}`);
                const end = new Date(`2000-01-01T${log.end_time}`);
                let duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                if (duration < 0) duration += 24; // Handle over midnight if needed (though unlikely for daily log structure)

                // Subtract breaks for this day
                const dayBreaks = entries.filter(e => e.date === log.date && e.type === 'break')
                    .reduce((sum, b) => sum + b.hours, 0);

                total += Math.max(0, duration - dayBreaks);
            }
        });

        return total;
    }, [dailyLogs, entries, year, month]);

    const effectiveVacationClaim = useMemo(() => {
        const base = vacationDaysEdit || 30;
        if (unpaidDaysInYear === 0) return base;
        const reduction = (unpaidDaysInYear / 260) * base;
        return Math.max(0, base - reduction);
    }, [vacationDaysEdit, unpaidDaysInYear]);

    const takenVacationDays = useMemo(() => {
        if (!absences) return 0;
        return absences
            .filter(a => a.type === 'vacation')
            .reduce((total, a) => {
                const start = new Date(a.start_date);
                const end = new Date(a.end_date);
                let daysCount = 0;
                let current = new Date(start);
                while (current <= end) {
                    if (current.getFullYear() === vacationViewYear) {
                        const dayOfWeek = current.getDay();
                        if (dayOfWeek !== 0 && dayOfWeek !== 6) daysCount++;
                    }
                    current.setDate(current.getDate() + 1);
                }
                return total + daysCount;
            }, 0);
    }, [absences, vacationViewYear]);

    const groupedAbsences = useMemo(() => {
        if (!absences || absences.length === 0) return [];
        const sorted = [...absences].sort((a, b) => a.start_date.localeCompare(b.start_date));

        const groups: { start: string, end: string, type: 'vacation' | 'sick' | 'holiday' | 'unpaid' | 'sick_child' | 'sick_pay', note?: string }[] = [];
        if (sorted.length === 0) return [];
        let currentGroup = { start: sorted[0].start_date, end: sorted[0].end_date, type: sorted[0].type, note: sorted[0].note };

        for (let i = 1; i < sorted.length; i++) {
            const current = sorted[i];
            const prevEnd = new Date(currentGroup.end);
            const currStart = new Date(current.start_date);
            const diffTime = Math.abs(currStart.getTime() - prevEnd.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (current.type === currentGroup.type && diffDays <= 1 && current.note === currentGroup.note) {
                if (current.end_date > currentGroup.end) currentGroup.end = current.end_date;
            } else {
                groups.push(currentGroup);
                currentGroup = { start: current.start_date, end: current.end_date, type: current.type, note: current.note };
            }
        }
        groups.push(currentGroup);

        return groups.filter(g => {
            const s = new Date(g.start).getFullYear();
            const e = new Date(g.end).getFullYear();
            return (s === vacationViewYear || e === vacationViewYear || (s < vacationViewYear && e > vacationViewYear));
        }).sort((a, b) => b.start.localeCompare(a.start));
    }, [absences, vacationViewYear]);

    // --- WORK MODEL HANDLERS ---

    const handleToggleLock = async () => {
        if (!userId) return;
        const newState = !isWorkModelLocked;
        setIsWorkModelLocked(newState);
        await updateOfficeUserSettings(userId, { work_config_locked: newState });
    };

    const handleSaveWorkModel = async () => {
        if (!userId) return;

        await updateOfficeUserSettings(userId, {
            target_hours: workModelTargets,
            work_config: workModelConfig
        });

        if (currentUser) {
            setCurrentUser({
                ...currentUser,
                target_hours: workModelTargets,
                work_config: workModelConfig
            });
        }
        setIsEditingWorkModel(false);
    };

    const handleWorkModelTargetChange = (day: number, val: string) => {
        setWorkModelTargets((prev: any) => ({
            ...prev,
            [day]: parseFloat(val) || 0
        }));
    };

    const handleWorkModelConfigChange = (day: number, val: string) => {
        setWorkModelConfig((prev: any) => ({
            ...prev,
            [day]: val
        }));
    };

    const handleSaveInitialBalance = async () => {
        if (!userId) return;
        await updateOfficeUserSettings(userId, { initial_overtime_balance: initialBalanceEdit });
        if (currentUser) {
            setCurrentUser({
                ...currentUser,
                initial_overtime_balance: initialBalanceEdit
            });
        }
    };

    // --- Helper Functions for Modal ---
    const getSelectedDateString = () => {
        if (!selectedDay) return '';
        // Use local ISO string to ensure selected day is represented correctly
        return getLocalISOString(selectedDay);
    };

    const handleDayClick = (day: number) => {
        const date = new Date(year, month, day);
        setSelectedDay(date);

        // Reset forms
        const dateStr = getLocalISOString(date);
        setEditForm({ date: dateStr, client_name: '', hours: '', start_time: '', end_time: '', note: '' });
        setNewEntryForm({ client_name: '', hours: '', start_time: '', end_time: '', type: 'work' });
        setUnpaidReason('');
    };

    const handleAddAbsence = async (type: 'vacation' | 'sick' | 'holiday' | 'unpaid' | 'sick_child' | 'sick_pay') => {
        if (!selectedDay || !userId) return;
        const dateStr = getSelectedDateString();
        let note = '';
        if (type === 'vacation') note = 'Urlaub';
        else if (type === 'sick') note = 'Krank';
        else if (type === 'holiday') note = 'Feiertag';
        else if (type === 'sick_child') note = 'Kind krank';
        else if (type === 'sick_pay') note = 'Krankengeld';
        else if (type === 'unpaid') {
            if (!unpaidReason) {
                alert("Bitte eine Begründung für den unbezahlten Tag angeben.");
                return;
            }
            note = unpaidReason;
        }
        await addAbsence({
            user_id: userId,
            start_date: dateStr,
            end_date: dateStr,
            type: type,
            note: note
        });
        setSelectedDay(null);
    };

    const handleRemoveAbsence = async (id: string) => {
        await deleteAbsence(id);
        setSelectedDay(null);
    };

    const handleAddEntry = async () => {
        if (!selectedDay || !newEntryForm.client_name) return;
        const dateStr = getSelectedDateString();

        await addEntry({
            date: dateStr,
            client_name: newEntryForm.client_name,
            hours: parseFloat(newEntryForm.hours.replace(',', '.')) || 0,
            start_time: newEntryForm.start_time || undefined,
            end_time: newEntryForm.end_time || undefined,
            type: newEntryForm.type as any,
            submitted: true
        });

        setNewEntryForm({ client_name: '', hours: '', start_time: '', end_time: '', type: 'work' });
    };

    const handleSaveEntryEdit = async () => {
        if (!editingEntry) return;
        await updateEntry(editingEntry.id, {
            hours: parseFloat(editForm.hours.replace(',', '.')),
            start_time: editForm.start_time || undefined,
            end_time: editForm.end_time || undefined,
            note: editForm.note || undefined
        });
        setEditingEntry(null);
    };

    // --- UI Helpers ---
    const dayNames = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    const dayIndices = [1, 2, 3, 4, 5, 6, 0];

    const selectedDateStr = getSelectedDateString();
    const currentAbsence = selectedDay ? absences.find(a => selectedDateStr >= a.start_date && selectedDateStr <= a.end_date) : null;
    const modalEntries = useMemo(() => {
        if (!selectedDay) return [];
        return entries.filter(e => e.date === selectedDateStr);
    }, [selectedDateStr, entries]);

    const modalAttendanceStats = useMemo(() => {
        const dailyLog = dailyLogs.find(l => l.date === selectedDateStr);
        if (!dailyLog || !dailyLog.start_time || !dailyLog.end_time) return null;

        const start = new Date(`2000-01-01T${dailyLog.start_time}`);
        const end = new Date(`2000-01-01T${dailyLog.end_time}`);
        let diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        // Breaks
        const breaks = modalEntries.filter(e => e.type === 'break').reduce((s, b) => s + b.hours, 0);
        const netto = Math.max(0, diff - breaks);

        return {
            attendanceStr: `${dailyLog.start_time} - ${dailyLog.end_time}`,
            pauseStr: formatDuration(breaks) + ' h',
            nettoStr: formatDuration(netto) + ' h'
        };
    }, [dailyLogs, selectedDateStr, modalEntries]);

    return (
        <div className="p-6 pb-24 h-full overflow-y-auto md:max-w-6xl md:mx-auto w-full">
            <div className="flex items-center justify-between mb-6">
                <button onClick={() => navigate('/office/users')} className="flex items-center gap-2 text-white/50 hover:text-white transition-colors">
                    <ChevronLeft size={20} /> Zurück
                </button>
                <h1 className="text-2xl font-bold text-white">{currentUser?.display_name || 'Benutzer'}</h1>
            </div>

            {/* PENDING REQUESTS SECTION */}
            {pendingRequests.length > 0 && (
                <div className="mb-8 animate-in slide-in-from-top-4 duration-300">
                    <GlassCard className="!border-purple-500/30 bg-purple-900/10">
                        <div className="flex items-center gap-2 text-purple-400 font-bold uppercase text-xs tracking-wider mb-3">
                            <CalendarHeart size={16} /> Offene Urlaubsanträge ({pendingRequests.length})
                        </div>
                        <div className="space-y-3">
                            {pendingRequests.map(req => (
                                <div key={req.id} className="bg-white/5 p-3 rounded-xl border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div>
                                        <div className="font-bold text-white text-lg">
                                            {new Date(req.start_date).toLocaleDateString('de-DE')} - {new Date(req.end_date).toLocaleDateString('de-DE')}
                                        </div>
                                        {req.note && <div className="text-white/50 text-sm italic">"{req.note}"</div>}
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => rejectRequest(req.id)} className="flex items-center gap-2 px-3 py-2 bg-red-500/20 text-red-300 border border-red-500/30 rounded-lg hover:bg-red-500/30 font-bold text-sm transition-colors">
                                            <XCircle size={16} /> Ablehnen
                                        </button>
                                        <button onClick={() => approveRequest(req)} className="flex items-center gap-2 px-3 py-2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 font-bold text-sm transition-colors">
                                            <CalendarCheck size={16} /> Genehmigen & Eintragen
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </GlassCard>
                </div>
            )}

            {/* PENDING CONFIRMATIONS */}
            {pendingEntries.length > 0 && (
                <div className="mb-8 animate-in slide-in-from-top-4 duration-300">
                    <GlassCard className="!border-orange-500/30 bg-orange-900/10">
                        <div className="flex items-center gap-2 text-orange-400 font-bold uppercase text-xs tracking-wider mb-3">
                            <AlertTriangle size={16} /> Offene Bestätigungen ({pendingEntries.length})
                        </div>
                        <div className="text-sm text-white/60">
                            {pendingEntries.length} Einträge warten auf Bestätigung.
                        </div>
                    </GlassCard>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                {/* OVERTIME ACCOUNT / LIFETIME BALANCE */}
                <GlassCard className="relative overflow-hidden group bg-emerald-900/10 border-emerald-500/20 flex flex-col justify-between">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Scale size={100} className="text-emerald-300" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 text-emerald-400 font-bold uppercase text-xs tracking-wider mb-3">
                            <Clock size={16} /> Überstundenkonto
                        </div>
                        <div className="flex items-baseline gap-2 mb-1">
                            <span className={`text-4xl font-bold font-mono ${totalBalanceStats.diff >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                                {totalBalanceStats.diff > 0 ? '+' : ''}{totalBalanceStats.diff.toFixed(2)}
                            </span>
                            <span className="text-sm text-white/40 font-bold">Std</span>
                        </div>
                        <div className={`text-xs font-bold flex items-center gap-1 ${totalBalanceStats.diff >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                            {totalBalanceStats.diff >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                            {totalBalanceStats.diff >= 0 ? 'Guthaben' : 'Minusstunden'}
                        </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-white/5 space-y-1">
                        <div className="flex justify-between text-xs">
                            <span className="text-white/50">Gesamt Ist:</span>
                            <span className="text-white font-mono">{totalBalanceStats.actual.toFixed(2)} h</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-white/50">Gesamt Soll:</span>
                            <span className="text-white font-mono">{totalBalanceStats.target.toFixed(2)} h</span>
                        </div>
                        <div className="flex justify-between text-xs mt-2 text-white/30 italic">
                            <span>Seit:</span>
                            <span>{totalBalanceStats.startStr ? new Date(totalBalanceStats.startStr).toLocaleDateString('de-DE') : '-'}</span>
                        </div>
                        <div className="flex justify-between text-xs text-white/30 italic">
                            <span>Stand (Abgegeben / Abbau):</span>
                            <span>{totalBalanceStats.cutoffStr ? new Date(totalBalanceStats.cutoffStr).toLocaleDateString('de-DE') : '-'}</span>
                        </div>
                    </div>
                </GlassCard>

                {/* INITIAL BALANCE / TRANSFER */}
                <GlassCard className="bg-cyan-900/10 border-cyan-500/20 relative flex flex-col justify-between">
                    <div>
                        <div className="flex items-center gap-2 text-cyan-300 font-bold uppercase text-xs tracking-wider mb-2">
                            <Calculator size={16} /> Startsaldo / Übertrag
                        </div>
                        <p className="text-[10px] text-white/40 mb-3">
                            Überstunden aus Vorjahren oder anderen Systemen. Wird zum Konto addiert.
                        </p>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                step="0.5"
                                value={initialBalanceEdit}
                                onChange={e => setInitialBalanceEdit(parseFloat(e.target.value) || 0)}
                                className="bg-black/30 text-white text-lg font-mono font-bold rounded px-3 py-2 text-right border border-white/10 w-full focus:outline-none focus:border-cyan-500/50"
                            />
                            <span className="text-white/50 font-bold text-xs">h</span>
                        </div>
                    </div>
                    <div className="mt-3 flex justify-end">
                        <button onClick={handleSaveInitialBalance} className="px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500/30 rounded text-cyan-200 text-xs font-bold transition-colors flex items-center gap-1">
                            <Save size={14} /> Speichern
                        </button>
                    </div>
                </GlassCard>

                {/* WORK MODEL CONFIG (SIMPLE) */}
                <GlassCard className="bg-blue-900/10 border-blue-500/20 relative flex flex-col h-full">
                    <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2 text-blue-300 font-bold uppercase text-xs tracking-wider">
                            <Briefcase size={16} /> Arbeitszeit-Modell
                        </div>
                        {isEditingWorkModel ? (
                            <div className="flex gap-2">
                                <button onClick={() => setIsEditingWorkModel(false)} className="p-1 bg-white/10 hover:bg-white/20 rounded text-white/60"><RotateCcw size={14} /></button>
                                <button onClick={handleSaveWorkModel} className="p-1 bg-teal-500 hover:bg-teal-400 rounded text-white"><Save size={14} /></button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <button onClick={handleToggleLock} className="p-1 hover:bg-white/10 rounded" title={isWorkModelLocked ? "Entsperren" : "Sperren"}>
                                    {isWorkModelLocked ? <Lock size={14} className="text-red-400" /> : <Unlock size={14} className="text-emerald-400" />}
                                </button>
                                <button onClick={() => setIsEditingWorkModel(true)} className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-white" title="Bearbeiten">
                                    <Edit2 size={14} />
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto mt-2">
                        <div className="grid grid-cols-3 gap-1 mb-2 px-1">
                            <span className="text-[10px] uppercase font-bold text-white/30">Tag</span>
                            <span className="text-[10px] uppercase font-bold text-white/30 text-center">Start</span>
                            <span className="text-[10px] uppercase font-bold text-white/30 text-right">Std</span>
                        </div>
                        <div className="space-y-1">
                            {dayIndices.map((d, i) => {
                                const target = workModelTargets[d] || 0;
                                const start = workModelConfig[d] || "07:00";
                                return (
                                    <div key={d} className={`grid grid-cols-3 gap-1 items-center px-2 py-1.5 rounded border ${isEditingWorkModel ? 'bg-white/10 border-white/10' : 'bg-transparent border-transparent'}`}>
                                        <span className={`text-xs font-bold ${d === 0 || d === 6 ? 'text-red-300/70' : 'text-white/70'}`}>{dayNames[i]}</span>
                                        {isEditingWorkModel ? (
                                            <>
                                                <input type="time" value={start} onChange={e => handleWorkModelConfigChange(d, e.target.value)} className="bg-black/30 text-white text-xs rounded px-1 py-0.5 text-center border border-white/10 w-full" />
                                                <input type="number" value={target} onChange={e => handleWorkModelTargetChange(d, e.target.value)} className="bg-black/30 text-white text-xs rounded px-1 py-0.5 text-right border border-white/10 w-full" />
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-xs text-white/50 text-center">{start}</span>
                                                <span className={`text-xs font-mono text-right font-bold ${target > 0 ? 'text-white' : 'text-white/20'}`}>{target} h</span>
                                            </>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                    {isEditingWorkModel && (
                        <div className="mt-2 text-[10px] text-orange-300 italic flex items-center gap-1">
                            <Unlock size={10} /> Bearbeitungsmodus aktiv
                        </div>
                    )}
                </GlassCard>

                {/* Vacation Mgmt */}
                <GlassCard className="bg-purple-900/10 border-purple-500/20 relative flex flex-col h-full">
                    <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2 text-purple-300 font-bold uppercase text-xs tracking-wider">
                            <Palmtree size={16} /> Urlaubsverwaltung
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex items-center bg-white/5 rounded-lg px-2 py-1 gap-2">
                                <button onClick={() => setVacationViewYear(y => y - 1)} className="text-purple-200 hover:text-white"><ChevronLeft size={14} /></button>
                                <span className="text-sm font-bold text-white">{vacationViewYear}</span>
                                <button onClick={() => setVacationViewYear(y => y + 1)} className="text-purple-200 hover:text-white"><ChevronRight size={14} /></button>
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-between items-end mb-4">
                        <div className="text-right w-full">
                            <span className="text-3xl font-bold text-purple-100">{takenVacationDays}</span>
                            <span className="text-purple-300/50 text-sm"> / {effectiveVacationClaim.toFixed(1)} Tage</span>
                        </div>
                    </div>
                    {unpaidDaysInYear > 0 && (
                        <div className="mb-3 px-2 py-1.5 bg-red-900/20 border border-red-500/10 rounded text-xs text-red-200 flex items-start gap-2">
                            <Info size={14} className="mt-0.5 shrink-0" />
                            <div>
                                <span className="font-bold">{unpaidDaysInYear} Tage Unbezahlt.</span>
                                <br />
                                <span className="opacity-70">Anspruch reduziert um {(vacationDaysEdit! - effectiveVacationClaim).toFixed(1)} Tage.</span>
                            </div>
                        </div>
                    )}
                    <div className="pt-2 border-t border-white/5 flex items-center justify-between mb-4">
                        <label className="text-xs text-white/50">Basis-Anspruch:</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={vacationDaysEdit || ''}
                                onChange={e => setVacationDaysEdit(parseFloat(e.target.value))}
                                className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-right text-sm text-white"
                            />
                            {/* Reusing existing update function for vacation days */}
                            <button onClick={() => { if (userId && vacationDaysEdit !== null) updateOfficeUserSettings(userId, { vacation_days_yearly: vacationDaysEdit }) }} className="p-1 bg-purple-500/20 rounded hover:bg-purple-500/40 text-purple-200"><Save size={14} /></button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto max-h-32 space-y-1 pr-1 border-t border-white/5 pt-2 mt-auto">
                        <label className="text-[10px] uppercase font-bold text-white/30 block mb-1">Abwesenheiten ({vacationViewYear})</label>
                        {groupedAbsences.length === 0 ? (
                            <p className="text-xs text-white/30 italic">Keine Einträge für {vacationViewYear}.</p>
                        ) : (
                            groupedAbsences.map((group, idx) => {
                                const start = new Date(group.start).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                const end = new Date(group.end).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                const isRange = group.start !== group.end;
                                let typeColor = 'text-white';
                                let typeLabel = '';

                                if (group.type === 'vacation') { typeColor = 'text-purple-300'; typeLabel = 'Urlaub'; }
                                else if (group.type === 'sick') { typeColor = 'text-red-300'; typeLabel = 'Krank'; }
                                else if (group.type === 'holiday') { typeColor = 'text-blue-300'; typeLabel = 'Feiertag'; }
                                else if (group.type === 'sick_child') { typeColor = 'text-orange-300'; typeLabel = 'Kind krank'; }
                                else if (group.type === 'sick_pay') { typeColor = 'text-rose-300'; typeLabel = 'Krankengeld'; }
                                else if (group.type === 'unpaid') { typeColor = 'text-gray-400'; typeLabel = 'Unbezahlt'; }
                                return (
                                    <div key={idx} className="flex justify-between items-center text-xs bg-white/5 px-2 py-1 rounded">
                                        <div className="flex flex-col">
                                            <span className={`font-mono ${typeColor}`}>{isRange ? `${start} - ${end}` : start}</span>
                                            {group.note && group.type === 'unpaid' && <span className="text-[9px] text-white/30 italic">{group.note}</span>}
                                        </div>
                                        <span className={`opacity-50 text-[10px] uppercase ${typeColor}`}>{typeLabel}</span>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </GlassCard>

                {/* Monthly Attendance Tile */}
                <GlassCard className="bg-cyan-900/10 border-cyan-500/20 relative flex flex-col justify-between">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <UserCheck size={100} className="text-cyan-300" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase text-xs tracking-wider mb-3">
                            <Clock size={16} /> Anwesenheit (Monat)
                        </div>
                        <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-4xl font-bold font-mono text-cyan-300">
                                {formatDuration(monthlyAttendance)}
                            </span>
                            <span className="text-sm text-white/40 font-bold">h</span>
                        </div>
                        <div className="text-xs text-white/40 font-bold">
                            Netto-Arbeitszeit
                        </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-white/5">
                        <div className="flex justify-between text-xs text-white/30 italic">
                            <span>Basis:</span>
                            <span>Kommen/Gehen - Pause</span>
                        </div>
                    </div>
                </GlassCard>
            </div>

            <div className="mb-4 flex justify-between items-center bg-white/5 p-2 rounded-xl">
                <div className="flex items-center gap-2">
                    <button onClick={() => setSelectedMonth(new Date(year, month - 1))} className="p-2 text-white hover:bg-white/10 rounded"><ChevronLeft /></button>
                    <span className="font-bold text-white">{selectedMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</span>
                    <button onClick={() => setSelectedMonth(new Date(year, month + 1))} className="p-2 text-white hover:bg-white/10 rounded"><ChevronRight /></button>
                </div>
            </div>

            <div className="grid grid-cols-7 gap-2 mb-8">
                {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => <div key={d} className="text-center text-xs text-white/30 font-bold uppercase">{d}</div>)}
                {blanks.map(b => <div key={`b-${b}`} />)}
                {days.map(day => {
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const absence = absences.find(a => dateStr >= a.start_date && dateStr <= a.end_date);

                    let status = 'empty';
                    if (absence) status = absence.type;
                    else {
                        const dayEntries = monthEntries.filter(e => e.date === dateStr);
                        if (dayEntries.length > 0) {
                            const hours = dayEntries.reduce((acc, e) => e.type === 'break' ? acc : acc + e.hours, 0);
                            const target = getDailyTargetForDate(dateStr, currentUser?.target_hours || {});
                            if (hours >= target && target > 0) status = 'full';
                            else if (hours > 0) status = 'partial';
                        }
                    }

                    let bg = 'bg-white/5 border-white/5';
                    let text = 'text-white/50';
                    let icon = null;
                    if (status === 'vacation') { bg = 'bg-purple-500/20 border-purple-500/40'; text = 'text-purple-200'; icon = <Palmtree size={12} className="text-purple-300 mt-1" />; }
                    else if (status === 'sick') { bg = 'bg-red-500/20 border-red-500/40'; text = 'text-red-200'; icon = <Stethoscope size={12} className="text-red-300 mt-1" />; }
                    else if (status === 'holiday') { bg = 'bg-blue-500/20 border-blue-500/40'; text = 'text-blue-200'; icon = <CalendarHeart size={12} className="text-blue-300 mt-1" />; }
                    else if (status === 'unpaid') { bg = 'bg-gray-700/40 border-gray-500/40'; text = 'text-gray-300'; icon = <Ban size={12} className="text-gray-400 mt-1" />; }
                    else if (status === 'full') { bg = 'bg-emerald-500/20 border-emerald-500/40'; text = 'text-emerald-200'; }
                    else if (status === 'full') { bg = 'bg-emerald-500/20 border-emerald-500/40'; text = 'text-emerald-200'; }
                    else if (status === 'sick_child') { bg = 'bg-orange-500/20 border-orange-500/40'; text = 'text-orange-200'; icon = <UserCheck size={12} className="text-orange-300 mt-1" />; }
                    else if (status === 'sick_pay') { bg = 'bg-rose-500/20 border-rose-500/40'; text = 'text-rose-200'; icon = <Stethoscope size={12} className="text-rose-300 mt-1" />; }
                    else if (status === 'partial') { bg = 'bg-yellow-500/20 border-yellow-500/40'; text = 'text-yellow-200'; }

                    return (
                        <div
                            key={day}
                            onClick={() => handleDayClick(day)}
                            className={`aspect-square rounded-lg border ${bg} flex flex-col items-center justify-center cursor-pointer hover:scale-105 transition-transform relative`}
                        >
                            <span className={`text-sm font-bold ${text}`}>{day}</span>
                            {icon}
                        </div>
                    )
                })}
            </div>

            {/* MODAL: Calendar Day Detail (RESTORED) */}
            {selectedDay && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
                    <GlassCard className="w-full max-w-lg max-h-[90vh] overflow-y-auto relative shadow-2xl border-white/20">
                        <button onClick={() => setSelectedDay(null)} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"><X size={20} /></button>
                        <div className="mb-6">
                            <h3 className="text-2xl font-bold text-white">{selectedDay.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}</h3>
                            <p className="text-white/40 text-sm">Tagesdetails bearbeiten</p>
                        </div>

                        {currentAbsence ? (
                            <div className="mb-8">
                                <div className={`rounded-xl border p-4 flex flex-col gap-2 ${currentAbsence.type === 'vacation' ? 'bg-purple-900/20 border-purple-500/30' :
                                    currentAbsence.type === 'sick' ? 'bg-red-900/20 border-red-500/30' :
                                        currentAbsence.type === 'holiday' ? 'bg-blue-900/20 border-blue-500/30' :
                                            currentAbsence.type === 'sick_child' ? 'bg-orange-900/20 border-orange-500/30' :
                                                currentAbsence.type === 'sick_pay' ? 'bg-rose-900/20 border-rose-500/30' :
                                                    'bg-gray-800/40 border-gray-500/30'
                                    }`}>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            {currentAbsence.type === 'vacation' ? <Palmtree size={24} className="text-purple-300" /> :
                                                currentAbsence.type === 'sick' ? <Stethoscope size={24} className="text-red-300" /> :
                                                    currentAbsence.type === 'holiday' ? <CalendarHeart size={24} className="text-blue-300" /> :
                                                        currentAbsence.type === 'sick_child' ? <UserCheck size={24} className="text-orange-300" /> :
                                                            currentAbsence.type === 'sick_pay' ? <Stethoscope size={24} className="text-rose-300" /> :
                                                                <Ban size={24} className="text-gray-300" />}
                                            <div>
                                                <h4 className={`font-bold ${currentAbsence.type === 'vacation' ? 'text-purple-100' :
                                                    currentAbsence.type === 'sick' ? 'text-red-100' :
                                                        currentAbsence.type === 'holiday' ? 'text-blue-100' :
                                                            currentAbsence.type === 'sick_child' ? 'text-orange-100' :
                                                                currentAbsence.type === 'sick_pay' ? 'text-rose-100' :
                                                                    'text-gray-100'
                                                    }`}>
                                                    {currentAbsence.type === 'vacation' ? 'Urlaub' :
                                                        currentAbsence.type === 'sick' ? 'Krank' :
                                                            currentAbsence.type === 'holiday' ? 'Feiertag' :
                                                                currentAbsence.type === 'sick_child' ? 'Kind krank' :
                                                                    currentAbsence.type === 'sick_pay' ? 'Krankengeld' :
                                                                        'Unbezahlt'}
                                                </h4>
                                            </div>
                                        </div>
                                        <button onClick={() => handleRemoveAbsence(currentAbsence.id)} className="px-3 py-2 bg-white/10 hover:bg-red-500/20 hover:text-red-200 border border-white/10 hover:border-red-500/30 rounded-lg text-xs font-bold transition-all flex items-center gap-2">
                                            <Trash2 size={14} /> Löschen
                                        </button>
                                    </div>
                                    {currentAbsence.note && <div className="text-xs text-white/50 italic mt-1 border-t border-white/5 pt-2">"{currentAbsence.note}"</div>}
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
                                <button onClick={() => handleAddAbsence('vacation')} className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-purple-500/30 bg-purple-900/20 hover:bg-purple-900/40 transition-all text-purple-100 font-bold text-xs"><Palmtree size={20} /> Urlaub</button>
                                <button onClick={() => handleAddAbsence('sick')} className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-red-500/30 bg-red-900/20 hover:bg-red-900/40 transition-all text-red-100 font-bold text-xs"><Stethoscope size={20} /> Krank</button>
                                <button onClick={() => handleAddAbsence('holiday')} className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-blue-500/30 bg-blue-900/20 hover:bg-blue-900/40 transition-all text-blue-100 font-bold text-xs"><CalendarHeart size={20} /> Feiertag</button>
                                <button onClick={() => { if (!unpaidReason) return; handleAddAbsence('unpaid'); }} disabled={!unpaidReason} className="w-full h-full flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-gray-500/30 bg-gray-800/40 hover:bg-gray-800/60 transition-all text-gray-200 font-bold text-xs disabled:opacity-50"><Ban size={20} /> Unbezahlt</button>
                                <button onClick={() => handleAddAbsence('sick_child')} className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-orange-500/30 bg-orange-900/20 hover:bg-orange-900/40 transition-all text-orange-100 font-bold text-xs"><UserCheck size={20} /> Kind krank</button>
                                <button onClick={() => handleAddAbsence('sick_pay')} className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-rose-500/30 bg-rose-900/20 hover:bg-rose-900/40 transition-all text-rose-100 font-bold text-xs"><Stethoscope size={20} /> Krankengeld</button>
                                {/* NEW Overtime Reduction Button */}
                                <button onClick={() => {
                                    setNewEntryForm({
                                        client_name: 'Überstundenabbau',
                                        hours: (currentUser?.target_hours?.[selectedDay?.getDay() || 0] || 0).toString(),
                                        start_time: '',
                                        end_time: '',
                                        type: 'overtime_reduction'
                                    });
                                }} className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-pink-500/30 bg-pink-900/20 hover:bg-pink-900/40 transition-all text-pink-100 font-bold text-xs">
                                    <TrendingDown size={20} /> Überstd. Abbau
                                </button>

                                <div className="col-span-2 md:col-span-5 mt-2">
                                    <input type="text" placeholder="Begründung für Unbezahlt (z.B. Kinderkrank)..." value={unpaidReason} onChange={e => setUnpaidReason(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 focus:border-gray-500/50 outline-none" />
                                </div>
                            </div>
                        )}

                        <div className="w-full h-px bg-white/10 mb-6" />

                        {/* 1. ATTENDANCE SECTION (Once) */}
                        {modalAttendanceStats && (
                            <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                <div className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <UserCheck size={14} /> Anwesenheit
                                </div>
                                <div className="bg-cyan-900/10 border border-cyan-500/20 rounded-xl p-3 flex justify-between items-center">
                                    <div className="text-center">
                                        <div className="text-[10px] text-cyan-200/50 uppercase font-bold mb-1">Zeitraum</div>
                                        <div className="text-lg font-mono font-bold text-cyan-100">{modalAttendanceStats.attendanceStr}</div>
                                    </div>
                                    <div className="h-8 w-px bg-cyan-500/20"></div>
                                    <div className="text-center">
                                        <div className="text-[10px] text-cyan-200/50 uppercase font-bold mb-1">Pause</div>
                                        <div className="text-lg font-mono font-bold text-cyan-100">{modalAttendanceStats.pauseStr}</div>
                                    </div>
                                    <div className="h-8 w-px bg-cyan-500/20"></div>
                                    <div className="text-center">
                                        <div className="text-[10px] text-cyan-200/50 uppercase font-bold mb-1">Netto</div>
                                        <div className="text-xl font-mono font-bold text-cyan-300">{modalAttendanceStats.nettoStr}</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="space-y-4 mb-8">
                            <h4 className="text-xs uppercase font-bold text-white/50 tracking-wider">Arbeits-Einträge</h4>
                            {modalEntries.length === 0 && (
                                <div className="text-center py-6 bg-white/5 rounded-xl border border-white/5 border-dashed">
                                    <p className="text-white/30 text-sm italic">Keine Einträge für diesen Tag.</p>
                                </div>
                            )}
                            {modalEntries.map(entry => (
                                <div key={entry.id} className="bg-white/5 p-4 rounded-xl border border-white/10 transition-colors hover:bg-white/10">
                                    {editingEntry?.id === entry.id ? (
                                        <div className="space-y-3 animate-in fade-in duration-200">
                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="col-span-2">
                                                    <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Beschreibung</label>
                                                    <GlassInput type="text" value={editForm.client_name} onChange={e => setEditForm({ ...editForm, client_name: e.target.value })} className="!py-2 !text-sm" />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Stunden</label>
                                                    <GlassInput type="number" value={editForm.hours} onChange={e => setEditForm({ ...editForm, hours: e.target.value })} className="!py-2 !text-sm text-center" />
                                                </div>
                                            </div>
                                            <div className="flex justify-end gap-2 pt-2">
                                                <button onClick={() => setEditingEntry(null)} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-colors">Abbrechen</button>
                                                <button onClick={handleSaveEntryEdit} className="px-3 py-2 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition-colors flex items-center gap-2"><Save size={14} /> Speichern</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-full flex items-center justify-center border border-white/10 ${entry.type === 'break' ? 'bg-orange-500/20 text-orange-300' : entry.type === 'overtime_reduction' ? 'bg-pink-500/20 text-pink-300' : 'bg-teal-500/20 text-teal-300'}`}>
                                                    {entry.type === 'break' ? <Coffee size={18} /> : entry.type === 'overtime_reduction' ? <TrendingDown size={18} /> : <Briefcase size={18} />}
                                                </div>
                                                <div>
                                                    <p className="text-white font-bold text-sm">{entry.client_name}</p>
                                                    <div className="flex items-center gap-2 text-white/40 text-xs font-mono mt-0.5">
                                                        <span>{entry.start_time || '--:--'} - {entry.end_time || '--:--'}</span>
                                                        <span className="w-1 h-1 rounded-full bg-white/20"></span>
                                                        <span className="uppercase">{entry.type === 'overtime_reduction' ? 'Abbau' : entry.type}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="text-right mr-2">
                                                    <span className="block font-mono font-bold text-white text-lg leading-none">{entry.hours.toFixed(2)}</span>
                                                    <span className="text-[10px] text-white/30 uppercase">Std</span>
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <button onClick={() => { setEditingEntry(entry); setEditForm({ ...editForm, client_name: entry.client_name, hours: entry.hours.toString().replace('.', ','), start_time: entry.start_time || '', end_time: entry.end_time || '', note: entry.note || '' }) }} className="text-white/50 bg-white/5 border border-white/10 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors"><Edit2 size={14} /></button>
                                                    <button onClick={() => deleteEntry(entry.id)} className="text-red-400/50 bg-red-500/5 border border-red-500/10 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-red-500/20 hover:text-red-300 transition-colors"><Trash2 size={14} /></button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div className="bg-white/5 p-5 rounded-2xl border border-white/10 shadow-inner">
                            <h4 className="text-xs uppercase font-bold text-white/50 mb-4 tracking-wider flex items-center gap-2"><Plus size={14} className="text-teal-400" /> Neuer Eintrag</h4>
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="md:col-span-1 relative">
                                        <select value={newEntryForm.type} onChange={e => setNewEntryForm({ ...newEntryForm, type: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white appearance-none focus:outline-none focus:ring-2 focus:ring-teal-500/50 transition-all cursor-pointer text-sm font-medium">
                                            <option value="work" className="bg-gray-800 text-white">Projekt</option>
                                            <option value="company" className="bg-gray-800 text-white">Firma</option>
                                            <option value="office" className="bg-gray-800 text-white">Büro</option>
                                            <option value="warehouse" className="bg-gray-800 text-white">Lager</option>
                                            <option value="car" className="bg-gray-800 text-white">Auto</option>
                                            <option value="overtime_reduction" className="bg-gray-800 text-pink-300">Überstundenabbau</option>
                                        </select>
                                        <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none" />
                                    </div>
                                    <div className="md:col-span-2">
                                        <GlassInput type="text" placeholder={newEntryForm.type === 'work' ? "Projekt / Kunde" : "Beschreibung"} value={newEntryForm.client_name} onChange={e => setNewEntryForm({ ...newEntryForm, client_name: e.target.value })} className="w-full placeholder-white/30" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="relative group">
                                        <label className="absolute -top-2 left-3 bg-[#1e2536] px-1 text-[10px] text-white/40 uppercase font-bold z-10 rounded">Von</label>
                                        <GlassInput type="text" placeholder="HH:MM" value={newEntryForm.start_time} onChange={e => setNewEntryForm({ ...newEntryForm, start_time: e.target.value })} className="text-center font-mono" />
                                    </div>
                                    <div className="relative group">
                                        <label className="absolute -top-2 left-3 bg-[#1e2536] px-1 text-[10px] text-white/40 uppercase font-bold z-10 rounded">Bis</label>
                                        <GlassInput type="text" placeholder="HH:MM" value={newEntryForm.end_time} onChange={e => setNewEntryForm({ ...newEntryForm, end_time: e.target.value })} className="text-center font-mono" />
                                    </div>
                                    <div className="relative group">
                                        <label className="absolute -top-2 right-3 bg-[#1e2536] px-1 text-[10px] text-teal-400 uppercase font-bold z-10 rounded">Std</label>
                                        <GlassInput type="number" placeholder="0.00" value={newEntryForm.hours} onChange={e => setNewEntryForm({ ...newEntryForm, hours: e.target.value })} className="text-center font-mono font-bold text-teal-300" />
                                    </div>
                                </div>
                                <GlassButton onClick={handleAddEntry} className="w-full mt-2 shadow-lg shadow-teal-900/20">Eintrag hinzufügen</GlassButton>
                            </div>
                        </div>
                    </GlassCard>
                </div >
            )}

            {/* Date Pickers */}
            {showAnalysisStartPicker && <GlassDatePicker value={analysisStart} onChange={setAnalysisStart} onClose={() => setShowAnalysisStartPicker(false)} />}
            {showAnalysisEndPicker && <GlassDatePicker value={analysisEnd} onChange={setAnalysisEnd} onClose={() => setShowAnalysisEndPicker(false)} />}
        </div >
    );
};

export default OfficeUserPage;
