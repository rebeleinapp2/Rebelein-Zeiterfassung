

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { GlassCard, GlassButton, GlassInput } from '../components/GlassCard';
import {
    ArrowLeft, Calendar, User, Save, Clock, FileText, ChevronLeft, ChevronRight,
    Palmtree, Briefcase, Plus, TrendingDown, Trash2, X, Check,
    AlertTriangle, Layout, Coffee, Siren, Percent, MoreVertical,
    Lock, Unlock, Edit2, RotateCcw, Scale, Calculator, CalendarHeart, Stethoscope, UserCheck, Ban, Info, XCircle, History as HistoryIcon,
    Printer, StickyNote, CheckCircle, TrendingUp, ChevronDown, ChevronUp, CalendarCheck, ShieldAlert, List, Hash
} from 'lucide-react';
import { useTimeEntries, useDailyLogs, useOfficeService, useAbsences, useVacationRequests, getDailyTargetForDate, getLocalISOString, useSettings, useDepartments, useOvertimeBalance } from '../services/dataService';
import { TimeEntry, UserAbsence, VacationRequest } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import GlassDatePicker from '../components/GlassDatePicker';
import { formatDuration, calculateOverlapInMinutes } from '../services/utils/timeUtils';
// @ts-ignore
// import logoRebelein from '../logo/Logo Rebelein.jpeg';
const logoRebelein = '/logo/Logo Rebelein.jpeg';

const OfficeUserPage: React.FC = () => {
    // Debug: OfficeUserPage loaded
    const { userId } = useParams();
    const navigate = useNavigate();
    const { fetchAllUsers, users, updateOfficeUserSettings, checkAndApplyVacationCarryover, fetchYearlyQuota, updateYearlyQuota, fetchVacationAuditLog, fetchQuotaNotifications } = useOfficeService();

    const { entries, confirmEntry, updateEntry, deleteEntry, addEntry, rejectEntry, entryHistory, fetchEntryHistory } = useTimeEntries(userId);
    const { dailyLogs, fetchDailyLogs } = useDailyLogs(userId);
    const { absences, addAbsence, deleteAbsence, deleteAbsenceDay } = useAbsences(userId);
    const { requests, approveRequest, rejectRequest } = useVacationRequests(userId);
    const { entries: balanceEntries, addEntry: addBalanceEntry, refresh: refreshBalance } = useOvertimeBalance(userId || '');
    const [balanceForm, setBalanceForm] = useState({ hours: '', reason: '' });
    const [showBalanceList, setShowBalanceList] = useState(false);
    const { settings: viewerSettings } = useSettings();
    const { departments } = useDepartments();

    const [currentUser, setCurrentUser] = useState<any>(null);
    const [selectedMonth, setSelectedMonth] = useState(new Date());

    // History Modal State
    const [historyModal, setHistoryModal] = useState<{ isOpen: boolean; entryId: string | null }>({ isOpen: false, entryId: null });

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
    const [editForm, setEditForm] = useState({ date: '', client_name: '', hours: '', start_time: '', end_time: '', note: '', reason: '' });
    const [newEntryForm, setNewEntryForm] = useState({ client_name: '', hours: '', start_time: '', end_time: '', type: 'work', surcharge: 0 });

    // Rejection State
    const [rejectionModal, setRejectionModal] = useState<{ isOpen: boolean; entryId: string | null; reason: string }>({ isOpen: false, entryId: null, reason: '' });

    // Unpaid Reason State in Modal
    const [unpaidReason, setUnpaidReason] = useState('');

    // Vacation Edit State
    const [vacationDaysEdit, setVacationDaysEdit] = useState<number | null>(null);
    const [vacationCarryoverEdit, setVacationCarryoverEdit] = useState<number>(0);
    const [isQuotaLocked, setIsQuotaLocked] = useState<boolean>(true);
    const [showQuotaHistory, setShowQuotaHistory] = useState(false);
    const [quotaAuditLogs, setQuotaAuditLogs] = useState<any[]>([]);
    const [showPermissionError, setShowPermissionError] = useState(false);
    const [quotaNotifications, setQuotaNotifications] = useState<any[]>([]); // NEU: Pending Notifications

    // --- WORK MODEL EDIT STATE ---
    const [isEditingWorkModel, setIsEditingWorkModel] = useState(false);
    const [workModelTargets, setWorkModelTargets] = useState<any>({});
    const [workModelConfig, setWorkModelConfig] = useState<any>({});
    const [isWorkModelLocked, setIsWorkModelLocked] = useState(false);

    const [initialBalanceEdit, setInitialBalanceEdit] = useState<number>(0);
    const [workModelConfirmation, setWorkModelConfirmation] = useState(true);
    const [visibleToOthers, setVisibleToOthers] = useState(true);

    // Collapsible Tiles State
    const [collapsedTiles, setCollapsedTiles] = useState<Record<string, boolean>>(() => {
        try {
            const saved = localStorage.getItem('office_user_collapsed_tiles');
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            console.error("Failed to parse collapsed tiles", e);
            return {};
        }
    });

    const toggleTile = (tileId: string) => {
        setCollapsedTiles(prev => {
            const newState = { ...prev, [tileId]: !prev[tileId] };
            localStorage.setItem('office_user_collapsed_tiles', JSON.stringify(newState));
            return newState;
        });
    };

    useEffect(() => {
        if (users.length === 0) fetchAllUsers();
        else {
            const u = users.find(u => u.user_id === userId);
            setCurrentUser(u);
            if (u) {
                // Initialize defaults
                setVacationDaysEdit(u.vacation_days_yearly || 30);
                setVacationCarryoverEdit(u.vacation_days_carryover || 0);
                setIsWorkModelLocked(u.work_config_locked || false);

                // Initialize form with current settings as default
                setWorkModelTargets(u.target_hours || { 1: 8.5, 2: 8.5, 3: 8.5, 4: 8.5, 5: 4.5, 6: 0, 0: 0 });
                setWorkModelConfig(u.work_config || { 1: "07:00", 2: "07:00", 3: "07:00", 4: "07:00", 5: "07:00", 6: "07:00", 0: "07:00" });
                setWorkModelConfirmation(u.require_confirmation !== false);
                setVisibleToOthers(u.is_visible_to_others !== false);

                // Automatic Vacation Roll-Over Check (Legacy Support / Carryover Calc)
                if (u.user_id) {
                    checkAndApplyVacationCarryover(u.user_id, u);
                }
            }
        }
    }, [users, userId]);

    // --- PERMISSION CHECK (Department Logic) ---
    const canManage = useMemo(() => {
        if (!viewerSettings || !currentUser) return false;
        // Super Admin Bypass
        if (viewerSettings.role === 'super_admin') return true;
        if (viewerSettings.role === 'admin') return true;

        if (!currentUser.department_id) return false; // No department assigned, only admin can manage? Or maybe default to false.

        const dept = departments.find(d => d.id === currentUser.department_id);
        if (!dept) return false;

        if (dept.responsible_user_id === viewerSettings.user_id) return true;
        if (dept.substitute_user_id === viewerSettings.user_id && dept.is_substitute_active) return true;

        return false;
    }, [viewerSettings, currentUser, departments]);


    // Fetch Yearly Quota and Notifications when view year/user changes
    useEffect(() => {
        if (userId && vacationViewYear) {
            fetchYearlyQuota(userId, vacationViewYear).then((data: any) => {
                if (data) {
                    setVacationDaysEdit(data.total_days);
                    setVacationCarryoverEdit(data.manual_carryover || 0);
                    setIsQuotaLocked(data.is_locked !== false); // Default to locked if undefined
                } else {
                    // Fallback to global setting if no specific entry exists
                    setVacationDaysEdit(currentUser?.vacation_days_yearly || 30);
                    setVacationCarryoverEdit(0);
                    setIsQuotaLocked(false);
                }
            });

            // Fetch Pending Notifications
            fetchQuotaNotifications(userId).then(notifs => {
                if (notifs) setQuotaNotifications(notifs);
            });
        }
    }, [userId, vacationViewYear, currentUser, fetchYearlyQuota, fetchQuotaNotifications]);

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
            // Exclude deleted entries from analysis
            if (e.is_deleted || e.deleted_at) return false;
            return e.date >= analysisStart &&
                e.date <= analysisEnd &&
                activeFilters.includes(e.type || 'work');
        }).sort((a, b) => a.date.localeCompare(b.date));
    }, [entries, analysisStart, analysisEnd, activeFilters]);

    const pendingEntries = useMemo(() => {
        const types = ['company', 'office', 'warehouse', 'car', 'overtime_reduction'];
        return monthEntries.filter(e => types.includes(e.type || '') && !e.confirmed_at && !e.is_deleted && !e.deleted_at);
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
        // Also exclude DELETED entries from defining the range
        const relevantEntries = entries.filter(e => e.submitted && e.date <= todayStr && !e.is_deleted && !e.deleted_at);
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
                    !['break', 'vacation', 'sick', 'holiday', 'unpaid', 'overtime_reduction'].includes(e.type || '') &&
                    !e.is_deleted && !e.deleted_at;
            })
            .reduce((sum, e) => sum + e.hours, 0);

        // FUTURE OVERTIME REDUCTION
        // Check for any CONFIRMED overtime_reduction entries AFTER the cutoff date
        const futureReductions = entries
            .filter(e => {
                return e.type === 'overtime_reduction' &&
                    e.confirmed_at && // Must be confirmed by office
                    !e.is_deleted && !e.deleted_at &&
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
                const start = new Date(`2000-01-01T${log.start_time} `);
                const end = new Date(`2000-01-01T${log.end_time} `);
                let duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                if (duration < 0) duration += 24; // Handle over midnight if needed (though unlikely for daily log structure)

                // Subtract breaks for this day (exclude deleted breaks)
                const dayBreaks = entries.filter(e => e.date === log.date && e.type === 'break' && !e.is_deleted && !e.deleted_at)
                    .reduce((sum, b) => sum + b.hours, 0);

                total += Math.max(0, duration - dayBreaks);
            }
        });

        return total;
    }, [dailyLogs, entries, year, month]);

    // --- MONTHLY BALANCE STATISTICS (Requested Feature) ---
    const monthlyStats = useMemo(() => {
        if (!currentUser) return { target: 0, actual: 0, diff: 0 };

        const startOfMonth = new Date(year, month, 1);
        const endOfMonth = new Date(year, month + 1, 0);

        let totalTarget = 0;
        let totalCredits = 0;
        let projectHours = 0;

        // Iterate days
        let curr = new Date(startOfMonth);
        while (curr <= endOfMonth) {
            const dateStr = getLocalISOString(curr);
            const dailyTarget = getDailyTargetForDate(dateStr, currentUser.target_hours || {});

            // Check Absences
            const absence = absences?.find(a => dateStr >= a.start_date && dateStr <= a.end_date);
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

        // Sum Project Hours for this month
        projectHours = entries
            .filter(e => {
                const [y, m] = e.date.split('-').map(Number);
                return y === year && m === month + 1 &&
                    !['break', 'vacation', 'sick', 'holiday', 'unpaid', 'overtime_reduction'].includes(e.type || '') &&
                    !e.is_deleted && !e.deleted_at;
            })
            .reduce((sum, e) => sum + e.hours, 0);

        const actualTotal = projectHours + totalCredits;

        return {
            target: totalTarget,
            actual: actualTotal,
            diff: actualTotal - totalTarget
        };
    }, [currentUser, year, month, entries, absences]);

    const effectiveVacationClaim = useMemo(() => {
        const base = vacationDaysEdit || 30;
        const carryover = vacationCarryoverEdit || 0;
        if (unpaidDaysInYear === 0) return base + carryover;
        const reduction = (unpaidDaysInYear / 260) * base; // Reduction applies to base only typically
        return Math.max(0, (base - reduction) + carryover);
    }, [vacationDaysEdit, vacationCarryoverEdit, unpaidDaysInYear]);

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
            work_config: workModelConfig,
            require_confirmation: workModelConfirmation,
            is_visible_to_others: visibleToOthers
        });

        if (currentUser) {
            setCurrentUser({
                ...currentUser,
                target_hours: workModelTargets,
                work_config: workModelConfig,
                require_confirmation: workModelConfirmation,
                is_visible_to_others: visibleToOthers
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
        setEditForm({ date: dateStr, client_name: '', hours: '', start_time: '', end_time: '', note: '', reason: '' });
        setNewEntryForm({ client_name: '', hours: '', start_time: '', end_time: '', type: 'work', surcharge: 0 });
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
            surcharge: (newEntryForm as any).surcharge || 0,
            submitted: true
        });

        setNewEntryForm({ client_name: '', hours: '', start_time: '', end_time: '', type: 'work', surcharge: 0 });
    };

    const handleSaveEntryEdit = async () => {
        if (!editingEntry) return;

        if (!editForm.reason || editForm.reason.trim() === '') {
            alert("Bitte geben Sie einen Änderungsgrund an.");
            return;
        }

        await updateEntry(editingEntry.id, {
            hours: parseFloat(editForm.hours.replace(',', '.')),
            start_time: editForm.start_time || undefined,
            end_time: editForm.end_time || undefined,
            note: editForm.note || undefined,
            client_name: editForm.client_name
        }, editForm.reason);
        setEditingEntry(null);
    };



    // --- PDF GENERATION FOR VACATION REQUEST ---
    const generateVacationRequestPDF = async (request: any) => {
        const doc = new jsPDF();

        // Helper to load image
        const loadImage = (src: string): Promise<HTMLImageElement> => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = "Anonymous";
                img.src = src;
                img.onload = () => resolve(img);
                img.onerror = reject;
            });
        };

        try {
            if (logoRebelein) {
                await loadImage(logoRebelein).then(img => {
                    doc.addImage(img, 'JPEG', 150, 10, 40, 25); // Top Right
                }).catch(err => console.error("Logo load error", err));
            }
        } catch (e) { console.log("No logo"); }

        // --- CALCULATIONS ---
        // Filter requests for the same year as the current request
        const reqDate = new Date(request.start_date);
        const reqYear = reqDate.getFullYear();

        // --- CALCULATIONS ---
        const settings = viewerSettings || { vacation_days_yearly: 30, vacation_days_carryover: 0 };

        let yearlyQuota = settings.vacation_days_yearly || 30;
        // Fetch specific year quota (async)
        const { data: qData } = await supabase.from('yearly_vacation_quotas').select('total_days').eq('user_id', request.user_id).eq('year', reqYear).maybeSingle();
        if (qData) yearlyQuota = qData.total_days;

        const carryOver = settings.vacation_days_carryover || 0;
        const totalAvailable = yearlyQuota + carryOver;

        // Get all requests for this year (excluding rejected)
        const yearRequests = requests.filter(r => {
            const rDate = new Date(r.start_date);
            return rDate.getFullYear() === reqYear && r.status !== 'rejected';
        }).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        // Find current request index
        const reqIndex = yearRequests.findIndex(r => r.id === request.id);
        const requestNumber = reqIndex + 1;

        // Calculate used days UP TO & INCLUDING this request
        let usedDaysBefore = 0;
        let currentRequestDays = 0;

        yearRequests.forEach((r, idx) => {
            if (idx <= reqIndex) {
                const start = new Date(r.start_date);
                const end = new Date(r.end_date);

                // Working Days Calculation (Mon-Fri)
                let days = 0;
                let d = new Date(start);
                while (d <= end) {
                    const day = d.getDay();
                    if (day !== 0 && day !== 6) days++; // Exclude Sat(6) and Sun(0)
                    d.setDate(d.getDate() + 1);
                }

                if (idx === reqIndex) currentRequestDays = days;
                usedDaysBefore += days;
            }
        });

        const remaining = totalAvailable - usedDaysBefore;

        // --- PDF LAYOUT ---

        // Fonts & Colors
        const headerColor = [20, 184, 166] as [number, number, number];

        // 1. Header
        doc.setFont("helvetica", "bold");
        doc.setFontSize(24);
        doc.setTextColor(...headerColor);
        doc.text("URLAUBSANTRAG", 20, 25);

        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(`Nr.${requestNumber} / ${reqYear}`, 20, 32);

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.text("Rebelein GmbH", 20, 45);
        doc.setFont("helvetica", "normal");
        doc.text("Heizung - Sanitär - Spenglerei", 20, 50);

        // Separator
        doc.setDrawColor(200, 200, 200);
        doc.line(20, 55, 190, 55);

        // 2. Info Block
        doc.setFontSize(11);
        doc.text(`Antragsteller:`, 20, 70);
        doc.setFont("helvetica", "bold");
        doc.text(`${currentUser?.display_name || 'Unbekannt'}`, 50, 70);

        doc.setFont("helvetica", "normal");
        doc.text(`Erstellt am:`, 140, 70);
        doc.text(`${new Date().toLocaleDateString('de-DE')}`, 165, 70);

        // 3. Request Details
        autoTable(doc, {
            startY: 85,
            head: [['Zeitraum (Von - Bis)', 'Tage (Werktage)', 'Bemerkung']],
            body: [
                [
                    `${new Date(request.start_date).toLocaleDateString('de-DE')}  -  ${new Date(request.end_date).toLocaleDateString('de-DE')}`,
                    `${currentRequestDays}`,
                    request.note || ''
                ]
            ],
            theme: 'grid',
            headStyles: { fillColor: headerColor, textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 11, cellPadding: 4 },
        });

        // 4. Vacation Account Box
        // @ts-ignore
        let yPos = doc.lastAutoTable.finalY + 15;

        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text("Urlaubskonto (Stand nach diesem Antrag):", 20, yPos);
        yPos += 5;

        autoTable(doc, {
            startY: yPos,
            head: [['Jahresurlaub', 'Übertrag VJ', 'Gesamtanspruch', `Verbraucht (inkl. Nr. ${requestNumber})`, 'Resturlaub']],
            body: [
                [
                    `${yearlyQuota}`,
                    `${carryOver}`,
                    `${totalAvailable}`,
                    `${usedDaysBefore}`,
                    `${remaining}`
                ]
            ],
            theme: 'plain',
            headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold', halign: 'center' },
            bodyStyles: { halign: 'center', fontSize: 10 },
            columnStyles: {
                4: { fontStyle: 'bold', textColor: remaining < 0 ? [200, 0, 0] : [0, 0, 0] }
            },
            tableLineColor: [200, 200, 200],
            tableLineWidth: 0.1,
        });

        // 5. Signatures
        // @ts-ignore
        const finalY = doc.lastAutoTable.finalY + 30;

        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text("Hinweis: Dieser Antrag gilt vorbehaltlich der Genehmigung durch die Geschäftsleitung.", 20, finalY - 15);

        const boxY = finalY;
        const boxHeight = 25;
        const boxWidth = 70;

        doc.setDrawColor(0, 0, 0);
        doc.setTextColor(0, 0, 0);

        // Employee
        doc.line(20, boxY + boxHeight, 20 + boxWidth, boxY + boxHeight);
        doc.setFontSize(9);
        doc.text("Datum, Unterschrift Mitarbeiter", 20, boxY + boxHeight + 5);

        // Boss
        doc.line(110, boxY + boxHeight, 110 + boxWidth, boxY + boxHeight);
        doc.text("Genehmigt: Geschäftsleitung", 110, boxY + boxHeight + 5);

        // Footer
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text("Rebelein GmbH • Zeume Str. 1 • 91154 Roth", 105, 280, { align: 'center' });
        doc.text(`Antrag ID: ${request.id.substring(0, 8)}`, 105, 285, { align: 'center' });

        doc.save(`Urlaubsantrag_${currentUser?.display_name || 'MA'}_${request.start_date}.pdf`);

        // --- UPDATE REQUEST WITH PRINT LOG ---
        const viewerName = viewerSettings?.display_name || 'Unbekannt';
        const printLog = `[Gedruckt von ${viewerName} am ${new Date().toLocaleDateString('de-DE')} ${new Date().toLocaleTimeString('de-DE')}]`;
        const newNote = request.note ? `${request.note}\n${printLog}` : printLog;

        const { error } = await supabase
            .from('vacation_requests')
            .update({ note: newNote })
            .eq('id', request.id);

        if (!error) {
            window.location.reload();
        }
    };

    const handleDeleteEntryWithReason = async (entryId: string) => {
        const reason = window.prompt("Bitte geben Sie einen Grund für die Löschung an:");
        if (!reason) return;

        // Super-Admin Bypass: Delete directly
        if (viewerSettings?.role === 'super_admin') {
            await deleteEntry(entryId, reason);
            return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { error } = await supabase
            .from('time_entries')
            .update({
                deletion_requested_at: new Date().toISOString(),
                deletion_requested_by: user.id,
                deletion_request_reason: reason
            })
            .eq('id', entryId);

        if (error) {
            console.error("Error requesting deletion:", error);
            alert("Fehler beim Anfordern der Löschung.");
        } else {
            // Optimistic update
            // await fetchUserEntries(userId, selectedMonth); // Not exposed, relies on subscription

            // Add history record for the request
            // Add history record for the request
            // RPC function 'log_entry_change' is missing in DB, disabled for now.
            /* 
            await supabase.rpc('log_entry_change', {
                p_entry_id: entryId,
                p_changed_by: user.id,
                p_change_type: 'DELETION_REQUEST',
                p_old_values: {}, // Not needed for request
                p_new_values: { reason: reason },
                p_change_reason: reason
            });
            */
        }
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
        // Breaks (exclude deleted)
        const breaks = modalEntries.filter(e => e.type === 'break' && !e.is_deleted && !e.deleted_at).reduce((s, b) => s + b.hours, 0);
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
                <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                    {currentUser?.display_name || 'Benutzer'}
                    {currentUser?.is_active === false && (
                        <span className="flex items-center gap-1 text-xs border border-red-500/50 bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full uppercase tracking-wider">
                            <Ban size={12} /> Deaktiviert
                        </span>
                    )}
                </h1>
            </div>

            {/* PERMISSION WARNING */}
            {!canManage && (
                <div className="mb-6 animate-in slide-in-from-top-2">
                    <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 flex items-center gap-3">
                        <ShieldAlert size={20} className="text-orange-400" />
                        <div>
                            <div className="text-sm font-bold text-orange-200">Nur Lesezugriff</div>
                            <div className="text-xs text-orange-300/70">
                                Sie haben keine Berechtigung, Einträge für diesen Benutzer zu verwalten, da Sie weder Admin noch der zuständige Abteilungsleiter (oder Vertretung) sind.
                            </div>
                        </div>
                    </div>
                </div>
            )}

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
                                        {canManage && (
                                            <>
                                                <button onClick={() => rejectRequest(req.id)} className="flex items-center gap-2 px-3 py-2 bg-red-500/20 text-red-300 border border-red-500/30 rounded-lg hover:bg-red-500/30 font-bold text-sm transition-colors">
                                                    <XCircle size={16} /> Ablehnen
                                                </button>
                                                <button onClick={() => generateVacationRequestPDF(req)} className="flex items-center gap-2 px-3 py-2 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded-lg hover:bg-blue-500/30 font-bold text-sm transition-colors" title="PDF drucken">
                                                    <Printer size={16} />
                                                </button>
                                                <button onClick={() => approveRequest(req)} className="flex items-center gap-2 px-3 py-2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 font-bold text-sm transition-colors">
                                                    <CalendarCheck size={16} /> Genehmigen & Eintragen
                                                </button>
                                            </>
                                        )}
                                        {!canManage && (
                                            <span className="text-white/30 text-xs italic flex items-center">Keine Berechtigung</span>
                                        )}
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
                        <div className="space-y-2">
                            {pendingEntries.map(entry => (
                                <div key={entry.id} className="bg-white/5 p-3 rounded-xl border border-white/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 group hover:bg-white/10 transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2 text-white mb-1">
                                            <span className="font-bold text-lg font-mono">
                                                {new Date(entry.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                                            </span>
                                            <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold tracking-wider ${entry.type === 'office' ? 'bg-blue-500/20 text-blue-300' :
                                                entry.type === 'company' ? 'bg-purple-500/20 text-purple-300' :
                                                    entry.type === 'warehouse' ? 'bg-amber-500/20 text-amber-300' :
                                                        'bg-gray-500/20 text-gray-300'
                                                }`}>
                                                {entry.type === 'company' ? 'Firma' : entry.type === 'office' ? 'Büro' : entry.type === 'warehouse' ? 'Lager' : entry.type}
                                            </span>
                                            <span className="font-bold text-emerald-400 font-mono text-lg ml-2">
                                                {entry.hours} h
                                            </span>
                                            {entry.start_time && entry.end_time && (
                                                <span className="text-xs text-white/50 font-mono bg-black/20 px-1.5 py-0.5 rounded">
                                                    {entry.start_time} - {entry.end_time}
                                                </span>
                                            )}
                                        </div>
                                        {entry.note && (
                                            <div className="text-white/70 text-sm italic flex items-start gap-1.5">
                                                <StickyNote size={14} className="mt-0.5 shrink-0 opacity-50" />
                                                <span>{entry.note}</span>
                                            </div>
                                        )}
                                    </div>

                                    {canManage && (
                                        <div className="flex gap-2 self-end md:self-center">
                                            {/* Optional: Add Edit/Reject buttons here if needed later */}
                                            <button
                                                onClick={() => confirmEntry(entry.id)}
                                                className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-400 font-bold text-sm shadow-lg shadow-emerald-900/20 transition-all hover:scale-105"
                                                title="Eintrag bestätigen"
                                            >
                                                <CheckCircle size={16} /> Bestätigen
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </GlassCard>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                {/* OVERTIME ACCOUNT / LIFETIME BALANCE */}
                <GlassCard className={`relative overflow-hidden group bg-emerald-900/10 border-emerald-500/20 flex flex-col justify-between transition-all duration-300 ${collapsedTiles['overtime'] ? 'self-start' : ''}`}>
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Scale size={100} className="text-emerald-300" />
                    </div>
                    <div className="flex justify-between items-start z-10">
                        <div className="flex items-center gap-2 text-emerald-400 font-bold uppercase text-xs tracking-wider mb-3">
                            <Clock size={16} /> Überstundenkonto
                        </div>
                        <button onClick={() => toggleTile('overtime')} className="p-1 hover:bg-white/10 rounded text-emerald-300 transition-colors">
                            {collapsedTiles['overtime'] ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </button>
                    </div>

                    {!collapsedTiles['overtime'] ? (
                        <>
                            <div>
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
                        </>
                    ) : (
                        <div className="flex items-baseline gap-2 pb-1 relative z-10">
                            <span className={`text-xl font-bold font-mono ${totalBalanceStats.diff >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                                {totalBalanceStats.diff > 0 ? '+' : ''}{totalBalanceStats.diff.toFixed(2)}
                            </span>
                            <span className="text-xs text-white/40 font-bold">Std</span>
                        </div>
                    )}
                </GlassCard>

                {/* INITIAL BALANCE / TRANSFER (MULTI-ENTRY) */}
                <GlassCard className={`bg-cyan-900/10 border-cyan-500/20 relative flex flex-col justify-between overflow-hidden transition-all duration-300 ${collapsedTiles['balance'] ? 'self-start' : ''}`}>
                    <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2 text-cyan-300 font-bold uppercase text-xs tracking-wider">
                            <Calculator size={16} /> Startsaldo / Übertrag
                        </div>
                        <div className="flex gap-1">
                            {!collapsedTiles['balance'] && (
                                <button
                                    onClick={() => setShowBalanceList(!showBalanceList)}
                                    className="p-1 hover:bg-white/10 rounded text-cyan-200 transition-colors"
                                    title={showBalanceList ? "Liste verbergen" : "Liste anzeigen"}
                                >
                                    <List size={16} />
                                </button>
                            )}
                            <button onClick={() => toggleTile('balance')} className="p-1 hover:bg-white/10 rounded text-cyan-200 transition-colors">
                                {collapsedTiles['balance'] ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                            </button>
                        </div>
                    </div>

                    {!collapsedTiles['balance'] ? (
                        <>
                            <div className="mb-2">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-3xl font-bold font-mono text-white">
                                        {balanceEntries.reduce((sum, e) => sum + e.hours, 0).toFixed(2)}
                                    </span>
                                    <span className="text-sm text-white/40 font-bold">h</span>
                                </div>
                                <p className="text-[10px] text-white/40">
                                    Summe aller manuellen Überträge.
                                </p>
                            </div>

                            {showBalanceList && (
                                <div className="mt-2 pt-2 border-t border-white/10 animate-in slide-in-from-top-2">
                                    <div className="max-h-40 overflow-y-auto space-y-2 pr-1 mb-2 custom-scrollbar">
                                        {balanceEntries.length === 0 ? (
                                            <p className="text-xs text-white/30 italic text-center py-2">Keine Einträge vorhanden.</p>
                                        ) : (
                                            balanceEntries.map(entry => (
                                                <div key={entry.id} className="bg-black/20 p-2 rounded border border-white/5 text-xs">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <span className={`font-mono font-bold ${entry.hours >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                                                            {entry.hours > 0 ? '+' : ''}{entry.hours.toFixed(2)} h
                                                        </span>
                                                        <span className="text-[10px] text-white/30">
                                                            {entry.created_at ? new Date(entry.created_at).toLocaleDateString('de-DE') : '-'}
                                                        </span>
                                                    </div>
                                                    <div className="text-white/70 italic break-words">{entry.reason}</div>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    {/* ADD FORM - ADMIN ONLY */}
                                    {canManage && (currentUser?.role === 'admin' || viewerSettings?.role === 'admin') ? (
                                        <div className="bg-white/5 p-2 rounded border border-white/10 mt-2">
                                            <div className="text-[10px] uppercase font-bold text-cyan-400 mb-2">Neuer Eintrag</div>
                                            <div className="flex gap-2 mb-2">
                                                <GlassInput
                                                    type="number"
                                                    placeholder="Std"
                                                    value={balanceForm.hours}
                                                    onChange={e => setBalanceForm({ ...balanceForm, hours: e.target.value })}
                                                    className="w-20 !py-1 !px-2 !text-xs text-center font-mono"
                                                />
                                                <GlassInput
                                                    type="text"
                                                    placeholder="Grund (Pflicht)"
                                                    value={balanceForm.reason}
                                                    onChange={e => setBalanceForm({ ...balanceForm, reason: e.target.value })}
                                                    className="flex-1 !py-1 !px-2 !text-xs"
                                                />
                                            </div>
                                            <button
                                                disabled={!balanceForm.hours || !balanceForm.reason}
                                                onClick={async () => {
                                                    const h = parseFloat(balanceForm.hours);
                                                    if (isNaN(h)) return;
                                                    await addBalanceEntry(h, balanceForm.reason);
                                                    setBalanceForm({ hours: '', reason: '' });
                                                }}
                                                className="w-full py-1 bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-200 text-xs font-bold rounded border border-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                            >
                                                Hinzufügen
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="text-[10px] text-white/30 italic text-center mt-2">
                                            Nur Administratoren können Einträge erstellen.
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex items-baseline gap-2 pb-1">
                            <span className="text-xl font-bold font-mono text-white">
                                {balanceEntries.reduce((sum, e) => sum + e.hours, 0).toFixed(2)}
                            </span>
                            <span className="text-xs text-white/40 font-bold">h</span>
                        </div>
                    )}
                </GlassCard>

                {/* WORK MODEL CONFIG (SIMPLE) */}
                <GlassCard className={`bg-blue-900/10 border-blue-500/20 relative flex flex-col transition-all duration-300 ${collapsedTiles['work_model'] ? 'self-start' : 'h-full'}`}>
                    <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2 text-blue-300 font-bold uppercase text-xs tracking-wider">
                            <Briefcase size={16} /> Arbeitszeit-Modell
                        </div>
                        <div className="flex gap-1 z-10">
                            {!collapsedTiles['work_model'] && (
                                <>
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
                                </>
                            )}
                            <button onClick={() => toggleTile('work_model')} className="p-1 hover:bg-white/10 rounded text-blue-300 transition-colors">
                                {collapsedTiles['work_model'] ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                            </button>
                        </div>
                    </div>

                    {!collapsedTiles['work_model'] ? (
                        <>
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

                            {/* Confirmation Toggle */}
                            <div className={`mt-3 pt-3 border-t border-white/10 flex items-center justify-between ${isEditingWorkModel ? 'opacity-100' : 'opacity-60'}`}>
                                <div className="flex flex-col">
                                    <span className="text-xs font-bold text-white">Bestätigungspflicht</span>
                                    <span className="text-[10px] text-white/40">Muss Zeiten bestätigen lassen</span>
                                </div>
                                {isEditingWorkModel ? (
                                    <button
                                        onClick={() => setWorkModelConfirmation(!workModelConfirmation)}
                                        className={`w-10 h-6 rounded-full p-1 transition-all ${workModelConfirmation ? 'bg-blue-500 justify-end' : 'bg-white/10 justify-start'} flex items-center`}
                                    >
                                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm`} />
                                    </button>
                                ) : (
                                    <div className={`text-xs font-bold px-2 py-1 rounded ${workModelConfirmation ? 'bg-blue-500/20 text-blue-200' : 'bg-white/10 text-white/50'}`}>
                                        {workModelConfirmation ? 'Aktiv' : 'Inaktiv'}
                                    </div>
                                )}
                            </div>

                            {/* Visibility Toggle */}
                            <div className={`mt-3 pt-3 border-t border-white/10 flex items-center justify-between ${isEditingWorkModel ? 'opacity-100' : 'opacity-60'}`}>
                                <div className="flex flex-col">
                                    <span className="text-xs font-bold text-white">Sichtbarkeit</span>
                                    <span className="text-[10px] text-white/40">Für Azubi/Monteur sichtbar</span>
                                </div>
                                {isEditingWorkModel ? (
                                    <button
                                        onClick={() => setVisibleToOthers(!visibleToOthers)}
                                        className={`w-10 h-6 rounded-full p-1 transition-all ${visibleToOthers ? 'bg-emerald-500 justify-end' : 'bg-white/10 justify-start'} flex items-center`}
                                    >
                                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm`} />
                                    </button>
                                ) : (
                                    <div className={`text-xs font-bold px-2 py-1 rounded ${visibleToOthers ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-white/50'}`}>
                                        {visibleToOthers ? 'Sichtbar' : 'Versteckt'}
                                    </div>
                                )}
                            </div>

                            {isEditingWorkModel && (
                                <div className="mt-2 text-[10px] text-orange-300 italic flex items-center gap-1">
                                    <Unlock size={10} /> Bearbeitungsmodus aktiv
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex items-center gap-2 pb-1 text-white/50 text-xs">
                            <span className="font-bold text-white">
                                {dayIndices.reduce((sum, d) => sum + (Number(workModelTargets[d]) || 0), 0).toLocaleString('de-DE', { maximumFractionDigits: 2 })}h
                            </span> / Woche
                        </div>
                    )}
                </GlassCard>

                {/* Vacation Mgmt */}
                <GlassCard className={`bg-purple-900/10 border-purple-500/20 relative flex flex-col transition-all duration-300 ${collapsedTiles['vacation'] ? 'self-start' : 'h-full'}`}>
                    <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2 text-purple-300 font-bold uppercase text-xs tracking-wider">
                            <Palmtree size={16} /> Urlaubsverwaltung
                        </div>
                        <div className="flex gap-1 z-10">
                            {!collapsedTiles['vacation'] && (
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center bg-white/5 rounded-lg px-2 py-1 gap-2">
                                        <button onClick={() => setVacationViewYear(y => y - 1)} className="text-purple-200 hover:text-white"><ChevronLeft size={14} /></button>
                                        <span className="text-sm font-bold text-white">{vacationViewYear}</span>
                                        <button onClick={() => setVacationViewYear(y => y + 1)} className="text-purple-200 hover:text-white"><ChevronRight size={14} /></button>
                                    </div>
                                </div>
                            )}
                            <button onClick={() => toggleTile('vacation')} className="p-1 hover:bg-white/10 rounded text-purple-300 transition-colors">
                                {collapsedTiles['vacation'] ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                            </button>
                        </div>
                    </div>

                    {!collapsedTiles['vacation'] ? (
                        <>
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
                            <div className="pt-2 border-t border-white/5 flex flex-col gap-2 mb-4">
                                {/* BASIS + CARRYOVER INPUTS */}
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col">
                                        <label className="text-[10px] text-white/50 uppercase font-bold">Basis-Anspruch</label>
                                        <input
                                            type="number"
                                            disabled={isQuotaLocked}
                                            value={vacationDaysEdit ?? ''}
                                            onChange={e => {
                                                const val = parseFloat(e.target.value);
                                                setVacationDaysEdit(isNaN(val) ? 0 : val);
                                            }}
                                            className={`w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-right text-sm text-white focus:outline-none ${isQuotaLocked ? 'opacity-50 cursor-not-allowed' : 'focus:border-purple-500/50'}`}
                                        />
                                    </div>
                                    <div className="text-white/30 font-bold">+</div>
                                    <div className="flex flex-col">
                                        <label className="text-[10px] text-white/50 uppercase font-bold">Rest (VJ)</label>
                                        <input
                                            type="number"
                                            disabled={isQuotaLocked}
                                            value={vacationCarryoverEdit ?? ''}
                                            onChange={e => {
                                                const val = parseFloat(e.target.value);
                                                setVacationCarryoverEdit(isNaN(val) ? 0 : val);
                                            }}
                                            className={`w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-right text-sm text-white focus:outline-none ${isQuotaLocked ? 'opacity-50 cursor-not-allowed' : 'focus:border-purple-500/50'}`}
                                        />
                                    </div>
                                    <div className="text-white/30 font-bold">=</div>
                                    <div className="flex flex-col items-end">
                                        <label className="text-[10px] text-white/50 uppercase font-bold">Gesamt</label>
                                        <span className="text-lg font-bold text-purple-200 font-mono">
                                            {((vacationDaysEdit || 0) + (vacationCarryoverEdit || 0)).toFixed(1)}
                                        </span>
                                    </div>
                                </div>

                                {/* ACTIONS: SAVE, LOCK, HISTORY */}
                                <div className="flex items-center justify-between mt-2">
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                if (userId) {
                                                    // Fetch Quota ID first, then logs
                                                    supabase.from('yearly_vacation_quotas')
                                                        .select('id')
                                                        .eq('user_id', userId)
                                                        .eq('year', vacationViewYear)
                                                        .single()
                                                        .then(({ data }) => {
                                                            if (data) {
                                                                fetchVacationAuditLog(data.id).then(setQuotaAuditLogs);
                                                                setShowQuotaHistory(true);
                                                            } else {
                                                                alert("Keine Historie vorhanden.");
                                                            }
                                                        });
                                                }
                                            }}
                                            className="p-1.5 bg-white/5 hover:bg-white/10 rounded text-white/50 hover:text-white transition-colors"
                                            title="Historie anzeigen"
                                        >
                                            <HistoryIcon size={14} />
                                        </button>
                                        <button
                                            onClick={() => setIsQuotaLocked(!isQuotaLocked)}
                                            className={`p-1.5 rounded transition-colors ${isQuotaLocked ? 'bg-white/5 text-white/50 hover:text-white' : 'bg-orange-500/20 text-orange-200 hover:bg-orange-500/30'}`}
                                            title={isQuotaLocked ? "Entsperren zum Bearbeiten" : "Bearbeitung sperren"}
                                        >
                                            {isQuotaLocked ? <Lock size={14} /> : <Unlock size={14} />}
                                        </button>
                                    </div>

                                    {!isQuotaLocked && (
                                        <button
                                            onClick={() => {
                                                // Permission Check: Only Admin/Office allowed
                                                const role = viewerSettings?.role;
                                                if (role !== 'super_admin' && role !== 'admin' && role !== 'office' && (role as string) !== 'chef') {
                                                    setShowPermissionError(true);
                                                    return;
                                                }

                                                if (userId && vacationDaysEdit !== null) {
                                                    updateYearlyQuota(userId, vacationViewYear, {
                                                        total_days: vacationDaysEdit,
                                                        manual_carryover: vacationCarryoverEdit,
                                                        is_locked: true // Auto-lock on save
                                                    });
                                                    // Optimistic Update: Set "Locked" immediately
                                                    setIsQuotaLocked(true);
                                                    // Refresh notifications to show "Pending" state immediately
                                                    setTimeout(async () => {
                                                        const notifs = await fetchQuotaNotifications(userId);
                                                        if (notifs) setQuotaNotifications(notifs);
                                                    }, 500);
                                                }
                                            }}
                                            className="px-3 py-1 bg-purple-500 hover:bg-purple-600 rounded text-white text-xs font-bold transition-colors flex items-center gap-2 shadow-lg shadow-purple-900/20"
                                        >
                                            <Save size={14} /> {quotaNotifications.some(n => n.status === 'pending') ? 'Vorschlag aktualisieren' : 'Speichern'}
                                        </button>
                                    )}
                                </div>

                                {/* PENDING / REJECTED WARNING */}
                                {quotaNotifications.length > 0 && (
                                    <div className="mt-3 space-y-2">
                                        {quotaNotifications.filter(n => n.status === 'pending').map(n => (
                                            <div key={n.id} className="bg-yellow-500/10 border border-yellow-500/30 p-2 rounded text-xs text-yellow-200 flex items-center gap-2 animate-pulse">
                                                <Clock size={12} />
                                                <span>Änderung auf <strong>{n.new_value.total} Tage</strong> wartet auf Bestätigung durch den Mitarbeiter.</span>
                                            </div>
                                        ))}
                                        {quotaNotifications.filter(n => n.status === 'rejected').map(n => (
                                            <div key={n.id} className="bg-red-500/10 border border-red-500/30 p-2 rounded text-xs text-red-200">
                                                <div className="flex items-center gap-2 font-bold mb-1">
                                                    <XCircle size={12} />
                                                    <span>Änderung abgelehnt!</span>
                                                </div>
                                                <div className="opacity-80">Grund: "{n.rejection_reason}"</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
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
                        </>
                    ) : (
                        <div className="flex items-baseline gap-2 pb-1">
                            <span className="text-xl font-bold font-mono text-purple-100">{takenVacationDays}</span>
                            <span className="text-purple-300/50 text-xs font-bold"> / {effectiveVacationClaim.toFixed(1)} Tage</span>
                        </div>
                    )}
                </GlassCard>

                {/* Monthly Attendance Tile */}
                <GlassCard className={`bg-cyan-900/10 border-cyan-500/20 relative flex flex-col justify-between transition-all duration-300 ${collapsedTiles['attendance'] ? 'self-start' : ''}`}>
                    {!collapsedTiles['attendance'] && (
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <UserCheck size={100} className="text-cyan-300" />
                        </div>
                    )}
                    <div className="flex justify-between items-start z-10">
                        <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase text-xs tracking-wider mb-3">
                            <Clock size={16} /> Anwesenheit (Monat)
                        </div>
                        <button onClick={() => toggleTile('attendance')} className="p-1 hover:bg-white/10 rounded text-cyan-300 transition-colors">
                            {collapsedTiles['attendance'] ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </button>
                    </div>

                    {!collapsedTiles['attendance'] ? (
                        <>
                            <div>
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
                        </>
                    ) : (
                        <div className="flex items-baseline gap-2 pb-1 relative z-10">
                            <span className="text-xl font-bold font-mono text-cyan-300">
                                {formatDuration(monthlyAttendance)}
                            </span>
                            <span className="text-xs text-white/40 font-bold">h</span>
                        </div>
                    )}
                </GlassCard>

                {/* NEW: MONTHLY BALANCE TILE */}
                <GlassCard className={`bg-teal-900/10 border-teal-500/20 relative flex flex-col justify-between transition-all duration-300 ${collapsedTiles['monthly_balance'] ? 'self-start' : ''}`}>
                    {!collapsedTiles['monthly_balance'] && (
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Scale size={100} className="text-teal-300" />
                        </div>
                    )}
                    <div className="flex justify-between items-start z-10">
                        <div className="flex items-center gap-2 text-teal-400 font-bold uppercase text-xs tracking-wider mb-3">
                            <Scale size={16} /> Monatsbilanz
                        </div>
                        <button onClick={() => toggleTile('monthly_balance')} className="p-1 hover:bg-white/10 rounded text-teal-300 transition-colors">
                            {collapsedTiles['monthly_balance'] ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </button>
                    </div>

                    {!collapsedTiles['monthly_balance'] ? (
                        <>
                            <div>
                                <div className="flex items-baseline gap-2 mb-1">
                                    <span className={`text-4xl font-bold font-mono ${monthlyStats.diff >= 0 ? 'text-teal-300' : 'text-red-300'}`}>
                                        {monthlyStats.diff > 0 ? '+' : ''}{monthlyStats.diff.toFixed(2)}
                                    </span>
                                    <span className="text-sm text-white/40 font-bold">Std</span>
                                </div>
                                <div className={`text-xs font-bold flex items-center gap-1 ${monthlyStats.diff >= 0 ? 'text-teal-400/70' : 'text-red-400/70'}`}>
                                    {monthlyStats.diff >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                    Differenz (Soll/Ist)
                                </div>
                            </div>
                            <div className="mt-4 pt-3 border-t border-white/5 space-y-1">
                                <div className="flex justify-between text-xs">
                                    <span className="text-white/50">Soll (Monat):</span>
                                    <span className="text-white font-mono">{monthlyStats.target.toFixed(2)} h</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-white/50">Ist (inkl. Urlaub/Krank):</span>
                                    <span className="text-white font-mono">{monthlyStats.actual.toFixed(2)} h</span>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex items-baseline gap-2 pb-1 relative z-10">
                            <span className={`text-xl font-bold font-mono ${monthlyStats.diff >= 0 ? 'text-teal-300' : 'text-red-300'}`}>
                                {monthlyStats.diff > 0 ? '+' : ''}{monthlyStats.diff.toFixed(2)}
                            </span>
                            <span className="text-xs text-white/40 font-bold">Std</span>
                        </div>
                    )}
                </GlassCard>
            </div >

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
                    const target = getDailyTargetForDate(dateStr, currentUser?.target_hours || {});
                    const absence = absences.find(a => dateStr >= a.start_date && dateStr <= a.end_date);

                    // Calculate hours (Ist) - EXCLUDE DELETED
                    // Calculate hours (Ist) - EXCLUDE DELETED & DEDUCT BREAK OVERLAPS
                    const dayEntries = monthEntries.filter(e => e.date === dateStr && !e.is_deleted && !e.deleted_at);
                    let hours = 0;
                    if (dayEntries.length > 0) {
                        const workEntries = dayEntries.filter(e => e.type !== 'break');
                        const breakEntries = dayEntries.filter(e => e.type === 'break');

                        let workSum = workEntries.reduce((acc, e) => acc + (isNaN(e.hours) ? 0 : e.hours), 0);

                        // Deduct overlaps
                        let overlapDeduction = 0;
                        workEntries.forEach(w => {
                            breakEntries.forEach(b => {
                                const mins = calculateOverlapInMinutes(w.start_time || '', w.end_time || '', b.start_time || '', b.end_time || '');
                                overlapDeduction += (mins / 60);
                            });
                        });

                        hours = Math.max(0, workSum - overlapDeduction);
                    }

                    // ADDED: Consider Absences (Vacation, Sick, Holiday...) as effective working time (Ist)
                    if (absence && ['vacation', 'sick', 'holiday', 'sick_child', 'sick_pay'].includes(absence.type)) {
                        // If there's a full-day paid absence, we assume the target is met as base.
                        // Any additional worked hours (entries) are added ON TOP (e.g. emergency service on holiday).
                        if (target > 0) hours = hours + target;
                    }

                    let status = 'empty';
                    if (absence) status = absence.type;
                    else {
                        if (dayEntries.length > 0) {
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
                    else if (status === 'sick_child') { bg = 'bg-orange-500/20 border-orange-500/40'; text = 'text-orange-200'; icon = <UserCheck size={12} className="text-orange-300 mt-1" />; }
                    else if (status === 'sick_pay') { bg = 'bg-rose-500/20 border-rose-500/40'; text = 'text-rose-200'; icon = <Stethoscope size={12} className="text-rose-300 mt-1" />; }
                    else if (status === 'partial') { bg = 'bg-yellow-500/20 border-yellow-500/40'; text = 'text-yellow-200'; }

                    return (
                        <div
                            key={day}
                            onClick={() => handleDayClick(day)}
                            className={`aspect-square rounded-lg border ${bg} flex flex-col items-center justify-center cursor-pointer hover:scale-105 transition-transform relative p-0.5`}
                        >
                            <span className={`text-sm font-bold ${text}`}>{day}</span>

                            {(target > 0 || hours > 0) && (
                                <div className="flex flex-col items-center leading-none mt-1 space-y-0.5 w-full">
                                    {target > 0 && <span className="text-[8px] text-white/40">Soll: {target.toLocaleString('de-DE', { maximumFractionDigits: 1 })}</span>}
                                    {hours > 0 && (
                                        <span className={`text-[8px] font-bold ${hours >= target ? 'text-emerald-400' : 'text-red-400'}`}>
                                            Ist: {hours >= target && !['vacation', 'sick', 'holiday', 'sick_child', 'sick_pay'].includes(status) ? '+' : ''}{hours.toLocaleString('de-DE', { maximumFractionDigits: 2 })}
                                        </span>
                                    )}
                                </div>
                            )}
                            {icon}
                        </div>
                    )
                })}
            </div>

            {/* MODAL: Calendar Day Detail (RESTORED) */}
            {
                selectedDay && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-7xl max-h-[90vh] overflow-y-auto relative shadow-2xl border-white/20">
                            <button onClick={() => setSelectedDay(null)} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"><X size={20} /></button>
                            <div className="mb-6">
                                <h3 className="text-2xl font-bold text-white">
                                    {selectedDay.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}
                                    <span className="ml-3 text-lg font-normal text-white/50">
                                        — {currentUser?.display_name || 'Benutzer'}
                                    </span>
                                </h3>
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
                                            type: 'overtime_reduction',
                                            surcharge: 0
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
                                {modalEntries.map(entry => {
                                    const isDeleted = entry.is_deleted || entry.deleted_at;
                                    // Calculate Net Hours for Display (Deduct Overlaps)
                                    let displayHours = isNaN(entry.hours) ? 0 : entry.hours;
                                    let deduction = 0;
                                    if (entry.type !== 'break' && !isDeleted) {
                                        const breaks = modalEntries.filter(b => b.type === 'break' && !b.is_deleted && !b.deleted_at);
                                        breaks.forEach(b => {
                                            const overlap = calculateOverlapInMinutes(entry.start_time || '', entry.end_time || '', b.start_time || '', b.end_time || '');
                                            deduction += (overlap / 60);
                                        });
                                        displayHours -= deduction;
                                        displayHours = Math.max(0, displayHours);
                                    }

                                    return (
                                        <div key={entry.id} className={`group relative p-4 rounded-xl border transition-all ${entry.type === 'emergency_service' ? 'bg-rose-500/10 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.15)]' : 'bg-white/5 border-white/10 hover:bg-white/10'} ${isDeleted ? 'opacity-50 grayscale border-dashed !bg-black/40' : ''}`}>
                                            {editingEntry?.id === entry.id ? (
                                                <div className="space-y-4 animate-in fade-in duration-200">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        <div>
                                                            <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Kunde / Projekt</label>
                                                            <GlassInput type="text" value={editForm.client_name} onChange={e => setEditForm({ ...editForm, client_name: e.target.value })} className="!py-2 !text-sm" />
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <div>
                                                                <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Start</label>
                                                                <GlassInput type="time" value={editForm.start_time} onChange={e => setEditForm({ ...editForm, start_time: e.target.value })} className="!py-2 !text-sm text-center" />
                                                            </div>
                                                            <div>
                                                                <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Ende</label>
                                                                <GlassInput type="time" value={editForm.end_time} onChange={e => setEditForm({ ...editForm, end_time: e.target.value })} className="!py-2 !text-sm text-center" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        <div>
                                                            <label className="text-[10px] text-white/40 uppercase font-bold mb-1 block">Stunden (Dezimal)</label>
                                                            <GlassInput type="number" value={editForm.hours} onChange={e => setEditForm({ ...editForm, hours: e.target.value })} className="!py-2 !text-sm" />
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] text-orange-400 uppercase font-bold mb-1 block">Änderungsgrund (Pflicht)</label>
                                                            <GlassInput type="text" value={editForm.reason} onChange={e => setEditForm({ ...editForm, reason: e.target.value })} className="!py-2 !text-sm border-orange-500/30 bg-orange-500/10 placeholder-orange-300/30" placeholder="Warum wird geändert?" />
                                                        </div>
                                                    </div>
                                                    <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                                                        <button onClick={() => setEditingEntry(null)} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-colors">Abbrechen</button>
                                                        <button onClick={handleSaveEntryEdit} className="px-3 py-2 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition-colors flex items-center gap-2"><Save size={14} /> Speichern</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col">
                                                    <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
                                                        {/* TIME & DURATION */}
                                                        <div className="flex flex-row md:flex-col items-center md:items-start gap-3 md:gap-1 min-w-[100px] border-b md:border-b-0 md:border-r border-white/10 pb-2 md:pb-0 md:pr-4 w-full md:w-auto">
                                                            <div className="text-white font-mono font-bold text-lg leading-none">
                                                                {displayHours.toFixed(2)}<span className="text-xs text-white/40 font-sans ml-1">h</span>
                                                            </div>
                                                            {deduction > 0 && (
                                                                <div className="text-[10px] text-orange-300/60 font-mono mt-0.5 leading-tight" title="Pausenabzug">
                                                                    {entry.hours.toFixed(2)} - {deduction.toFixed(2)}
                                                                </div>
                                                            )}
                                                            <div className="text-xs text-white/40 font-mono flex items-center gap-1">
                                                                <Clock size={10} />
                                                                {entry.start_time && entry.end_time ? `${entry.start_time} - ${entry.end_time}` : 'Manuell'}
                                                            </div>
                                                        </div>

                                                        {/* MAIN CONTENT */}
                                                        <div className="flex-1 min-w-0 w-full">
                                                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                                                <span className="font-bold text-white text-base truncate" title={entry.client_name}>
                                                                    {entry.client_name}
                                                                </span>
                                                                {entry.order_number && (
                                                                    <span
                                                                        onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(entry.order_number || ''); }}
                                                                        className="inline-flex items-center gap-1 bg-teal-500/10 border border-teal-500/20 px-1.5 py-0.5 rounded text-[10px] text-teal-300 font-mono cursor-pointer hover:bg-teal-500/20 active:scale-95 transition-all"
                                                                        title="Klicken zum Kopieren"
                                                                    >
                                                                        {entry.order_number}
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {/* TAGS ROW */}
                                                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                                                <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase font-bold flex items-center gap-1
                                                            ${entry.type === 'break' ? 'border-orange-500/30 text-orange-300 bg-orange-500/10' :
                                                                        entry.type === 'overtime_reduction' ? 'border-pink-500/30 text-pink-300 bg-pink-500/10' :
                                                                            entry.type === 'emergency_service' ? 'border-rose-500/30 text-rose-300 bg-rose-500/10' :
                                                                                'border-teal-500/30 text-teal-300 bg-teal-500/10'}`}>
                                                                    {entry.type === 'break' ? <Coffee size={10} /> :
                                                                        entry.type === 'overtime_reduction' ? <TrendingDown size={10} /> :
                                                                            entry.type === 'emergency_service' ? <Siren size={10} /> :
                                                                                <Briefcase size={10} />}
                                                                    {entry.type === 'overtime_reduction' ? 'Abbau' :
                                                                        entry.type === 'emergency_service' ? 'Notdienst' :
                                                                            entry.type === 'break' ? 'Pause' : 'Arbeit'}
                                                                </span>

                                                                {entry.type === 'emergency_service' && entry.surcharge && entry.surcharge > 0 && (
                                                                    <span className="text-[10px] font-bold text-rose-300 bg-rose-500/20 px-1.5 py-0.5 rounded border border-rose-500/30">
                                                                        +{entry.surcharge}% Zuschlag
                                                                    </span>
                                                                )}

                                                                {entry.late_reason && (
                                                                    <span className="text-[10px] font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/30 flex items-center gap-1" title={entry.late_reason}>
                                                                        <AlertTriangle size={10} /> Verspätet
                                                                    </span>
                                                                )}

                                                                {entry.confirmed_at ? (
                                                                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1">
                                                                        <CheckCircle size={10} /> Bestätigt von {users.find(u => u.user_id === entry.confirmed_by)?.display_name || 'Admin'}
                                                                    </span>
                                                                ) : isDeleted ? (
                                                                    <span className="text-[10px] font-bold text-white bg-red-500/20 px-1.5 py-0.5 rounded border border-red-500/30 flex items-center gap-1">
                                                                        <Trash2 size={10} /> GELÖSCHT
                                                                    </span>
                                                                ) : entry.rejected_at ? (
                                                                    <span className="text-[10px] font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20 flex items-center gap-1">
                                                                        <XCircle size={10} /> Abgelehnt
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-[10px] font-bold text-white/30 bg-white/5 px-1.5 py-0.5 rounded border border-white/10 flex items-center gap-1">
                                                                        <Clock size={10} /> Offen
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* ACTIONS */}
                                                        <div className="flex items-center gap-2 pl-4 border-l border-white/10 md:self-stretch">
                                                            {/* CONFIRMATION BUTTONS */}
                                                            {!entry.confirmed_at && !entry.rejected_at && !isDeleted && (
                                                                <div className="flex items-center gap-1">
                                                                    {/* Confirmation logic block */}
                                                                    {(() => {
                                                                        if (!canManage) return false;
                                                                        if (entry.responsible_user_id && viewerSettings?.user_id !== entry.responsible_user_id) return false;
                                                                        if (entry.late_reason && !entry.responsible_user_id && viewerSettings?.role !== 'admin' && viewerSettings?.role !== 'super_admin') return false;

                                                                        // 3. Limit to specific types (Company, Office, etc.) like in Dashboard
                                                                        const confirmationTypes = ['company', 'office', 'warehouse', 'car', 'overtime_reduction'];
                                                                        if (confirmationTypes.includes(entry.type || '')) return true;

                                                                        return false;
                                                                    })() && (
                                                                            <>
                                                                                <button
                                                                                    onClick={() => confirmEntry(entry.id)}
                                                                                    title="Bestätigen"
                                                                                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors text-teal-400 bg-teal-500/10 border border-teal-500/30 hover:bg-teal-500/30 hover:text-teal-200"
                                                                                >
                                                                                    <CheckCircle size={14} />
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => setRejectionModal({ isOpen: true, entryId: entry.id, reason: '' })}
                                                                                    title="Ablehnen"
                                                                                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors text-red-400 bg-red-500/10 border border-red-500/30 hover:bg-red-500/30 hover:text-red-200"
                                                                                >
                                                                                    <XCircle size={14} />
                                                                                </button>
                                                                            </>
                                                                        )}
                                                                </div>
                                                            )}

                                                            {/* HISTORY BUTTON */}
                                                            <button
                                                                onClick={() => {
                                                                    setHistoryModal({ isOpen: true, entryId: entry.id });
                                                                    fetchEntryHistory(entry.id);
                                                                }}
                                                                title="Verlauf anzeigen"
                                                                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors border ${entry.has_history
                                                                    ? 'text-purple-300 bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20'
                                                                    : 'text-white/30 bg-white/5 border-white/10 hover:bg-white/10 hover:text-white'}`}
                                                            >
                                                                <HistoryIcon size={14} />
                                                            </button>

                                                            {/* EDIT / DELETE (Only if allowed) */}
                                                            {canManage && !isDeleted && (
                                                                <div className="flex items-center gap-2 ml-2 pl-2 border-l border-white/10">
                                                                    <button
                                                                        onClick={() => { setEditingEntry(entry); setEditForm({ ...editForm, client_name: entry.client_name, hours: entry.hours.toString().replace('.', ','), start_time: entry.start_time || '', end_time: entry.end_time || '', note: entry.note || '', reason: '' }) }}
                                                                        title="Bearbeiten"
                                                                        className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors text-white/50 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white"
                                                                    >
                                                                        <Edit2 size={14} />
                                                                    </button>

                                                                    {entry.deletion_requested_at ? (
                                                                        <>
                                                                            <button
                                                                                onClick={() => setRejectionModal({ isOpen: true, entryId: entry.id, reason: '' })}
                                                                                className="w-8 h-8 rounded-lg flex items-center justify-center bg-orange-500/20 text-orange-400 border border-orange-500/50 hover:bg-orange-500/30"
                                                                            >
                                                                                <XCircle size={14} />
                                                                            </button>
                                                                            <button
                                                                                onClick={() => deleteEntry(entry.id, entry.deletion_request_reason || 'Löschantrag genehmigt')}
                                                                                className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-500 text-white border border-red-600 shadow-lg shadow-red-900/20 hover:bg-red-600"
                                                                            >
                                                                                <Trash2 size={14} />
                                                                            </button>
                                                                        </>
                                                                    ) : (
                                                                        <button
                                                                            onClick={() => handleDeleteEntryWithReason(entry.id)}
                                                                            title="Löschen"
                                                                            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors text-red-400/50 bg-red-500/5 border-red-500/10 hover:bg-red-500/20 hover:text-red-300"
                                                                        >
                                                                            <Trash2 size={14} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {entry.note && (
                                                        <div className="mt-3 pt-3 border-t border-white/5 w-full flex items-start gap-1.5 text-white/50 text-xs italic">
                                                            <StickyNote size={12} className="mt-0.5 shrink-0" />
                                                            <span>{entry.note}</span>
                                                        </div>
                                                    )}

                                                    {/* LATE REASON BLOCK */}
                                                    {entry.late_reason && (
                                                        <div className="mt-2 pt-2 border-t border-amber-500/20 w-full">
                                                            <div className="flex items-center gap-2 text-amber-300 bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
                                                                <AlertTriangle size={14} className="shrink-0" />
                                                                <div className="flex flex-col">
                                                                    <span className="text-xs font-bold uppercase tracking-wider text-amber-400">Verspätungsgrund</span>
                                                                    <span className="text-sm italic text-amber-200">"{entry.late_reason}"</span>
                                                                    {/* Confirmed by for Late Reason (usually same as entry confirmation) */}
                                                                    {entry.confirmed_at && (
                                                                        <span className="text-[10px] text-amber-400/60 mt-1 flex items-center gap-1">
                                                                            <CheckCircle size={10} />
                                                                            Bestätigt von {users.find(u => u.user_id === entry.confirmed_by)?.display_name || 'Admin'}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
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
                                                <option value="overtime_reduction" className="bg-gray-800 text-pink-300">Gutstunden</option>
                                                <option value="emergency_service" className="bg-gray-800 text-rose-300">Notdienst</option>
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
                                    {newEntryForm.type === 'emergency_service' && (
                                        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 flex items-center justify-between">
                                            <div className="flex items-center gap-2 text-rose-300">
                                                <Percent size={16} />
                                                <span className="text-xs uppercase font-bold">Zuschlag</span>
                                            </div>
                                            <div className="flex gap-2">
                                                {[0, 25, 50, 100].map(val => (
                                                    <button
                                                        key={val}
                                                        onClick={() => setNewEntryForm({ ...newEntryForm, surcharge: val })}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono border transition-all ${(newEntryForm as any).surcharge === val
                                                            ? 'bg-rose-500/20 text-rose-100 border-rose-500/50 shadow-[0_0_10px_rgba(244,63,94,0.2)]'
                                                            : 'bg-white/5 text-white/30 border-white/5 hover:bg-white/10'
                                                            }`}
                                                    >
                                                        {val}%
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <GlassButton onClick={handleAddEntry} className="w-full mt-2 shadow-lg shadow-teal-900/20">Eintrag hinzufügen</GlassButton>
                                </div>
                            </div>
                        </GlassCard>
                    </div >
                )
            }

            {/* Date Pickers */}
            {showAnalysisStartPicker && <GlassDatePicker value={analysisStart} onChange={setAnalysisStart} onClose={() => setShowAnalysisStartPicker(false)} />}
            {showAnalysisEndPicker && <GlassDatePicker value={analysisEnd} onChange={setAnalysisEnd} onClose={() => setShowAnalysisEndPicker(false)} />}
            {/* Rejection Modal */}
            {
                rejectionModal.isOpen && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-md border-red-500/50 shadow-2xl relative bg-gray-900/90">
                            <div className="p-4 border-b border-white/10 flex items-center gap-3">
                                <XCircle className="text-red-400" size={24} />
                                <h2 className="text-lg font-bold text-white">Eintrag ablehnen</h2>
                            </div>
                            <div className="p-4 space-y-4">
                                <p className="text-white/80">
                                    Bitte gib einen Grund für die Ablehnung an. Der Mitarbeiter wird darüber informiert.
                                </p>
                                <textarea
                                    value={rejectionModal.reason}
                                    onChange={(e) => setRejectionModal(prev => ({ ...prev, reason: e.target.value }))}
                                    placeholder="Begründung..."
                                    className="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-white focus:border-red-500/50 outline-none resize-none h-24"
                                />
                            </div>
                            <div className="p-4 border-t border-white/10 flex gap-3">
                                <button
                                    onClick={() => setRejectionModal({ isOpen: false, entryId: null, reason: '' })}
                                    className="flex-1 py-2 rounded-lg border border-white/10 text-white/60 hover:bg-white/5"
                                >
                                    Abbrechen
                                </button>
                                <button
                                    onClick={() => {
                                        if (rejectionModal.entryId && rejectionModal.reason) {
                                            rejectEntry(rejectionModal.entryId, rejectionModal.reason);
                                            setRejectionModal({ isOpen: false, entryId: null, reason: '' });
                                        }
                                    }}
                                    disabled={!rejectionModal.reason.trim()}
                                    className="flex-1 py-2 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold shadow-lg shadow-red-900/20"
                                >
                                    Ablehnen
                                </button>
                            </div>
                        </GlassCard>
                    </div>
                )
            }

            {/* HISTORY MODAL (ENTRY CHANGES) */}
            {historyModal.isOpen && (
                <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
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
                                        <div className="space-y-1 text-xs">
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
                                            <div className="mt-2 text-yellow-300 text-xs font-bold border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 rounded inline-block">
                                                Wartet auf Bestätigung
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
            )}

            {/* Quota History Modal */}
            {
                showQuotaHistory && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-lg border-white/10 shadow-2xl relative bg-gray-900/90 max-h-[80vh] flex flex-col">
                            <div className="p-4 border-b border-white/10 flex items-center justify-between">
                                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                    <HistoryIcon size={20} className="text-purple-400" />
                                    Änderungshistorie
                                </h2>
                                <button onClick={() => setShowQuotaHistory(false)} className="text-white/50 hover:text-white">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="p-4 flex-1 overflow-y-auto space-y-4">
                                {quotaAuditLogs.length === 0 ? (
                                    <p className="text-white/50 text-center py-4">Keine Änderungen gefunden.</p>
                                ) : (
                                    quotaAuditLogs.map((log) => {
                                        // Resolve name from users list
                                        const changer = users.find(u => u.user_id === log.changed_by);
                                        const name = changer ? changer.display_name : 'Admin/System';
                                        return (
                                            <div key={log.id} className="p-3 bg-white/5 rounded border border-white/5 text-sm">
                                                <div className="flex justify-between text-white/40 text-xs mb-2">
                                                    <span>{new Date(log.created_at).toLocaleString('de-DE')}</span>
                                                    <span>{name}</span>
                                                </div>
                                                <div className="space-y-1">
                                                    <div className="flex justify-between items-center text-white/80">
                                                        <span>Basis:</span>
                                                        <span className="font-mono">
                                                            {log.previous_value?.base} <ArrowLeft size={10} className="inline mx-1" /> {log.new_value?.base}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-white/80">
                                                        <span>Rest (VJ):</span>
                                                        <span className="font-mono">
                                                            {log.previous_value?.carryover} <ArrowLeft size={10} className="inline mx-1" /> {log.new_value?.carryover}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                        );
                                    })
                                )}
                            </div>
                        </GlassCard>
                    </div >
                )
            }

            {/* Permission Denied Modal */}
            {
                showPermissionError && (
                    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-sm border-red-500/50 shadow-2xl shadow-red-900/20 relative bg-gray-900/90 text-center p-6">
                            <div className="mx-auto w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4 ring-1 ring-red-500/50">
                                <ShieldAlert size={32} className="text-red-400" />
                            </div>
                            <h2 className="text-xl font-bold text-white mb-2">Zugriff verweigert</h2>
                            <p className="text-white/60 text-sm mb-6">
                                Nur der <span className="text-red-300 font-bold">Chef</span> (oder Administrator) darf den Urlaubsanspruch ändern.
                            </p>
                            <button
                                onClick={() => setShowPermissionError(false)}
                                className="w-full py-2 bg-white/10 hover:bg-white/20 rounded-xl text-white font-bold transition-all"
                            >
                                Verstanden
                            </button>
                        </GlassCard>
                    </div>
                )
            }
        </div >
    );
};

export default OfficeUserPage;
