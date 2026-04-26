

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { GlassCard, GlassButton, GlassInput } from '../components/GlassCard';
import { SpotlightCard } from '../components/SpotlightCard';
import {
    ArrowLeft, Calendar, User, Save, Clock, FileText, ChevronLeft, ChevronRight,
    Palmtree, Briefcase, Plus, TrendingDown, Trash2, X, Check, Send,
    AlertTriangle, Layout, Coffee, Siren, Percent, MoreVertical,
    Lock, Unlock, Edit2, RotateCcw, Scale, PlusCircle, Calculator, CalendarHeart, Stethoscope, UserCheck, Ban, Info, XCircle, History as HistoryIcon,
    Printer, StickyNote, CheckCircle, TrendingUp, ChevronDown, ChevronUp, CalendarCheck, ShieldAlert, List, Hash, PartyPopper, Building2, Building, Warehouse, Car
} from 'lucide-react';
import {
    useTimeEntries, useDailyLogs, useOfficeService, useAbsences, useVacationRequests,
    getLocalISOString, useSettings, useDepartments, useOvertimeBalance, fetchDailySummaries,
    fetchLifetimeStats, fetchMonthlyStats, getDailyTargetForDate
} from '../services/dataService';
import { TimeEntry, UserAbsence, VacationRequest, DailySummary, LifetimeStats, MonthlyStats } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import GlassDatePicker from '../components/GlassDatePicker';
import { useToast } from '../components/Toast';
import { formatDuration, calculateOverlapInMinutes, calculateEarnedVacation } from '../services/utils/timeUtils';
import { SubmissionTimer } from '../components/SubmissionTimer';
import { getBavarianHolidays, DEFAULT_HOLIDAY_CONFIG, Holiday } from '../services/utils/holidayUtils';
// @ts-ignore
// import logoRebelein from '../logo/Logo Rebelein.jpeg';
const logoRebelein = '/logo/Logo Rebelein.jpeg';

const OfficeUserPage: React.FC = () => {
    const { showToast } = useToast();
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
    const [showVacationModal, setShowVacationModal] = useState(false);
    const [showWorkModelModal, setShowWorkModelModal] = useState(false);
    const [showBalanceModal, setShowBalanceModal] = useState(false);

    const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
    const [editForm, setEditForm] = useState<{ date: string; client_name: string; hours: string; start_time: string; end_time: string; note: string; reason: string; type?: string; surcharge?: number; }>({
        date: '',
        client_name: '',
        hours: '',
        start_time: '',
        end_time: '',
        note: '',
        reason: '',
        type: 'work',
        surcharge: 0
    });
    const [newEntryForm, setNewEntryForm] = useState({ client_name: '', hours: '', start_time: '', end_time: '', type: 'work', surcharge: 0 });

    // Rejection State
    const [rejectionModal, setRejectionModal] = useState<{ isOpen: boolean; entryId: string | null; reason: string }>({ isOpen: false, entryId: null, reason: '' });
    const [deletionModal, setDeletionModal] = useState<{ isOpen: boolean; absenceId: string | null; reason: string; successMsg?: string; errorMsg?: string }>({ isOpen: false, absenceId: null, reason: '' });

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

    // Generic Alert Modal
    const [alertModal, setAlertModal] = useState<{ isOpen: boolean; title: string; message: string; type: 'info' | 'warning' | 'error' }>({ isOpen: false, title: '', message: '', type: 'info' });

    // School Holidays for Highlighting
    const [schoolHolidays, setSchoolHolidays] = useState<{start: string, end: string}[]>([]);

    // Print Enforcement State for Deletion
    const [deletionPrintStatus, setDeletionPrintStatus] = useState(false);

    useEffect(() => {
        const fetchSchoolHolidays = async () => {
            const { data } = await supabase
                .from('global_config')
                .select('*')
                .eq('id', 'school_holidays')
                .maybeSingle();
            if (data && data.config) {
                // Prüfe showInCalendar Flag
                if (data.config.showInCalendar === false) {
                    setSchoolHolidays([]);
                    return;
                }
                // Neues Format: { holidays: { "2026": { winterferien: { start, end }, ... } } }
                if (data.config.holidays && !Array.isArray(data.config.holidays)) {
                    const allPeriods: {start: string, end: string}[] = [];
                    for (const yearData of Object.values(data.config.holidays) as any[]) {
                        for (const period of Object.values(yearData) as any[]) {
                            if (period?.start && period?.end) {
                                allPeriods.push({ start: period.start, end: period.end });
                            }
                        }
                    }
                    setSchoolHolidays(allPeriods);
                } else if (Array.isArray(data.config.holidays)) {
                    // Altes Format: [{startDate, endDate, ...}]
                    setSchoolHolidays(data.config.holidays.map((h: any) => ({ start: h.startDate, end: h.endDate })));
                }
            }
        };
        fetchSchoolHolidays();
    }, []);



    // --- WORK MODEL EDIT STATE ---
    const [isEditingWorkModel, setIsEditingWorkModel] = useState(false);
    const [workModelTargets, setWorkModelTargets] = useState<any>({});
    const [workModelConfig, setWorkModelConfig] = useState<any>({});
    const [isWorkModelLocked, setIsWorkModelLocked] = useState(false);

    const [initialBalanceEdit, setInitialBalanceEdit] = useState<number>(0);
    const [workModelConfirmation, setWorkModelConfirmation] = useState(true);
    const [visibleToOthers, setVisibleToOthers] = useState(true);
    const [employmentStartDateEdit, setEmploymentStartDateEdit] = useState<string>('');
    const [holidayConfig, setHolidayConfig] = useState<Record<string, boolean>>({});

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
                setEmploymentStartDateEdit(u.employment_start_date || '');
                setHolidayConfig(u.holiday_config || DEFAULT_HOLIDAY_CONFIG);

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

    // --- Server-Side Data Fetching ---
    const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);

    useEffect(() => {
        const loadSummaries = async () => {
            if (userId) {
                const year = selectedMonth.getFullYear();
                const month = selectedMonth.getMonth();
                const data = await fetchDailySummaries(userId, month, year);
                setDailySummaries(data || []);
            }
        };
        loadSummaries();
    }, [userId, selectedMonth]);

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

    // Fix: Only show approved requests if they map to an existing, non-deleted absence
    const approvedRequests = useMemo(() => {
        return requests
            .filter(r => {
                if (r.status !== 'approved') return false;
                // Check if a matching absence exists
                const hasAbsence = absences?.some(a =>
                    a.start_date === r.start_date &&
                    a.end_date === r.end_date &&
                    a.type === 'vacation'
                );
                return hasAbsence;
            })
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 5);
    }, [requests, absences]);
    const analysisTotal = analysisEntries.reduce((acc, e) => acc + e.hours, 0);

    // --- LIFETIME BALANCE LOGIC ---

    // --- SERVER-SIDE CALCULATIONS ---

    // 1. Lifetime Stats (Balance)
    const [lifetimeStats, setLifetimeStats] = useState<LifetimeStats>({ target: 0, actual: 0, diff: 0, start_date: '', cutoff_date: '' });

    useEffect(() => {
        const loadLifetime = async () => {
            if (userId) {
                // Determine user start date for context if needed, but RPC handles it.
                // Re-fetch when entries change to keep in sync
                const data = await fetchLifetimeStats(userId);
                if (data) setLifetimeStats(data);
            }
        };
        loadLifetime();
        // Trigger reload when entries change (e.g. after edit/add)
    }, [userId, entries, absences]); // Absences also affect balance

    // Adapter for UI to keep "totalBalanceStats" naming
    const totalBalanceStats = useMemo(() => {
        // Sum up manual adjustments from the balance table
        const manualAdjustments = (balanceEntries || []).reduce((sum, e) => sum + (Number(e.hours) || 0), 0);

        return {
            target: lifetimeStats.target,
            actual: lifetimeStats.actual, // RPC returns "actual" as total effective work + credits
            diff: lifetimeStats.diff + manualAdjustments,
            startStr: lifetimeStats.start_date,
            cutoffStr: lifetimeStats.cutoff_date && lifetimeStats.cutoff_date >= lifetimeStats.start_date ? lifetimeStats.cutoff_date : null
        };
    }, [lifetimeStats, balanceEntries]);


    // 2. Monthly Stats
    const [monthlyRpcStats, setMonthlyRpcStats] = useState<MonthlyStats>({ target: 0, actual: 0, project_hours: 0, credits: 0, diff: 0 });

    useEffect(() => {
        const loadMonthly = async () => {
            if (userId) {
                const year = selectedMonth.getFullYear();
                const month = selectedMonth.getMonth();
                const data = await fetchMonthlyStats(userId, year, month);
                if (data) setMonthlyRpcStats(data);
            }
        };
        loadMonthly();
    }, [userId, selectedMonth, entries, absences]);

    // Adapter for UI
    const monthlyStats = useMemo(() => {
        return {
            target: monthlyRpcStats.target,
            actual: monthlyRpcStats.actual,
            diff: monthlyRpcStats.diff
        };
    }, [monthlyRpcStats]);

    // --- ABSENCE ANALYSIS (Client-side helper) ---
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

    // --- MONTHLY ATTENDANCE CALCULATION (Client-side helper) ---
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
                if (duration < 0) duration += 24;

                // Subtract breaks 
                const dayBreaks = entries.filter(e => e.date === log.date && e.type === 'break' && !e.is_deleted && !e.deleted_at)
                    .reduce((sum, b) => sum + b.hours, 0);

                total += Math.max(0, duration - dayBreaks);
            }
        });

        return total;
    }, [dailyLogs, entries, year, month]);

    const effectiveVacationClaim = useMemo(() => {
        const base = vacationDaysEdit || 30;
        const carryover = vacationCarryoverEdit || 0;
        if (unpaidDaysInYear === 0) return base + carryover;
        const reduction = (unpaidDaysInYear / 260) * base; // Reduction applies to base only typically
        return Math.max(0, (base - reduction) + carryover);
    }, [vacationDaysEdit, vacationCarryoverEdit, unpaidDaysInYear]);

    const earnedVacation = useMemo(() => {
        return calculateEarnedVacation(vacationDaysEdit || 30, vacationViewYear);
    }, [vacationDaysEdit, vacationViewYear]);

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
            is_visible_to_others: visibleToOthers,
            employment_start_date: employmentStartDateEdit,
            holiday_config: holidayConfig
        });

        if (currentUser) {
            setCurrentUser({
                ...currentUser,
                target_hours: workModelTargets,
                work_config: workModelConfig,
                require_confirmation: workModelConfirmation,
                is_visible_to_others: visibleToOthers,
                employment_start_date: employmentStartDateEdit,
                holiday_config: holidayConfig
            });
        }
        setIsEditingWorkModel(false);
    };

    const handleAutoApplyHolidays = async () => {
        if (!userId || !currentUser) return;

        const year = new Date().getFullYear();
        const holidays = getBavarianHolidays(year);
        const config = holidayConfig || DEFAULT_HOLIDAY_CONFIG;

        // Find enabled holidays
        const enabledHolidays = holidays.filter(h => config[h.id]);

        if (enabledHolidays.length === 0) {
            showToast("Keine Feiertage in der Konfiguration aktiviert.", "info");
            return;
        }

        let addedCount = 0;
        let skippedCount = 0;

        for (const h of enabledHolidays) {
            const dateStr = getLocalISOString(h.date);

            // Check if entry already exists (exclude deleted)
            const existing = entries.find(e => e.date === dateStr && e.type === 'holiday' && !e.is_deleted);

            if (!existing) {
                // Determine target hours for this day
                const dow = h.date.getDay();
                const targetHours = currentUser.target_hours?.[dow] || 0;

                if (targetHours > 0) {
                    await addEntry({
                        date: dateStr,
                        client_name: 'Feiertag: ' + h.name,
                        hours: targetHours,
                        type: 'holiday',
                        submitted: true,
                        confirmed_at: new Date().toISOString(),
                        confirmed_by: viewerSettings?.user_id
                    });
                    addedCount++;
                } else {
                    skippedCount++;
                }
            } else {
                skippedCount++;
            }
        }

        showToast(`${addedCount} Feiertage für ${year} eingetragen.`, "success");
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
        let autoStart = '';
        if (entries) {
            const dayEntries = entries.filter(e => e.date === dateStr && !e.is_deleted && !e.deleted_at);
            if (dayEntries.length > 0) {
                // Find latest end_time
                // Sort by end_time desc
                const sorted = [...dayEntries].sort((a, b) => (b.end_time || '').localeCompare(a.end_time || ''));
                if (sorted.length > 0) {
                    autoStart = sorted[0].end_time || '';
                }
            }
        }

        setEditForm({ date: dateStr, client_name: '', hours: '', start_time: '', end_time: '', note: '', reason: '', type: 'work', surcharge: 0 });
        setNewEntryForm({ client_name: '', hours: '', start_time: autoStart, end_time: '', type: 'work', surcharge: 0 });
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
                showToast("Bitte eine Begründung für den unbezahlten Tag angeben.", "warning");
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
        const { data: { user } } = await supabase.auth.getUser();

        // If "Admin" managing other user
        if (currentUser && currentUser.user_id !== user?.id) {
            setDeletionPrintStatus(false); // Reset print status
            setDeletionModal({ isOpen: true, absenceId: id, reason: '' });
            return;
        }

        // Own entry -> Delete directly
        await deleteAbsence(id);
        setSelectedDay(null);
    };

    const confirmDeletionRequest = async () => {
        if (!deletionModal.absenceId || !deletionModal.reason) return;
        const res = await deleteAbsence(deletionModal.absenceId, deletionModal.reason);

        if (res.success) {
            // Show success message within modal, wait for click to close
            setDeletionModal(prev => ({ ...prev, successMsg: res.message || "Löschung erfolgreich beantragt." }));
        } else {
            setDeletionModal(prev => ({ ...prev, errorMsg: res.message || "Ein Fehler ist aufgetreten." }));
        }
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
            showToast("Bitte geben Sie einen Änderungsgrund an.", "warning");
            return;
        }

        await updateEntry(editingEntry.id, {
            hours: parseFloat(editForm.hours.replace(',', '.')),
            start_time: editForm.start_time || undefined,
            end_time: editForm.end_time || undefined,
            note: editForm.note || undefined,
            client_name: editForm.client_name,
            type: (editForm as any).type || 'work',
            surcharge: (editForm as any).surcharge || 0
        }, editForm.reason);
        setEditingEntry(null);
    };



    // --- PDF GENERATION FOR VACATION REQUEST ---
    const generateVacationRequestPDF = async (request: any, isCopy: boolean = false) => {
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
                    doc.addImage(img, 'JPEG', 150, 10, 50, 25); // Top Right (Increased Size)
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

        // Get all requests for this year (excluding rejected AND deleted)
        // BUGFIX here: explicitly check for !is_deleted
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
        if (isCopy) {
            doc.setFontSize(14);
            doc.setTextColor(200, 50, 50);
            doc.text("(KOPIE)", 100, 25);
        }

        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(`Nr.${requestNumber} / ${reqYear}`, 20, 32);

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.text("Rebelein GmbH", 20, 45);
        doc.setFont("helvetica", "normal");
        doc.text("Heizung - Sanitär - Solartechnik", 20, 50); // UPDATED TEXT

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
        // UPDATED ADDRESS
        doc.text("Stefan Rebelein Sanitär GmbH • Martin-Behaim-Straße 6 • 90765 Fürth – Stadeln", 105, 280, { align: 'center' });
        doc.text(`Antrag ID: ${request.id.substring(0, 8)}`, 105, 285, { align: 'center' });

        doc.save(`Urlaubsantrag_${currentUser?.display_name || 'MA'}_${request.start_date}${isCopy ? '_KOPIE' : ''}.pdf`);

        // --- UPDATE REQUEST WITH PRINT LOG ---
        if (!isCopy) {
            const viewerName = viewerSettings?.display_name || 'Unbekannt';
            const printLog = `[Gedruckt von ${viewerName} am ${new Date().toLocaleDateString('de-DE')} ${new Date().toLocaleTimeString('de-DE')}]`;

            const currentNote = request.note || '';
            const newNote = currentNote ? `${currentNote}\n${printLog}` : printLog;

            const { error } = await supabase
                .from('vacation_requests')
                .update({ note: newNote })
                .eq('id', request.id);

            if (!error) {
                window.location.reload();
            }
        }
    };

    // --- WORKFLOW HELPERS ---
    const handleApproveRequest = async (req: any) => {
        // Enforce Print Check
        const note = req.note || '';
        if (!note.includes("[Gedruckt")) {
            setAlertModal({
                isOpen: true,
                title: "Drucken erforderlich",
                message: "ACHTUNG: Dieser Antrag wurde noch nicht ausgedruckt!\n\nBitte drucken Sie den Antrag zuerst aus (Drucker-Symbol), bevor Sie ihn genehmigen.",
                type: 'warning'
            });
            return;
        }

        // Proceed
        approveRequest(req);
    };

    // --- PDF FOR DELETION REQUEST ---
    const generateDeletionRequestPDF = async (absence: any, reason: string) => {
        const doc = new jsPDF();

        // Load Logo Helper (reused)
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
                    doc.addImage(img, 'JPEG', 150, 10, 50, 25);
                });
            }
        } catch (e) { }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        doc.setTextColor(200, 50, 50); // Red
        doc.text("LÖSCHUNGSANTRAG", 20, 25);

        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text("Rebelein GmbH", 20, 45);
        doc.setFont("helvetica", "normal");
        doc.text("Heizung - Sanitär - Solartechnik", 20, 50);

        doc.setDrawColor(200, 200, 200);
        doc.line(20, 55, 190, 55);

        // Info
        doc.setFontSize(11);
        doc.text(`Mitarbeiter: ${currentUser?.display_name || 'Unbekannt'}`, 20, 70);
        doc.text(`Datum: ${new Date().toLocaleDateString('de-DE')}`, 140, 70);

        // Content
        doc.setFont("helvetica", "bold");
        doc.text("Hiermit wird die Löschung des folgenden Urlaubs/Abwesenheit beantragt:", 20, 90);

        doc.setFont("helvetica", "normal");
        autoTable(doc, {
            startY: 100,
            head: [['Zeitraum', 'Typ', 'Begründung für Löschung']],
            body: [[
                `${new Date(absence.start_date).toLocaleDateString('de-DE')} - ${new Date(absence.end_date).toLocaleDateString('de-DE')}`,
                absence.type === 'vacation' ? 'Urlaub' : absence.type,
                reason
            ]],
            theme: 'grid'
        });

        // Signatures
        // @ts-ignore
        const finalY = doc.lastAutoTable.finalY + 40;

        doc.line(20, finalY, 90, finalY);
        doc.setFontSize(9);
        doc.text("Unterschrift Mitarbeiter (Kenntnisnahme)", 20, finalY + 5);

        doc.line(110, finalY, 180, finalY);
        doc.text("Unterschrift Geschäftsleitung (Antragsteller)", 110, finalY + 5);

        doc.save(`Loeschungsantrag_${currentUser?.display_name}_${absence.start_date}.pdf`);

        // Mark as printed in state
        setDeletionPrintStatus(true);
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
            showToast("Fehler beim Anfordern der Löschung.", "error");
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

    // Smart Time Input Helper
    const handleSmartTimeInput = (val: string) => {
        // Remove non-digits
        const digits = val.replace(/[^0-9]/g, '');
        if (!digits) return val;

        // Logic:
        // 1 digit: '7' -> '07:00'
        // 2 digits: '14' -> '14:00', '07' -> '07:00'
        // 3 digits: '730' -> '07:30'
        // 4 digits: '1430' -> '14:30'

        if (digits.length === 1) return `0${digits}:00`;
        if (digits.length === 2) {
            // Check if > 24, might be minutes? Assuming hours for simplicity as per request
            return `${digits}:00`;
        }
        if (digits.length === 3) {
            return `0${digits[0]}:${digits.substring(1)}`;
        }
        if (digits.length === 4) {
            return `${digits.substring(0, 2)}:${digits.substring(2)}`;
        }
        return val;
    };

    // Auto-Calculate Hours Effect
    useEffect(() => {
        if (newEntryForm.start_time && newEntryForm.end_time) {
            // check validation regex
            const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
            if (timeRegex.test(newEntryForm.start_time) && timeRegex.test(newEntryForm.end_time)) {
                const start = new Date(`2000-01-01T${newEntryForm.start_time}`);
                const end = new Date(`2000-01-01T${newEntryForm.end_time}`);
                if (end > start) {
                    const diff = (end.getTime() - start.getTime()) / 1000 / 60 / 60; // in hours
                    setNewEntryForm(prev => ({ ...prev, hours: diff.toFixed(2) }));
                }
            }
        }
    }, [newEntryForm.start_time, newEntryForm.end_time]);

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
        <div className="p-6 pb-24 h-full overflow-y-auto w-full">

            {/* NEW DASHBOARD HEADER */}
            <div className="mb-6 animate-in slide-in-from-top-4 duration-500">
                <button onClick={() => navigate('/office/users')} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-4 text-sm font-bold uppercase tracking-wider">
                    <ChevronLeft size={16} /> Zurück zur Übersicht
                </button>
                <div className="flex items-center gap-3 mb-2 text-primary font-bold uppercase tracking-widest text-xs">
                    <PartyPopper size={16} /> Mitarbeiter Dashboard
                </div>
                <h1 className="text-3xl md:text-4xl font-black text-foreground tracking-tighter leading-tight flex items-center gap-3 flex-wrap">
                    <span>Profil von <span className="text-primary">{currentUser?.display_name || 'Benutzer'}</span></span>
                    {currentUser?.is_active === false && (
                        <span className="flex items-center gap-1 text-sm border border-red-500/50 bg-red-500/20 text-red-300 px-3 py-1 rounded-full uppercase tracking-wider font-bold">
                            <Ban size={14} /> Deaktiviert
                        </span>
                    )}
                </h1>
                <p className="mt-2 text-muted-foreground text-sm">
                    Verwalte Zeiten, Urlaube und Modelle mit Präzision.
                </p>
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

            

            {/* HERO SECTION: KPI GRID + CALENDAR */}
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 mb-8 animate-in slide-in-from-bottom-4 duration-500">
                
                                {/* KPI GRID OR DAY DETAILS (Left 2/3) */}
                <div className="col-span-1 xl:col-span-3">
                    {!selectedDay ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-500">
                    
                    {/* Überstunden */}
                    <SpotlightCard className="bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-emerald-500/50 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Scale size={80} className="text-emerald-500 rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                        </div>
                        <div className="flex items-center gap-2 mb-4 relative z-10">
                            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 shadow-inner">
                                <Clock size={16} />
                            </div>
                            <span className="text-emerald-500 font-black uppercase tracking-widest text-xs">Überstundenkonto</span>
                        </div>
                        <div className="flex items-baseline gap-2 relative z-10">
                            <span className={`text-4xl font-black tracking-tighter leading-none ${totalBalanceStats.diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {totalBalanceStats.diff > 0 ? '+' : ''}{totalBalanceStats.diff.toFixed(2)}
                            </span>
                            <span className="text-sm text-muted-foreground font-bold">Std</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 relative z-10">
                            <TrendingDown size={14} className={totalBalanceStats.diff >= 0 ? 'rotate-180 text-emerald-400' : 'text-red-400'} />
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${totalBalanceStats.diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {totalBalanceStats.diff >= 0 ? 'Guthaben' : 'Minusstunden'}
                            </span>
                        </div>
                    
                        <div className="mt-6 pt-4 border-t border-white/5 space-y-1 relative z-10">
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                                <span>Gesamt Ist:</span>
                                <span className="text-foreground font-mono">{totalBalanceStats.actual.toFixed(2)} h</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                                <span>Gesamt Soll:</span>
                                <span className="text-foreground font-mono">{totalBalanceStats.target.toFixed(2)} h</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                                <span>Seit:</span>
                                <span className="text-foreground font-mono">{totalBalanceStats.startStr ? new Date(totalBalanceStats.startStr).toLocaleDateString('de-DE') : '-'}</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                                <span>Stand (Abgegeben / Abbau):</span>
                                <span className="text-foreground font-mono">{totalBalanceStats.cutoffStr ? new Date(totalBalanceStats.cutoffStr).toLocaleDateString('de-DE') : '-'}</span>
                            </div>
                        </div>
                    </SpotlightCard>

                    {/* Urlaubsverwaltung */}
                    <SpotlightCard onClick={() => setShowVacationModal(true)} className="cursor-pointer bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10 hover:-translate-y-1 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Palmtree size={80} className="text-purple-500 rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                        </div>
                        <div className="flex items-center gap-2 mb-4 relative z-10">
                            <div className="w-8 h-8 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500 shadow-inner">
                                <Palmtree size={16} />
                            </div>
                            <span className="text-purple-500 font-black uppercase tracking-widest text-xs">Urlaubsverwaltung</span>
                        </div>
                        <div className="flex items-baseline gap-2 relative z-10">
                            <span className="text-4xl font-black tracking-tighter text-foreground">
                                {takenVacationDays.toFixed(1)}
                            </span>
                            <span className="text-sm text-muted-foreground font-bold">/ {effectiveVacationClaim.toFixed(1)} Tage</span>
                        </div>
                    </SpotlightCard>

                    {/* Arbeitszeit-Modell */}
                    <SpotlightCard onClick={() => setShowWorkModelModal(true)} className="cursor-pointer bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 hover:-translate-y-1 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Briefcase size={80} className="text-blue-500 rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                        </div>
                        <div className="flex items-center gap-2 mb-4 relative z-10">
                            <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 shadow-inner">
                                <Briefcase size={16} />
                            </div>
                            <span className="text-blue-500 font-black uppercase tracking-widest text-xs">Arbeitszeit-Modell</span>
                        </div>
                        <div className="flex items-baseline gap-2 relative z-10">
                            <span className="text-4xl font-black tracking-tighter text-blue-400">
                                {dayIndices.reduce((sum, d) => sum + (Number(workModelTargets[d]) || 0), 0).toLocaleString('de-DE', { maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-sm text-muted-foreground font-bold">h / Woche</span>
                        </div>
                    </SpotlightCard>

                    {/* Anwesenheit */}
                    <SpotlightCard className="bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-blue-500/50 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
                            <UserCheck size={80} className="text-blue-500 rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                        </div>
                        <div className="flex items-center gap-2 mb-4 relative z-10">
                            <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 shadow-inner">
                                <UserCheck size={16} />
                            </div>
                            <span className="text-blue-500 font-black uppercase tracking-widest text-xs">Anwesenheit (Monat)</span>
                        </div>
                        <div className="flex items-baseline gap-2 relative z-10">
                            <span className="text-4xl font-black tracking-tighter text-blue-400">
                                {formatDuration(monthlyAttendance)}
                            </span>
                            <span className="text-sm text-muted-foreground font-bold">h</span>
                        </div>
                    </SpotlightCard>

                    {/* Startsaldo */}
                    <SpotlightCard onClick={() => setShowBalanceModal(true)} className="cursor-pointer bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-cyan-500/50 hover:shadow-lg hover:shadow-cyan-500/10 hover:-translate-y-1 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Calculator size={80} className="text-cyan-500 rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                        </div>
                        <div className="flex items-center gap-2 mb-4 relative z-10">
                            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-500 shadow-inner">
                                <Calculator size={16} />
                            </div>
                            <span className="text-cyan-500 font-black uppercase tracking-widest text-xs">Startsaldo / Übertrag</span>
                        </div>
                        <div className="flex items-baseline gap-2 relative z-10">
                            <span className="text-4xl font-black tracking-tighter text-cyan-400">
                                {balanceEntries.reduce((sum, e) => sum + e.hours, 0).toFixed(2)}
                            </span>
                            <span className="text-sm text-muted-foreground font-bold">h</span>
                        </div>
                    </SpotlightCard>

                    {/* Monatsbilanz */}
                    <SpotlightCard className="bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-teal-500/50 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Scale size={80} className="text-teal-500 rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                        </div>
                        <div className="flex items-center gap-2 mb-4 relative z-10">
                            <div className="w-8 h-8 rounded-xl bg-teal-500/10 flex items-center justify-center text-teal-500 shadow-inner">
                                <Scale size={16} />
                            </div>
                            <span className="text-teal-500 font-black uppercase tracking-widest text-xs">Monatsbilanz</span>
                        </div>
                        <div className="flex items-baseline gap-2 relative z-10">
                            <span className={`text-4xl font-black tracking-tighter ${monthlyStats.diff >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
                                {monthlyStats.diff > 0 ? '+' : ''}{monthlyStats.diff.toFixed(2)}
                            </span>
                            <span className="text-sm text-muted-foreground font-bold">h</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 relative z-10">
                            <Scale size={14} className={monthlyStats.diff >= 0 ? 'text-teal-400' : 'text-red-400'} />
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${monthlyStats.diff >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
                                Differenz (Soll/Ist)
                            </span>
                        </div>
                    
                        <div className="mt-6 pt-4 border-t border-white/5 space-y-1 relative z-10">
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                                <span>Soll (Monat):</span>
                                <span className="text-foreground font-mono">{monthlyStats.target.toFixed(2)} h</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                                <span>Ist (inkl. Urlaub/Krank):</span>
                                <span className="text-foreground font-mono">{monthlyStats.actual.toFixed(2)} h</span>
                            </div>
                        </div>
                    </SpotlightCard>

                
                        </div>
                    ) : (
                        <div className="bg-card border border-border rounded-3xl shadow-xl overflow-hidden animate-in slide-in-from-left-8 fade-in duration-500 h-[650px] xl:h-full max-h-[80vh] overflow-y-auto scrollbar-thin p-6 md:p-8 relative">
                            {/* Decorative background glow */}
                            <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-blue-500/5 to-transparent pointer-events-none" />
                            <button onClick={() => setSelectedDay(null)} className="absolute top-6 right-6 p-2 bg-muted hover:bg-red-500/20 text-muted-foreground hover:text-red-400 rounded-xl transition-all z-10"><X size={24} /></button>
                            <div className="mb-6">
                                <h3 className="text-2xl font-bold text-foreground">
                                    {selectedDay.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}
                                    <span className="ml-3 text-lg font-normal text-muted-foreground">
                                        — {currentUser?.display_name || 'Benutzer'}
                                    </span>
                                </h3>
                                <p className="text-muted-foreground text-sm">Tagesdetails bearbeiten</p>
                            </div>

                            {currentAbsence ? (
                                <div className="mb-8">
                                    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${currentAbsence.type === 'vacation' ? 'bg-purple-900/20 border-purple-500/30' :
                                        currentAbsence.type === 'sick' ? 'bg-red-900/20 border-red-500/30' :
                                            currentAbsence.type === 'holiday' ? 'bg-blue-900/20 border-blue-500/30' :
                                                currentAbsence.type === 'sick_child' ? 'bg-orange-900/20 border-orange-500/30' :
                                                    currentAbsence.type === 'sick_pay' ? 'bg-rose-900/20 border-rose-500/30' :
                                                        'bg-card border-border'
                                        }`}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                {currentAbsence.type === 'vacation' ? <Palmtree size={24} className="text-purple-300" /> :
                                                    currentAbsence.type === 'sick' ? <Stethoscope size={24} className="text-red-300" /> :
                                                        currentAbsence.type === 'holiday' ? <CalendarHeart size={24} className="text-blue-300" /> :
                                                            currentAbsence.type === 'sick_child' ? <UserCheck size={24} className="text-orange-300" /> :
                                                                currentAbsence.type === 'sick_pay' ? <Stethoscope size={24} className="text-rose-300" /> :
                                                                    <Ban size={24} className="text-muted-foreground" />}
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
                                            <button onClick={() => handleRemoveAbsence(currentAbsence.id)} className="px-3 py-2 bg-card hover:bg-red-500/20 hover:text-red-200 border border-border hover:border-red-500/30 rounded-lg text-xs font-bold transition-all flex items-center gap-2">
                                                <Trash2 size={14} /> Löschen
                                            </button>
                                        </div>
                                        {currentAbsence.note && <div className="text-xs text-muted-foreground italic mt-1 border-t border-border pt-2">"{currentAbsence.note}"</div>}
                                    </div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
                                    <button onClick={() => handleAddAbsence('vacation')} className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-purple-500/30 bg-purple-900/20 hover:bg-purple-900/40 transition-all text-purple-100 font-bold text-xs"><Palmtree size={20} /> Urlaub</button>
                                    <button onClick={() => handleAddAbsence('sick')} className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-red-500/30 bg-red-900/20 hover:bg-red-900/40 transition-all text-red-100 font-bold text-xs"><Stethoscope size={20} /> Krank</button>
                                    <button onClick={() => handleAddAbsence('holiday')} className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-blue-500/30 bg-blue-900/20 hover:bg-blue-900/40 transition-all text-blue-100 font-bold text-xs"><CalendarHeart size={20} /> Feiertag</button>
                                    <button onClick={() => { if (!unpaidReason) return; handleAddAbsence('unpaid'); }} disabled={!unpaidReason} className="w-full h-full flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-border bg-card hover:bg-card transition-all text-gray-200 font-bold text-xs disabled:opacity-50"><Ban size={20} /> Unbezahlt</button>
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
                                        <input type="text" placeholder="Begründung für Unbezahlt (z.B. Kinderkrank)..." value={unpaidReason} onChange={e => setUnpaidReason(e.target.value)} className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-border outline-none" />
                                    </div>
                                </div>
                            )}

                            <div className="w-full h-px bg-card mb-6" />

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
                                <h4 className="text-xs uppercase font-bold text-muted-foreground tracking-wider">Arbeits-Einträge</h4>
                                {modalEntries.length === 0 && (
                                    <div className="text-center py-6 bg-muted rounded-xl border border-border border-dashed">
                                        <p className="text-muted-foreground text-sm italic">Keine Einträge für diesen Tag.</p>
                                    </div>
                                )}
                                {modalEntries.map(entry => {
                                    const isDeleted = entry.is_deleted || entry.deleted_at;
                                    // Calculate Net Hours for Display (Deduct Overlaps)
                                    let displayHours = entry.calc_duration_minutes
                                        ? entry.calc_duration_minutes / 60
                                        : (isNaN(entry.hours) ? 0 : entry.hours);
                                    let deduction = 0;
                                    if (entry.type !== 'break' && !isDeleted) {
                                        const breaks = modalEntries.filter(b => b.type === 'break' && !b.is_deleted && !b.deleted_at);
                                        breaks.forEach(b => {
                                            const overlap = calculateOverlapInMinutes(entry.start_time || '', entry.end_time || '', b.start_time || '', b.end_time || '');
                                            deduction += (overlap / 60);
                                        });
                                        displayHours -= deduction;
                                        displayHours = Math.max(0, displayHours);

                                        // NEW: Apply Surcharge for Display
                                        if (entry.type === 'emergency_service' && entry.surcharge && entry.surcharge > 0) {
                                            displayHours = displayHours * (1 + (entry.surcharge / 100));
                                        }
                                    }

                                    return (
                                        <div key={entry.id} className={`group relative p-4 rounded-xl border transition-all ${entry.type === 'emergency_service' ? 'bg-rose-500/10 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.15)]' : 'bg-muted border-border hover:bg-card'} ${isDeleted ? 'opacity-50 grayscale border-dashed !bg-input' : ''}`}>
                                            {editingEntry?.id === entry.id ? (
                                                <div className="space-y-4 animate-in fade-in duration-200">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        <div>
                                                            <label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Kunde / Projekt</label>
                                                            <div className="flex gap-2">
                                                                <div className="w-1/3 min-w-[100px]">
                                                                    <select
                                                                        value={(editForm as any).type || 'work'}
                                                                        onChange={e => setEditForm({ ...editForm, type: e.target.value } as any)}
                                                                        className="w-full bg-muted border border-border rounded-lg px-2 py-2 text-foreground text-sm appearance-none focus:outline-none focus:border-teal-500/50"
                                                                    >
                                                                        <option value="work" className="bg-card">Projekt</option>
                                                                        <option value="break" className="bg-card text-amber-300">Pause</option>
                                                                        <option value="company" className="bg-card">Firma</option>
                                                                        <option value="office" className="bg-card">Büro</option>
                                                                        <option value="warehouse" className="bg-card">Lager</option>
                                                                        <option value="car" className="bg-card">Auto</option>
                                                                        <option value="overtime_reduction" className="bg-card text-pink-300">Gutstunden</option>
                                                                        <option value="emergency_service" className="bg-card text-rose-300">Notdienst</option>
                                                                    </select>
                                                                </div>
                                                                <GlassInput type="text" value={editForm.client_name} onChange={e => setEditForm({ ...editForm, client_name: e.target.value })} className="!py-2 !text-sm flex-1" />
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <div>
                                                                <label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Start</label>
                                                                <GlassInput
                                                                    type="time"
                                                                    value={editForm.start_time}
                                                                    onChange={e => {
                                                                        const val = e.target.value;
                                                                        let newHours = editForm.hours;
                                                                        // Auto-Calc Hours
                                                                        if (val && editForm.end_time) {
                                                                            const d1 = new Date(`2000-01-01T${val}`);
                                                                            const d2 = new Date(`2000-01-01T${editForm.end_time}`);
                                                                            if (!isNaN(d1.getTime()) && !isNaN(d2.getTime()) && d2 > d1) {
                                                                                newHours = ((d2.getTime() - d1.getTime()) / (1000 * 60 * 60)).toFixed(2);
                                                                            }
                                                                        }
                                                                        setEditForm({ ...editForm, start_time: val, hours: newHours });
                                                                    }}
                                                                    className="!py-2 !text-sm text-center"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Ende</label>
                                                                <GlassInput
                                                                    type="time"
                                                                    value={editForm.end_time}
                                                                    onChange={e => {
                                                                        const val = e.target.value;
                                                                        let newHours = editForm.hours;
                                                                        // Auto-Calc Hours
                                                                        if (editForm.start_time && val) {
                                                                            const d1 = new Date(`2000-01-01T${editForm.start_time}`);
                                                                            const d2 = new Date(`2000-01-01T${val}`);
                                                                            if (!isNaN(d1.getTime()) && !isNaN(d2.getTime()) && d2 > d1) {
                                                                                newHours = ((d2.getTime() - d1.getTime()) / (1000 * 60 * 60)).toFixed(2);
                                                                            }
                                                                        }
                                                                        setEditForm({ ...editForm, end_time: val, hours: newHours });
                                                                    }}
                                                                    className="!py-2 !text-sm text-center"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        <div>
                                                            <label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">Stunden (Dezimal)</label>
                                                            <GlassInput type="number" value={editForm.hours} onChange={e => setEditForm({ ...editForm, hours: e.target.value })} className="!py-2 !text-sm" />
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] text-orange-400 uppercase font-bold mb-1 block">Änderungsgrund (Pflicht)</label>
                                                            <GlassInput type="text" value={editForm.reason} onChange={e => setEditForm({ ...editForm, reason: e.target.value })} className="!py-2 !text-sm border-orange-500/30 bg-orange-500/10 placeholder-orange-300/30" placeholder="Warum wird geändert?" />
                                                        </div>
                                                    </div>
                                                    {(editForm as any).type === 'emergency_service' && (
                                                        <div className="mt-2 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2 flex items-center justify-between">
                                                            <div className="flex items-center gap-2 text-rose-300">
                                                                <Percent size={14} />
                                                                <span className="text-[10px] uppercase font-bold">Zuschlag</span>
                                                            </div>
                                                            <div className="flex gap-1">
                                                                {[0, 25, 50, 100].map(val => (
                                                                    <button
                                                                        key={val}
                                                                        onClick={() => setEditForm({ ...editForm, surcharge: val } as any)}
                                                                        className={`px-2 py-1 rounded text-[10px] font-bold font-mono border transition-all ${(editForm as any).surcharge === val
                                                                            ? 'bg-rose-500/20 text-rose-100 border-rose-500/50'
                                                                            : 'bg-muted text-muted-foreground border-border hover:bg-card'
                                                                            }`}
                                                                    >
                                                                        {val}%
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div className="flex justify-end gap-2 pt-2 border-t border-border">
                                                        <button onClick={() => setEditingEntry(null)} className="px-3 py-2 rounded-lg bg-card hover:bg-accent text-foreground text-xs font-bold transition-colors">Abbrechen</button>
                                                        <button onClick={handleSaveEntryEdit} className="px-3 py-2 rounded-lg bg-teal-500 hover:bg-teal-600 text-foreground text-xs font-bold transition-colors flex items-center gap-2"><Save size={14} /> Speichern</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col">
                                                    <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
                                                        {/* TIME & DURATION */}
                                                        <div className="flex flex-row md:flex-col items-center md:items-start gap-3 md:gap-1 min-w-[100px] border-b md:border-b-0 md:border-r border-border pb-2 md:pb-0 md:pr-4 w-full md:w-auto">
                                                            <div className="text-foreground font-mono font-bold text-lg leading-none">
                                                                {displayHours.toFixed(2)}<span className="text-xs text-muted-foreground font-sans ml-1">h</span>
                                                            </div>
                                                            {deduction > 0 && (
                                                                <div className="text-[10px] text-orange-300/60 font-mono mt-0.5 leading-tight" title="Pausenabzug">
                                                                    {entry.hours.toFixed(2)} - {deduction.toFixed(2)}
                                                                </div>
                                                            )}
                                                            <div className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                                                                <Clock size={10} />
                                                                {entry.start_time && entry.end_time ? `${entry.start_time} - ${entry.end_time}` : 'Manuell'}
                                                            </div>
                                                        </div>

                                                        {/* MAIN CONTENT */}
                                                        <div className="flex-1 min-w-0 w-full">
                                                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                                                <span className="font-bold text-foreground text-base truncate" title={entry.client_name}>
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
                                                                                entry.type === 'holiday' ? 'border-blue-500/30 text-blue-300 bg-blue-500/10' :
                                                                                    entry.type === 'company' ? 'border-blue-500/30 text-blue-300 bg-blue-500/10' :
                                                                                        entry.type === 'office' ? 'border-purple-500/30 text-purple-300 bg-purple-500/10' :
                                                                                            entry.type === 'warehouse' ? 'border-amber-500/30 text-amber-300 bg-amber-500/10' :
                                                                                                entry.type === 'car' ? 'border-border text-muted-foreground bg-gray-500/10' :
                                                                                                    'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'}`}>
                                                                    {entry.type === 'break' ? <Coffee size={10} /> :
                                                                        entry.type === 'overtime_reduction' ? <TrendingDown size={10} /> :
                                                                            entry.type === 'emergency_service' ? <Siren size={10} /> :
                                                                                entry.type === 'holiday' ? <PartyPopper size={10} /> :
                                                                                    entry.type === 'company' ? <Building2 size={10} /> :
                                                                                        entry.type === 'office' ? <Building size={10} /> :
                                                                                            entry.type === 'warehouse' ? <Warehouse size={10} /> :
                                                                                                entry.type === 'car' ? <Car size={10} /> :
                                                                                                    <Briefcase size={10} />}
                                                                    {entry.type === 'overtime_reduction' ? 'Abbau' :
                                                                        entry.type === 'emergency_service' ? 'Notdienst' :
                                                                            entry.type === 'break' ? 'Pause' :
                                                                                entry.type === 'holiday' ? 'Feiertag' :
                                                                                    entry.type === 'company' ? 'Firma' :
                                                                                        entry.type === 'office' ? 'Büro' :
                                                                                            entry.type === 'warehouse' ? 'Lager' :
                                                                                                entry.type === 'car' ? 'Fahrt' : 'Arbeit'}
                                                                </span>

                                                                {entry.type === 'emergency_service' && entry.surcharge && entry.surcharge > 0 && (
                                                                    <span className="text-[10px] font-bold text-rose-300 bg-rose-500/20 px-1.5 py-0.5 rounded border border-rose-500/30">
                                                                        +{entry.surcharge}% Zuschlag
                                                                    </span>
                                                                )}

                                                                {/* WORKFLOW STATUS BADGE - Priorisierte Logik */}
                                                                {(() => {
                                                                    // Priorität 1: Löschanfrage ausstehend
                                                                    if (entry.deletion_requested_at && !entry.is_deleted && !entry.deleted_at) {
                                                                        return (
                                                                            <span className="text-[10px] font-bold text-orange-300 bg-orange-500/20 px-2 py-1 rounded border border-orange-500/40 flex items-center gap-1.5 animate-pulse">
                                                                                <Trash2 size={11} /> Löschanfrage ausstehend
                                                                            </span>
                                                                        );
                                                                    }
                                                                    // Priorität 2: Gelöscht
                                                                    if (isDeleted) {
                                                                        return (
                                                                            <span className="text-[10px] font-bold text-foreground bg-red-500/30 px-1.5 py-0.5 rounded border border-red-500/50 flex items-center gap-1">
                                                                                <Trash2 size={10} /> GELÖSCHT
                                                                            </span>
                                                                        );
                                                                    }
                                                                    // Priorität 3: Änderung wartet auf Benutzerbestätigung
                                                                    if (entry.change_confirmed_by_user === false) {
                                                                        return (
                                                                            <span className="text-[10px] font-bold text-amber-300 bg-amber-500/20 px-2 py-1 rounded border border-amber-500/40 flex items-center gap-1.5 animate-pulse">
                                                                                <Edit2 size={11} /> Änderung wartet auf Bestätigung
                                                                            </span>
                                                                        );
                                                                    }
                                                                    // Priorität 4: Peer-Review ausstehend
                                                                    if (entry.responsible_user_id && !entry.confirmed_at && !entry.rejected_at) {
                                                                        const reviewer = users.find(u => u.user_id === entry.responsible_user_id);
                                                                        return (
                                                                            <span className="text-[10px] font-bold text-blue-300 bg-blue-500/20 px-2 py-1 rounded border border-blue-500/40 flex items-center gap-1.5 animate-pulse">
                                                                                <User size={11} /> Peer-Review: {reviewer?.display_name || 'Kollege'}
                                                                            </span>
                                                                        );
                                                                    }
                                                                    // Priorität 5: Verspäteter Eintrag wartet auf Admin
                                                                    if (entry.late_reason && !entry.confirmed_at && !entry.rejected_at) {
                                                                        return (
                                                                            <span className="text-[10px] font-bold text-amber-300 bg-amber-500/20 px-2 py-1 rounded border border-amber-500/40 flex items-center gap-1.5 animate-pulse" title={entry.late_reason}>
                                                                                <AlertTriangle size={11} /> Verspätet - wartet auf Admin
                                                                            </span>
                                                                        );
                                                                    }
                                                                    // Priorität 6: Office-Bestätigung ausstehend (für bestimmte Typen)
                                                                    const confirmationTypes = ['company', 'office', 'warehouse', 'car', 'overtime_reduction'];
                                                                    if (confirmationTypes.includes(entry.type || '') && !entry.confirmed_at && !entry.rejected_at) {
                                                                        return (
                                                                            <span className="text-[10px] font-bold text-yellow-300 bg-yellow-500/20 px-2 py-1 rounded border border-yellow-500/40 flex items-center gap-1.5 animate-pulse">
                                                                                <Clock size={11} /> Wartet auf Office-Bestätigung
                                                                            </span>
                                                                        );
                                                                    }
                                                                    // Priorität 7: Vorschlag offen
                                                                    if (entry.is_proposal && !entry.confirmed_at && !entry.rejected_at) {
                                                                        return (
                                                                            <span className="text-[10px] font-bold text-cyan-300 bg-cyan-500/20 px-2 py-1 rounded border border-cyan-500/40 flex items-center gap-1.5 animate-pulse">
                                                                                <Send size={11} /> Vorschlag offen
                                                                            </span>
                                                                        );
                                                                    }
                                                                    // Priorität 8: Bestätigt
                                                                    if (entry.confirmed_at) {
                                                                        return (
                                                                            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1">
                                                                                <CheckCircle size={10} /> Bestätigt von {users.find(u => u.user_id === entry.confirmed_by)?.display_name || 'Admin'}
                                                                            </span>
                                                                        );
                                                                    }
                                                                    // Priorität 9: Abgelehnt
                                                                    if (entry.rejected_at) {
                                                                        return (
                                                                            <span className="text-[10px] font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20 flex items-center gap-1">
                                                                                <XCircle size={10} /> Abgelehnt
                                                                            </span>
                                                                        );
                                                                    }
                                                                    // Default: Offen (nur für work-Typ ohne spezielle Anforderungen)
                                                                    return (
                                                                        <span className="text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border flex items-center gap-1">
                                                                            <CheckCircle size={10} /> OK
                                                                        </span>
                                                                    );
                                                                })()}

                                                                {/* AUTO SUBMISSION TIMER */}
                                                                <SubmissionTimer entryDate={entry.date} submitted={!!entry.submitted} />
                                                            </div>
                                                        </div>

                                                        {/* ACTIONS */}
                                                        <div className="flex items-center gap-2 pl-4 border-l border-border md:self-stretch">
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
                                                                    : 'text-muted-foreground bg-muted border-border hover:bg-card hover:text-foreground'}`}
                                                            >
                                                                <HistoryIcon size={14} />
                                                            </button>

                                                            {/* EDIT / DELETE (Only if allowed) */}
                                                            {canManage && !isDeleted && (
                                                                <div className="flex items-center gap-2 ml-2 pl-2 border-l border-border">
                                                                    <button
                                                                        onClick={() => { setEditingEntry(entry); setEditForm({ ...editForm, client_name: entry.client_name, hours: entry.hours.toString().replace('.', ','), start_time: entry.start_time || '', end_time: entry.end_time || '', note: entry.note || '', reason: '', type: entry.type, surcharge: entry.surcharge || 0 }) }}
                                                                        title="Bearbeiten"
                                                                        className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors text-muted-foreground bg-muted border border-border hover:bg-card hover:text-foreground"
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
                                                                                className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-500 text-foreground border border-red-600 shadow-lg shadow-red-900/20 hover:bg-red-600"
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
                                                        <div className="mt-3 pt-3 border-t border-border w-full flex items-start gap-1.5 text-muted-foreground text-xs italic">
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

                            <div className="bg-muted p-5 rounded-2xl border border-border shadow-inner">
                                <h4 className="text-xs uppercase font-bold text-muted-foreground mb-4 tracking-wider flex items-center gap-2"><Plus size={14} className="text-teal-400" /> Neuer Eintrag</h4>
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="md:col-span-1 relative">
                                            <select value={newEntryForm.type} onChange={e => setNewEntryForm({ ...newEntryForm, type: e.target.value })} className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-teal-500/50 transition-all cursor-pointer text-sm font-medium">
                                                <option value="work" className="bg-card text-foreground">Projekt</option>
                                                <option value="break" className="bg-card text-amber-300">Pause</option>
                                                <option value="company" className="bg-card text-foreground">Firma</option>
                                                <option value="office" className="bg-card text-foreground">Büro</option>
                                                <option value="warehouse" className="bg-card text-foreground">Lager</option>
                                                <option value="car" className="bg-card text-foreground">Auto</option>
                                                <option value="overtime_reduction" className="bg-card text-pink-300">Gutstunden</option>
                                                <option value="emergency_service" className="bg-card text-rose-300">Notdienst</option>
                                            </select>
                                            <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                                        </div>
                                        <div className="md:col-span-2">
                                            <GlassInput type="text" placeholder={newEntryForm.type === 'work' ? "Projekt / Kunde" : "Beschreibung"} value={newEntryForm.client_name} onChange={e => setNewEntryForm({ ...newEntryForm, client_name: e.target.value })} className="w-full placeholder:text-muted-foreground" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="relative bg-black/30 backdrop-blur-md rounded-2xl border border-white/10 shadow-inner group focus-within:border-primary/50 transition-all">
                                            <span className="absolute top-1.5 left-0 w-full text-center text-[8px] text-muted-foreground uppercase font-black tracking-widest opacity-60">Von</span>
                                            <input
                                                type="text"
                                                placeholder="--"
                                                value={newEntryForm.start_time}
                                                onChange={e => setNewEntryForm({ ...newEntryForm, start_time: e.target.value })}
                                                onBlur={e => setNewEntryForm({ ...newEntryForm, start_time: handleSmartTimeInput(e.target.value) })}
                                                className="w-full bg-transparent border-none text-center text-foreground font-mono text-base h-12 pt-3 focus:outline-none"
                                            />
                                        </div>
                                        <div className="relative bg-black/30 backdrop-blur-md rounded-2xl border border-white/10 shadow-inner group focus-within:border-primary/50 transition-all">
                                            <span className="absolute top-1.5 left-0 w-full text-center text-[8px] text-muted-foreground uppercase font-black tracking-widest opacity-60">Bis</span>
                                            <input
                                                type="text"
                                                placeholder="--"
                                                value={newEntryForm.end_time}
                                                onChange={e => setNewEntryForm({ ...newEntryForm, end_time: e.target.value })}
                                                onBlur={e => setNewEntryForm({ ...newEntryForm, end_time: handleSmartTimeInput(e.target.value) })}
                                                className="w-full bg-transparent border-none text-center text-foreground font-mono text-base h-12 pt-3 focus:outline-none"
                                            />
                                        </div>
                                        <div className="relative bg-black/30 backdrop-blur-md rounded-2xl border border-white/10 shadow-inner group focus-within:border-primary/50 transition-all flex flex-col justify-center">
                                            <span className="absolute top-1.5 left-0 w-full text-center text-[8px] text-teal-400 font-black uppercase tracking-widest opacity-60">Std</span>
                                            <input
                                                type="number"
                                                placeholder="0.00"
                                                value={newEntryForm.hours}
                                                onChange={e => setNewEntryForm({ ...newEntryForm, hours: e.target.value })}
                                                className="w-full bg-transparent border-none text-center text-teal-300 font-black font-mono text-xl h-12 pt-3 focus:outline-none"
                                            />
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
                                                            : 'bg-muted text-muted-foreground border-border hover:bg-card'
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
                        
                        </div>
                    )}
                </div>

                {/* CALENDAR (Right 2/5) */}
                <div className="col-span-1 xl:col-span-2 sticky top-6 z-10">
                    <SpotlightCard className="bg-card border border-border p-5 rounded-3xl shadow-xl relative overflow-hidden transition-all duration-500 hover:shadow-2xl hover:border-white/20 h-full">
                        {/* Background Watermark */}
                        <div className="absolute -top-2 -right-2 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                            <CalendarHeart size={80} className="text-foreground rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                        </div>

                        <div className="mb-4 flex justify-between items-center relative z-10">
                            <button onClick={() => setSelectedMonth(new Date(year, month - 1))} className="p-1.5 bg-background/50 text-foreground hover:bg-muted border border-border/50 rounded-lg transition-colors shadow-sm"><ChevronLeft size={14} /></button>
                            <span className="font-black text-base tracking-tighter text-foreground uppercase">{selectedMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</span>
                            <button onClick={() => setSelectedMonth(new Date(year, month + 1))} className="p-1.5 bg-background/50 text-foreground hover:bg-muted border border-border/50 rounded-lg transition-colors shadow-sm"><ChevronRight size={14} /></button>
                        </div>

                        <div className="grid grid-cols-7 gap-2 mb-2 relative z-10">
                {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => <div key={d} className="text-center text-xs text-muted-foreground font-bold uppercase">{d}</div>)}
                {blanks.map(b => <div key={`b-${b}`} />)}
                {days.map(day => {
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const target = getDailyTargetForDate(dateStr, currentUser?.target_hours || {});
                    const absence = absences.find(a => dateStr >= a.start_date && dateStr <= a.end_date);
                    const isSchoolHoliday = schoolHolidays.some(h => dateStr >= h.start && dateStr <= h.end);

                    // Calculate hours (Ist) - EXCLUDE DELETED
                    // Calculate hours (Ist) - EXCLUDE DELETED & DEDUCT BREAK OVERLAPS
                    const dayEntries = monthEntries.filter(e => e.date === dateStr && !e.is_deleted && !e.deleted_at);
                    const isEmergency = dayEntries.some(e => e.type === 'emergency_service');
                    let hours = 0;
                    if (dayEntries.length > 0) {
                        const workEntries = dayEntries.filter(e => e.type !== 'break');
                        const breakEntries = dayEntries.filter(e => e.type === 'break');

                        let workSum = workEntries.reduce((acc, e) => {
                            const duration = (e.calc_duration_minutes !== undefined && e.calc_duration_minutes !== 0)
                                ? e.calc_duration_minutes / 60
                                : (Number(e.hours) || 0);
                            
                            let surcharge = e.calc_surcharge_hours || 0;
                            
                            // Fallback for emergency surcharge if server hasn't calculated it yet
                            if (e.type === 'emergency_service' && surcharge === 0 && e.surcharge) {
                                surcharge = duration * (e.surcharge / 100);
                            }

                            return acc + duration + surcharge;
                        }, 0);

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

                    let bg = isSchoolHoliday ? 'bg-blue-400/10 border-blue-400/20' : 'bg-muted border-border';
                    let text = 'text-muted-foreground';
                    let icon = null;
                    if (status === 'vacation') { bg = 'bg-purple-500/20 border-purple-500/40'; text = 'text-purple-200'; icon = <Palmtree size={12} className="text-purple-300 mt-1" />; }
                    else if (status === 'sick') { bg = 'bg-red-500/20 border-red-500/40'; text = 'text-red-200'; icon = <Stethoscope size={12} className="text-red-300 mt-1" />; }
                    else if (status === 'holiday') { bg = 'bg-blue-500/20 border-blue-500/40'; text = 'text-blue-200'; icon = <CalendarHeart size={12} className="text-blue-300 mt-1" />; }
                    else if (status === 'unpaid') { bg = 'bg-gray-700/40 border-border'; text = 'text-muted-foreground'; icon = <Ban size={12} className="text-muted-foreground mt-1" />; }
                    else if (status === 'full') { bg = 'bg-emerald-500/20 border-emerald-500/40'; text = 'text-emerald-200'; }
                    else if (status === 'sick_child') { bg = 'bg-orange-500/20 border-orange-500/40'; text = 'text-orange-200'; icon = <UserCheck size={12} className="text-orange-300 mt-1" />; }
                    else if (status === 'sick_pay') { bg = 'bg-rose-500/20 border-rose-500/40'; text = 'text-rose-200'; icon = <Stethoscope size={12} className="text-rose-300 mt-1" />; }
                    else if (status === 'partial') { bg = 'bg-yellow-500/20 border-yellow-500/40'; text = 'text-yellow-200'; }

                    if (isEmergency) {
                        bg = 'bg-rose-500/20 border-rose-500/40 shadow-[0_0_10px_rgba(244,63,94,0.1)]';
                        text = 'text-rose-200';
                    }

                    return (
                        <div
                            key={day}
                            onClick={() => handleDayClick(day)}
                            className={`aspect-square rounded-lg border ${bg} flex flex-col items-center justify-center cursor-pointer hover:scale-105 transition-transform relative p-0.5`}
                        >
                            {isSchoolHoliday && status === 'empty' && !isEmergency && (
                                <div className="absolute top-1 left-1 w-1.5 h-1.5 bg-blue-400 rounded-full opacity-50" title="Schulferien" />
                            )}
                            {isEmergency && <Siren size={10} className="absolute top-1 right-1 text-rose-400" />}
                            <span className={`text-sm font-bold ${text}`}>{day}</span>

                            {(target > 0 || hours > 0 || isEmergency) && (
                                <div className="flex flex-col items-center leading-none mt-0.5 space-y-0 w-full">
                                    {target > 0 && <span className="text-[10px] text-muted-foreground font-medium">Soll: {target.toLocaleString('de-DE', { maximumFractionDigits: 1 })}</span>}
                                    {(hours > 0 || isEmergency) && (
                                        <span className={`text-[10px] font-bold ${hours >= target ? 'text-emerald-400' : 'text-red-400'}`}>
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
            </SpotlightCard>
        </div>
    </div>

            {/* KANBAN TASKS */}

            {(pendingRequests.length > 0 || pendingEntries.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8 animate-in slide-in-from-bottom-4 duration-500">
                    
                    {/* COLUMN 1: URLAUBSANTRÄGE */}
                    <div className="bg-card/50 border border-border rounded-3xl p-6 flex flex-col gap-4 shadow-lg">
                        <div className="flex items-center justify-between pb-3 border-b-2 border-purple-500/20 mb-2">
                            <h2 className="text-xl font-black flex items-center gap-2 text-foreground">
                                <CalendarHeart className="text-purple-500" size={24} /> Urlaubsanträge
                            </h2>
                            <div className="bg-purple-500/10 text-purple-500 text-sm font-black px-3 py-1 rounded-xl border border-purple-500/20">
                                {pendingRequests.length}
                            </div>
                        </div>
                        <div className="flex flex-col gap-4 overflow-y-auto max-h-[500px] scrollbar-thin pr-2">
                            {pendingRequests.length === 0 && <p className="text-muted-foreground text-sm italic py-4 text-center">Keine offenen Urlaubsanträge</p>}
                            {pendingRequests.map(req => (
                                <SpotlightCard key={req.id} className="bg-background border border-border p-4 rounded-xl shadow-sm hover:shadow-md hover:border-purple-500/50 transition-all flex flex-col gap-3 group">
                                    <div>
                                        <div className="font-black text-foreground text-lg mb-1">
                                            {new Date(req.start_date).toLocaleDateString('de-DE')} - {new Date(req.end_date).toLocaleDateString('de-DE')}
                                        </div>
                                        {req.note && <div className="text-muted-foreground text-sm italic">"{req.note}"</div>}
                                    </div>
                                    <div className="flex flex-wrap gap-2 mt-auto">
                                        {canManage ? (
                                            <>
                                                <button onClick={() => handleApproveRequest(req)} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 font-bold text-xs transition-colors">
                                                    <CheckCircle size={14} /> Genehmigen
                                                </button>
                                                <button onClick={() => rejectRequest(req.id)} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 font-bold text-xs transition-colors">
                                                    <XCircle size={14} /> Ablehnen
                                                </button>
                                            </>
                                        ) : (
                                            <span className="text-muted-foreground text-xs italic flex items-center">Keine Berechtigung</span>
                                        )}
                                    </div>
                                </SpotlightCard>
                            ))}
                        </div>
                    </div>

                    {/* COLUMN 2: BESTÄTIGUNGEN */}
                    <div className="bg-card/50 border border-border rounded-3xl p-6 flex flex-col gap-4 shadow-lg">
                        <div className="flex items-center justify-between pb-3 border-b-2 border-orange-500/20 mb-2">
                            <h2 className="text-xl font-black flex items-center gap-2 text-foreground">
                                <AlertTriangle className="text-orange-500" size={24} /> Zeiten bestätigen
                            </h2>
                            <div className="bg-orange-500/10 text-orange-500 text-sm font-black px-3 py-1 rounded-xl border border-orange-500/20">
                                {pendingEntries.length}
                            </div>
                        </div>
                        <div className="flex flex-col gap-4 overflow-y-auto max-h-[500px] scrollbar-thin pr-2">
                            {pendingEntries.length === 0 && <p className="text-muted-foreground text-sm italic py-4 text-center">Keine offenen Bestätigungen</p>}
                            {pendingEntries.map(entry => (
                                <SpotlightCard key={entry.id} className="bg-background border border-border p-4 rounded-xl shadow-sm hover:shadow-md hover:border-orange-500/50 transition-all flex flex-col gap-3 group">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2 text-foreground mb-2">
                                            <span className="font-black text-lg font-mono">
                                                {new Date(entry.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                                            </span>
                                            <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold tracking-wider ${entry.type === 'office' ? 'bg-blue-500/20 text-blue-300' : entry.type === 'company' ? 'bg-purple-500/20 text-purple-300' : entry.type === 'warehouse' ? 'bg-amber-500/20 text-amber-300' : 'bg-gray-500/20 text-muted-foreground'}`}>
                                                {entry.type === 'company' ? 'Firma' : entry.type === 'office' ? 'Büro' : entry.type === 'warehouse' ? 'Lager' : entry.type}
                                            </span>
                                            <span className="font-black text-emerald-400 font-mono text-lg ml-auto">
                                                {entry.hours} h
                                            </span>
                                        </div>
                                        {entry.start_time && entry.end_time && (
                                            <div className="text-xs text-muted-foreground font-mono bg-input px-2 py-1 rounded inline-block mb-2">
                                                {entry.start_time} - {entry.end_time}
                                            </div>
                                        )}
                                        {entry.note && (
                                            <div className="text-muted-foreground text-xs italic flex items-start gap-1.5 mt-1 bg-muted p-2 rounded-lg">
                                                <StickyNote size={12} className="mt-0.5 shrink-0 opacity-50" />
                                                <span>{entry.note}</span>
                                            </div>
                                        )}
                                    </div>
                                    {canManage && (
                                        <button onClick={() => confirmEntry(entry.id)} className="w-full mt-auto flex items-center justify-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 font-bold text-xs transition-colors">
                                            <CheckCircle size={14} /> Bestätigen
                                        </button>
                                    )}
                                </SpotlightCard>
                            ))}
                        </div>
                    </div>

                </div>
            )}

            

            
            {/* DYNAMIC MODAL: showVacationModal */}
            { showVacationModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={(e) => { if (e.target === e.currentTarget) setShowVacationModal(false); }}>
                    <GlassCard className="w-full max-w-4xl max-h-[90vh] overflow-y-auto relative shadow-2xl border-border !p-0 bg-background">
                        <button onClick={() => setShowVacationModal(false)} className="absolute top-4 right-4 p-2 bg-background hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-colors z-50"><X size={20} /></button>
                        <div className="p-4 md:p-6">
                            {/* URLAUBSVERWALTUNG DETAILS */}
                <div className="bg-card/50 border border-border rounded-3xl p-6 flex flex-col gap-4 shadow-lg relative overflow-hidden group">
                    <div className="flex items-center justify-between pb-3 border-b border-purple-500/20 mb-2 relative z-10">
                        <h2 className="text-xl font-black flex items-center gap-2 text-purple-400">
                            <Palmtree size={24} /> Urlaubsverwaltung Details
                        </h2>
                        <div className="flex items-center bg-background/80 rounded-xl px-2 py-1 gap-2 border border-border shadow-inner">
                            <button onClick={() => setVacationViewYear(y => y - 1)} className="text-purple-300 hover:text-foreground p-1 transition-colors"><ChevronLeft size={16} /></button>
                            <span className="text-sm font-black text-foreground w-10 text-center">{vacationViewYear}</span>
                            <button onClick={() => setVacationViewYear(y => y + 1)} className="text-purple-300 hover:text-foreground p-1 transition-colors"><ChevronRight size={16} /></button>
                        </div>
                    </div>
                    
                    <div className="flex flex-col relative z-10">
                        {unpaidDaysInYear > 0 && (
                            <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-500/20 rounded-xl text-sm text-red-200 flex items-start gap-3 shadow-inner">
                                <Info size={18} className="mt-0.5 shrink-0 text-red-400" />
                                <div>
                                    <span className="font-bold block mb-1">{unpaidDaysInYear} Tage Unbezahlt.</span>
                                    <p className="opacity-80 text-xs">Der Urlaubsanspruch wurde automatisch um {(vacationDaysEdit! - effectiveVacationClaim).toFixed(1)} Tage reduziert.</p>
                                </div>
                            </div>
                        )}

                        <div className="flex items-center justify-between bg-muted/50 p-4 rounded-2xl border border-border/50 mb-6">
                            <div className="flex flex-col gap-1 w-full max-w-[80px]">
                                <label className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">Basis</label>
                                <input
                                    type="number"
                                    disabled={isQuotaLocked}
                                    value={vacationDaysEdit ?? ''}
                                    onChange={e => {
                                        const val = parseFloat(e.target.value);
                                        setVacationDaysEdit(isNaN(val) ? 0 : val);
                                    }}
                                    className={`w-full bg-background border border-border rounded-lg px-2 py-2 text-center text-sm font-bold text-foreground focus:outline-none ${isQuotaLocked ? 'opacity-50 cursor-not-allowed' : 'focus:border-purple-500/50'}`}
                                />
                            </div>
                            <div className="text-muted-foreground font-black text-xl">+</div>
                            <div className="flex flex-col gap-1 w-full max-w-[80px]">
                                <label className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">Rest (VJ)</label>
                                <input
                                    type="number"
                                    disabled={isQuotaLocked}
                                    value={vacationCarryoverEdit ?? ''}
                                    onChange={e => {
                                        const val = parseFloat(e.target.value);
                                        setVacationCarryoverEdit(isNaN(val) ? 0 : val);
                                    }}
                                    className={`w-full bg-background border border-border rounded-lg px-2 py-2 text-center text-sm font-bold text-foreground focus:outline-none ${isQuotaLocked ? 'opacity-50 cursor-not-allowed' : 'focus:border-purple-500/50'}`}
                                />
                            </div>
                            <div className="text-muted-foreground font-black text-xl">=</div>
                            <div className="flex flex-col items-end gap-1">
                                <label className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">Gesamt</label>
                                <span className="text-2xl font-black text-purple-400">
                                    {((vacationDaysEdit || 0) + (vacationCarryoverEdit || 0)).toFixed(1)}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center justify-between mb-6">
                            <button
                                onClick={() => {
                                    if (userId) {
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
                                                    showToast("Keine Historie vorhanden.", "warning");
                                                }
                                            });
                                    }
                                }}
                                className="px-4 py-2 bg-background border border-border hover:bg-muted rounded-xl text-muted-foreground hover:text-foreground text-xs font-bold transition-colors flex items-center gap-2"
                            >
                                <HistoryIcon size={14} /> Quoten-Historie
                            </button>

                            <div className="flex gap-2">
                                <button
                                    onClick={() => setIsQuotaLocked(!isQuotaLocked)}
                                    className={`p-2 rounded-xl transition-colors flex items-center justify-center ${isQuotaLocked ? 'bg-muted text-muted-foreground hover:text-foreground' : 'bg-orange-500/20 text-orange-200 hover:bg-orange-500/30'}`}
                                    title={isQuotaLocked ? "Entsperren zum Bearbeiten" : "Bearbeitung sperren"}
                                >
                                    {isQuotaLocked ? <Lock size={16} /> : <Unlock size={16} />}
                                </button>

                                {!isQuotaLocked && (
                                    <button
                                        onClick={() => {
                                            const role = viewerSettings?.role;
                                            if (role !== 'super_admin' && role !== 'admin' && role !== 'office' && (role as string) !== 'chef') {
                                                setShowPermissionError(true);
                                                return;
                                            }

                                            if (userId && vacationDaysEdit !== null) {
                                                updateYearlyQuota(userId, vacationViewYear, {
                                                    total_days: vacationDaysEdit,
                                                    manual_carryover: vacationCarryoverEdit,
                                                    is_locked: true
                                                });
                                                setIsQuotaLocked(true);
                                                setTimeout(async () => {
                                                    const notifs = await fetchQuotaNotifications(userId);
                                                    if (notifs) setQuotaNotifications(notifs);
                                                }, 500);
                                            }
                                        }}
                                        className="px-4 py-2 bg-purple-500 hover:bg-purple-600 rounded-xl text-foreground text-xs font-bold transition-colors flex items-center gap-2 shadow-lg shadow-purple-900/20"
                                    >
                                        <Save size={16} /> {quotaNotifications.some(n => n.status === 'pending') ? 'Vorschlag aktualisieren' : 'Speichern'}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* APPROVED REQUESTS SUB-SECTION */}
                        {canManage && approvedRequests.length > 0 && (
                            <div className="pt-4 border-t border-border/50">
                                <label className="text-[10px] uppercase font-bold text-emerald-400/70 mb-3 flex items-center gap-2">
                                    <CheckCircle size={14} /> Genehmigte Urlaubsanträge (Letzte 5)
                                </label>
                                <div className="space-y-2 max-h-40 overflow-y-auto scrollbar-thin">
                                    {approvedRequests.map(req => (
                                        <div key={req.id} className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/10 flex items-center justify-between gap-2">
                                            <div>
                                                <div className="font-bold text-foreground text-sm">
                                                    {new Date(req.start_date).toLocaleDateString('de-DE')} - {new Date(req.end_date).toLocaleDateString('de-DE')}
                                                </div>
                                                <div className="text-emerald-200/50 text-[10px] mt-0.5">
                                                    {new Date(req.created_at).toLocaleDateString('de-DE')} • {req.approved_by_name || 'Admin'}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => generateVacationRequestPDF(req, true)}
                                                className="px-3 py-1.5 bg-background border border-border rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-bold transition-colors flex items-center gap-2"
                                                title="Kopie drucken"
                                            >
                                                <Printer size={12} /> Drucken
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                
                        </div>
                    </GlassCard>
                </div>
            )}

            {/* DYNAMIC MODAL: showWorkModelModal */}
            { showWorkModelModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={(e) => { if (e.target === e.currentTarget) setShowWorkModelModal(false); }}>
                    <GlassCard className="w-full max-w-4xl max-h-[90vh] overflow-y-auto relative shadow-2xl border-border !p-0 bg-background">
                        <button onClick={() => setShowWorkModelModal(false)} className="absolute top-4 right-4 p-2 bg-background hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-colors z-50"><X size={20} /></button>
                        <div className="p-4 md:p-6">
                            {/* ARBEITSZEIT-MODELL DETAILS */}
                <div className="bg-card/50 border border-border rounded-3xl p-6 flex flex-col gap-4 shadow-lg relative overflow-hidden">
                    <div className="flex items-center justify-between pb-3 border-b border-blue-500/20 mb-2 relative z-10">
                        <h2 className="text-xl font-black flex items-center gap-2 text-blue-400">
                            <Briefcase size={24} /> Arbeitszeit-Modell Details
                        </h2>
                        <div className="flex items-center gap-2">
                            {isEditingWorkModel ? (
                                <>
                                    <button onClick={() => setIsEditingWorkModel(false)} className="p-2 bg-background hover:bg-muted border border-border rounded-xl text-muted-foreground transition-colors"><RotateCcw size={16} /></button>
                                    <button onClick={handleSaveWorkModel} className="p-2 bg-blue-500/20 hover:bg-blue-500/40 text-blue-300 rounded-xl transition-colors"><Save size={16} /></button>
                                </>
                            ) : (
                                <>
                                    <button onClick={handleToggleLock} className="p-2 bg-background hover:bg-muted border border-border rounded-xl transition-colors" title={isWorkModelLocked ? "Entsperren" : "Sperren"}>
                                        {isWorkModelLocked ? <Lock size={16} className="text-red-400" /> : <Unlock size={16} className="text-emerald-400" />}
                                    </button>
                                    <button 
                                        onClick={() => !isWorkModelLocked && setIsEditingWorkModel(true)} 
                                        className={`p-2 rounded-xl transition-colors border border-border ${isWorkModelLocked ? 'bg-background opacity-50 cursor-not-allowed text-muted-foreground' : 'bg-background hover:bg-blue-500/10 text-blue-400 hover:border-blue-500/30'}`} 
                                        disabled={isWorkModelLocked}
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col relative z-10">
                        <div className="grid grid-cols-3 gap-4 mb-2 px-4">
                            <span className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">Wochentag</span>
                            <span className="text-[10px] uppercase font-black tracking-widest text-muted-foreground text-center">Arbeitsbeginn</span>
                            <span className="text-[10px] uppercase font-black tracking-widest text-muted-foreground text-right">Soll-Stunden</span>
                        </div>
                        <div className="bg-background/80 rounded-2xl border border-border/50 overflow-hidden mb-6">
                            {dayIndices.map((d, i) => {
                                const target = workModelTargets[d] || 0;
                                const start = workModelConfig[d] || "07:00";
                                return (
                                    <div key={d} className={`grid grid-cols-3 gap-4 items-center px-4 py-3 border-b border-border/50 last:border-0 ${isEditingWorkModel ? 'bg-card/50' : ''}`}>
                                        <span className={`text-sm font-black uppercase tracking-wider ${d === 0 || d === 6 ? 'text-red-400/80' : 'text-foreground'}`}>{dayNames[i]}</span>
                                        {isEditingWorkModel ? (
                                            <>
                                                <input type="time" value={start} onChange={e => handleWorkModelConfigChange(d, e.target.value)} className="bg-background text-foreground text-sm font-mono rounded-lg px-3 py-1.5 text-center border border-blue-500/30 w-full focus:ring-1 focus:ring-blue-500 outline-none" />
                                                <input type="number" value={target} onChange={e => handleWorkModelTargetChange(d, e.target.value)} className="bg-background text-foreground text-sm font-mono rounded-lg px-3 py-1.5 text-right border border-blue-500/30 w-full focus:ring-1 focus:ring-blue-500 outline-none" />
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-sm font-mono text-muted-foreground text-center">{start}</span>
                                                <span className={`text-sm font-mono text-right font-bold ${target > 0 ? 'text-foreground' : 'text-muted-foreground/50'}`}>{target > 0 ? `${target} h` : '-'}</span>
                                            </>
                                        )}
                                    </div>
                                )
                            })}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-muted/30 p-4 rounded-2xl border border-border/50">
                            {/* Employment Start Date */}
                            <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Eintrittsdatum</span>
                                {isEditingWorkModel ? (
                                    <input
                                        type="date"
                                        value={employmentStartDateEdit}
                                        onChange={(e) => setEmploymentStartDateEdit(e.target.value)}
                                        className="bg-background border border-blue-500/30 rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                ) : (
                                    <div className="text-sm font-bold text-foreground bg-background px-3 py-2 rounded-lg border border-border">
                                        {employmentStartDateEdit ? new Date(employmentStartDateEdit).toLocaleDateString('de-DE') : 'Nicht gesetzt'}
                                    </div>
                                )}
                            </div>

                            {/* Confirmation Toggle */}
                            <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Bestätigungspflicht</span>
                                {isEditingWorkModel ? (
                                    <button
                                        onClick={() => setWorkModelConfirmation(!workModelConfirmation)}
                                        className={`w-14 h-7 rounded-full p-1 transition-all ${workModelConfirmation ? 'bg-blue-500 justify-end' : 'bg-muted border border-border justify-start'} flex items-center`}
                                    >
                                        <div className="w-5 h-5 rounded-full bg-white shadow-sm" />
                                    </button>
                                ) : (
                                    <div className={`text-sm font-bold px-3 py-2 rounded-lg border ${workModelConfirmation ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-background text-muted-foreground border-border'}`}>
                                        {workModelConfirmation ? 'Aktiv' : 'Inaktiv'}
                                    </div>
                                )}
                            </div>

                            {/* Visibility Toggle */}
                            <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Sichtbarkeit</span>
                                {isEditingWorkModel ? (
                                    <button
                                        onClick={() => setVisibleToOthers(!visibleToOthers)}
                                        className={`w-14 h-7 rounded-full p-1 transition-all ${visibleToOthers ? 'bg-emerald-500 justify-end' : 'bg-muted border border-border justify-start'} flex items-center`}
                                    >
                                        <div className="w-5 h-5 rounded-full bg-white shadow-sm" />
                                    </button>
                                ) : (
                                    <div className={`text-sm font-bold px-3 py-2 rounded-lg border ${visibleToOthers ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-background text-muted-foreground border-border'}`}>
                                        {visibleToOthers ? 'Sichtbar' : 'Versteckt'}
                                    </div>
                                )}
                            </div>
                        </div>

                        {isEditingWorkModel && (
                            <div className="mt-4 text-xs font-bold text-blue-400 bg-blue-500/10 px-4 py-3 rounded-xl border border-blue-500/20 flex items-center gap-2 animate-pulse">
                                <Unlock size={16} /> Bearbeitungsmodus ist aktiv
                            </div>
                        )}
                    </div>
                </div>

                
                        </div>
                    </GlassCard>
                </div>
            )}

            {/* DYNAMIC MODAL: showBalanceModal */}
            { showBalanceModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={(e) => { if (e.target === e.currentTarget) setShowBalanceModal(false); }}>
                    <GlassCard className="w-full max-w-4xl max-h-[90vh] overflow-y-auto relative shadow-2xl border-border !p-0 bg-background">
                        <button onClick={() => setShowBalanceModal(false)} className="absolute top-4 right-4 p-2 bg-background hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-colors z-50"><X size={20} /></button>
                        <div className="p-4 md:p-6">
                            {/* STARTSALDO / ÜBERTRAG DETAILS */}
                <div className="bg-card/50 border border-border rounded-3xl p-6 flex flex-col gap-4 shadow-lg relative overflow-hidden lg:col-span-2 xl:col-span-2">
                    <div className="flex items-center justify-between pb-3 border-b border-cyan-500/20 mb-2 relative z-10">
                        <h2 className="text-xl font-black flex items-center gap-2 text-cyan-400">
                            <Calculator size={24} /> Startsaldo & Historie
                        </h2>
                        <div className="bg-cyan-500/10 text-cyan-400 text-sm font-black px-3 py-1 rounded-xl border border-cyan-500/20">
                            {balanceEntries.reduce((sum, e) => sum + e.hours, 0).toFixed(2)} h Gesamt
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                        <div className="flex flex-col max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                            <label className="text-[10px] uppercase font-bold text-muted-foreground mb-3">Buchungs-Historie</label>
                            {balanceEntries.length === 0 ? (
                                <p className="text-sm text-muted-foreground italic bg-background/50 p-4 rounded-xl border border-border">Keine manuellen Überträge vorhanden.</p>
                            ) : (
                                <div className="space-y-2">
                                    {balanceEntries.map(entry => (
                                        <div key={entry.id} className="bg-cyan-500/5 p-4 rounded-xl border border-cyan-500/10 flex items-center justify-between">
                                            <div>
                                                <div className="text-sm text-foreground italic mb-1">"{entry.reason}"</div>
                                                <div className="text-[10px] text-muted-foreground font-bold uppercase">
                                                    {entry.created_at ? new Date(entry.created_at).toLocaleDateString('de-DE') : '-'}
                                                </div>
                                            </div>
                                            <div className={`text-lg font-black tracking-wider ${entry.hours >= 0 ? 'text-cyan-400' : 'text-red-400'}`}>
                                                {entry.hours > 0 ? '+' : ''}{entry.hours.toFixed(2)} h
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {canManage && (currentUser?.role === 'admin' || viewerSettings?.role === 'admin') && (
                            <div className="bg-background/80 p-5 rounded-2xl border border-border flex flex-col justify-center h-full">
                                <div className="text-xs uppercase font-black tracking-wider text-cyan-400 mb-4 flex items-center gap-2"><PlusCircle size={16}/> Neuer Übertrag</div>
                                <div className="flex flex-col gap-3">
                                    <div className="flex gap-3">
                                        <GlassInput
                                            type="number"
                                            placeholder="Std (z.B. -10 oder 5.5)"
                                            value={balanceForm.hours}
                                            onChange={e => setBalanceForm({ ...balanceForm, hours: e.target.value })}
                                            className="w-1/3 !py-2 !px-4 !text-sm text-center font-bold"
                                        />
                                        <GlassInput
                                            type="text"
                                            placeholder="Begründung für die Buchung..."
                                            value={balanceForm.reason}
                                            onChange={e => setBalanceForm({ ...balanceForm, reason: e.target.value })}
                                            className="w-2/3 !py-2 !px-4 !text-sm"
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
                                        className="w-full py-3 bg-cyan-500 hover:bg-cyan-600 text-background text-sm font-black tracking-wider uppercase rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-cyan-900/20 mt-2 flex justify-center items-center gap-2"
                                    >
                                        <Save size={16}/> Buchen
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                        </div>
                    </GlassCard>
                </div>
            )}
{/* Date Pickers */}
            {showAnalysisStartPicker && <GlassDatePicker value={analysisStart} onChange={setAnalysisStart} onClose={() => setShowAnalysisStartPicker(false)} />}
            {showAnalysisEndPicker && <GlassDatePicker value={analysisEnd} onChange={setAnalysisEnd} onClose={() => setShowAnalysisEndPicker(false)} />}

            {/* ABSENCE DELETION REQUEST MODAL */}

            {deletionModal.isOpen && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-input backdrop-blur-sm animate-in fade-in duration-200">
                    <GlassCard className="w-full max-w-md border-red-500/50 shadow-2xl relative bg-card p-6">
                        <h3 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
                            <Trash2 className="text-red-400" /> Löschung beantragen
                        </h3>

                        {deletionModal.successMsg ? (
                            <div className="text-center py-6 space-y-4">
                                <div className="mx-auto w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400">
                                    <CheckCircle size={24} />
                                </div>
                                <p className="text-emerald-300 font-medium">{deletionModal.successMsg}</p>
                                <GlassButton onClick={() => setDeletionModal({ ...deletionModal, isOpen: false, successMsg: undefined })} variant="ghost">Schließen</GlassButton>
                            </div>
                        ) : deletionModal.errorMsg ? (
                            <div className="text-center py-6 space-y-4">
                                <div className="mx-auto w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center text-red-400">
                                    <XCircle size={24} />
                                </div>
                                <p className="text-red-300 font-medium">{deletionModal.errorMsg}</p>
                                <GlassButton onClick={() => setDeletionModal({ ...deletionModal, isOpen: false, errorMsg: undefined })} variant="ghost">Schließen</GlassButton>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <p className="text-muted-foreground text-sm">
                                    Sie beantragen die Löschung einer Abwesenheit für diesen Mitarbeiter. <br />
                                    <strong>Schritt 1:</strong> Grund angeben.<br />
                                    <strong>Schritt 2:</strong> Löschantrag drucken & unterschreiben.<br />
                                    <strong>Schritt 3:</strong> Antrag absenden.
                                </p>

                                <label className="text-xs uppercase font-bold text-muted-foreground mb-2 block">Begründung (Pflichtfeld)</label>
                                <textarea
                                    value={deletionModal.reason}
                                    onChange={(e) => setDeletionModal(prev => ({ ...prev, reason: e.target.value }))}
                                    placeholder="z.B. Urlaub storniert, Krankheitstag falsch..."
                                    className="w-full bg-input border border-border rounded-xl p-3 text-foreground text-sm focus:border-red-500/50 outline-none resize-none h-24 mb-4"
                                />

                                <div className="flex gap-2 pt-2">
                                    <button
                                        onClick={() => {
                                            if (!deletionModal.reason) { showToast("Bitte erst einen Grund angeben.", "warning"); return; }
                                            const absence = absences?.find(a => a.id === deletionModal.absenceId);
                                            if (absence) generateDeletionRequestPDF(absence, deletionModal.reason);
                                        }}
                                        disabled={!deletionModal.reason}
                                        className={`flex-1 py-3 px-4 rounded-xl border font-bold flex items-center justify-center gap-2 transition-all ${deletionModal.reason ? 'bg-blue-500/20 border-blue-500/50 text-blue-300 hover:bg-blue-500/30' : 'opacity-50 cursor-not-allowed bg-muted text-muted-foreground border-border'}`}
                                    >
                                        <Printer size={18} />
                                        {deletionPrintStatus ? 'Erneut Drucken' : 'Antrag Drucken'}
                                    </button>

                                    <button
                                        onClick={confirmDeletionRequest}
                                        disabled={!deletionPrintStatus || !deletionModal.reason}
                                        className={`flex-1 py-3 px-4 rounded-xl border font-bold flex items-center justify-center gap-2 transition-all ${deletionPrintStatus && deletionModal.reason ? 'bg-red-500/20 border-red-500/50 text-red-300 hover:bg-red-500/30' : 'opacity-50 cursor-not-allowed bg-muted text-muted-foreground border-border'}`}
                                    >
                                        <Send size={18} /> Beantragen
                                    </button>
                                </div>

                                <GlassButton onClick={() => setDeletionModal({ ...deletionModal, isOpen: false })} variant="ghost" className="w-full">
                                    Abbrechen
                                </GlassButton>
                            </div>
                        )}
                    </GlassCard>
                </div>
            )}

            {/* ALERT MODAL */}
            {alertModal.isOpen && (
                <div className="fixed inset-0 z-[150] flex items-center justify-center bg-input backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <GlassCard className="max-w-md w-full !border-amber-500/30">
                        <div className="flex flex-col items-center gap-4 text-center">
                            <div className="p-3 rounded-full bg-amber-500/20 text-amber-400">
                                <AlertTriangle size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-foreground">{alertModal.title}</h3>
                            <p className="text-muted-foreground whitespace-pre-line">{alertModal.message}</p>
                            <GlassButton onClick={() => setAlertModal({ ...alertModal, isOpen: false })} variant="primary" className="w-full mt-2">
                                OK
                            </GlassButton>
                        </div>
                    </GlassCard>
                </div>
            )}

            {/* Rejection Modal */}
            {
                rejectionModal.isOpen && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-input backdrop-blur-sm animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-md border-red-500/50 shadow-2xl relative bg-card">
                            <div className="p-4 border-b border-border flex items-center gap-3">
                                <XCircle className="text-red-400" size={24} />
                                <h2 className="text-lg font-bold text-foreground">Eintrag ablehnen</h2>
                            </div>
                            <div className="p-4 space-y-4">
                                <p className="text-muted-foreground">
                                    Bitte gib einen Grund für die Ablehnung an. Der Mitarbeiter wird darüber informiert.
                                </p>
                                <textarea
                                    value={rejectionModal.reason}
                                    onChange={(e) => setRejectionModal(prev => ({ ...prev, reason: e.target.value }))}
                                    placeholder="Begründung..."
                                    className="w-full bg-input border border-border rounded-lg p-3 text-foreground focus:border-red-500/50 outline-none resize-none h-24"
                                />
                            </div>
                            <div className="p-4 border-t border-border flex gap-3">
                                <button
                                    onClick={() => setRejectionModal({ isOpen: false, entryId: null, reason: '' })}
                                    className="flex-1 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted"
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
                                    className="flex-1 py-2 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-foreground font-bold shadow-lg shadow-red-900/20"
                                >
                                    Ablehnen
                                </button>
                            </div>
                        </GlassCard>
                    </div>
                )
            }

            {/* HISTORY MODAL (ENTRY CHANGES) */}
            {historyModal.isOpen && (() => {
                // Get current entry to show workflow status
                const currentEntry = entries.find(e => e.id === historyModal.entryId);

                // Determine current workflow step
                const getWorkflowSteps = () => {
                    if (!currentEntry) return [];

                    const steps: Array<{ label: string; status: 'done' | 'current' | 'pending'; timestamp?: string; actor?: string }> = [];

                    // Step 1: Created
                    steps.push({
                        label: 'Erstellt',
                        status: 'done',
                        timestamp: currentEntry.created_at,
                        actor: users.find(u => u.user_id === currentEntry.user_id)?.display_name || 'Benutzer'
                    });

                    // Step 2: Last Edit (if has history)
                    if (entryHistory.length > 0) {
                        const lastEdit = entryHistory[0];
                        steps.push({
                            label: 'Bearbeitet',
                            status: 'done',
                            timestamp: lastEdit.changed_at,
                            actor: lastEdit.changer_name || 'Unbekannt'
                        });
                    }

                    // Step 3: Pending Actions (if any)
                    if (currentEntry.deletion_requested_at && !currentEntry.is_deleted && !currentEntry.deleted_at) {
                        steps.push({ label: 'Löschanfrage wartet auf Bestätigung', status: 'current' });
                        steps.push({ label: 'Abgeschlossen', status: 'pending' });
                    } else if (currentEntry.change_confirmed_by_user === false) {
                        steps.push({ label: 'Änderung wartet auf Benutzerbestätigung', status: 'current' });
                        steps.push({ label: 'Abgeschlossen', status: 'pending' });
                    } else if (currentEntry.responsible_user_id && !currentEntry.confirmed_at && !currentEntry.rejected_at) {
                        const reviewer = users.find(u => u.user_id === currentEntry.responsible_user_id);
                        steps.push({ label: `Peer-Review ausstehend (${reviewer?.display_name || 'Kollege'})`, status: 'current' });
                        steps.push({ label: 'Abgeschlossen', status: 'pending' });
                    } else if (currentEntry.late_reason && !currentEntry.confirmed_at && !currentEntry.rejected_at) {
                        steps.push({ label: 'Verspätung wartet auf Admin-Bestätigung', status: 'current' });
                        steps.push({ label: 'Abgeschlossen', status: 'pending' });
                    } else if (['company', 'office', 'warehouse', 'car', 'overtime_reduction'].includes(currentEntry.type || '') && !currentEntry.confirmed_at && !currentEntry.rejected_at) {
                        steps.push({ label: 'Wartet auf Office-Bestätigung', status: 'current' });
                        steps.push({ label: 'Abgeschlossen', status: 'pending' });
                    } else if (currentEntry.is_proposal && !currentEntry.confirmed_at && !currentEntry.rejected_at) {
                        steps.push({ label: 'Vorschlag wartet auf Annahme', status: 'current' });
                        steps.push({ label: 'Abgeschlossen', status: 'pending' });
                    } else if (currentEntry.confirmed_at) {
                        steps.push({
                            label: 'Bestätigt',
                            status: 'done',
                            timestamp: currentEntry.confirmed_at,
                            actor: users.find(u => u.user_id === currentEntry.confirmed_by)?.display_name || 'Admin'
                        });
                    } else if (currentEntry.rejected_at) {
                        steps.push({
                            label: 'Abgelehnt',
                            status: 'done',
                            timestamp: currentEntry.rejected_at,
                            actor: users.find(u => u.user_id === currentEntry.rejected_by)?.display_name || 'Admin'
                        });
                    } else {
                        steps.push({ label: 'Abgeschlossen', status: 'done' });
                    }

                    return steps;
                };

                const workflowSteps = getWorkflowSteps();
                const hasPendingAction = workflowSteps.some(s => s.status === 'current');

                // Re-Trigger Handler
                const handleRetrigger = async () => {
                    if (!historyModal.entryId) return;
                    try {
                        await supabase.from('time_entries').update({ updated_at: new Date().toISOString() }).eq('id', historyModal.entryId);
                        showToast('Benachrichtigung erneut gesendet!', "success");
                    } catch (err) {
                        console.error('Retrigger failed:', err);
                        showToast('Fehler beim erneuten Senden.', "error");
                    }
                };

                return (
                    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-input backdrop-blur-md animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-2xl max-h-[85vh] overflow-y-auto relative shadow-2xl border-border">
                            <button onClick={() => setHistoryModal({ isOpen: false, entryId: null })} className="absolute top-4 right-4 p-2 bg-card hover:bg-accent rounded-full text-foreground transition-colors"><X size={20} /></button>
                            <h3 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2"><HistoryIcon size={20} /> Änderungsverlauf & Workflow-Status</h3>

                            {/* ENTRY INFO HEADER */}
                            {currentEntry && (
                                <div className="mb-4 p-3 bg-muted rounded-lg border border-border">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="font-bold text-foreground">{currentEntry.client_name}</span>
                                        <span className="text-muted-foreground text-sm">{new Date(currentEntry.date).toLocaleDateString('de-DE')}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Clock size={14} />
                                        <span>{currentEntry.start_time && currentEntry.end_time ? `${currentEntry.start_time} - ${currentEntry.end_time}` : 'Manuell'}</span>
                                        <span className="text-muted-foreground">•</span>
                                        <span className="font-mono font-bold text-foreground">{currentEntry.hours?.toFixed(2)}h</span>
                                    </div>
                                </div>
                            )}

                            {/* WORKFLOW TIMELINE */}
                            <div className="mb-6 p-4 bg-gradient-to-br from-white/5 to-white/[0.02] rounded-xl border border-border">
                                <h4 className="text-xs uppercase font-bold text-muted-foreground mb-4 flex items-center gap-2">
                                    <Layout size={14} /> Workflow-Status
                                </h4>
                                <div className="relative pl-6">
                                    {workflowSteps.map((step, idx) => (
                                        <div key={idx} className="relative pb-4 last:pb-0">
                                            {/* Connecting Line */}
                                            {idx < workflowSteps.length - 1 && (
                                                <div className={`absolute left-[-18px] top-5 w-0.5 h-full ${step.status === 'done' ? 'bg-emerald-500/50' : 'bg-card'}`} />
                                            )}
                                            {/* Step Circle */}
                                            <div className={`absolute left-[-24px] top-0.5 w-4 h-4 rounded-full flex items-center justify-center border-2 ${step.status === 'done' ? 'bg-emerald-500 border-emerald-400' :
                                                step.status === 'current' ? 'bg-yellow-500 border-yellow-400 animate-pulse' :
                                                    'bg-card border-border'
                                                }`}>
                                                {step.status === 'done' && <Check size={10} className="text-foreground" />}
                                                {step.status === 'current' && <Clock size={8} className="text-foreground" />}
                                            </div>
                                            {/* Step Content */}
                                            <div className={`${step.status === 'current' ? 'text-yellow-200' : step.status === 'done' ? 'text-foreground' : 'text-muted-foreground'}`}>
                                                <span className="font-medium text-sm">{step.label}</span>
                                                {step.timestamp && (
                                                    <div className="text-[10px] text-muted-foreground mt-0.5">
                                                        {new Date(step.timestamp).toLocaleString('de-DE')}
                                                        {step.actor && <span className="ml-1">• {step.actor}</span>}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* RE-TRIGGER BUTTON */}
                                {hasPendingAction && (
                                    <button
                                        onClick={handleRetrigger}
                                        className="mt-4 w-full py-2 px-4 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/40 rounded-lg text-amber-200 text-sm font-bold flex items-center justify-center gap-2 hover:from-amber-500/30 hover:to-orange-500/30 transition-all"
                                    >
                                        <RotateCcw size={14} />
                                        Benachrichtigung erneut senden
                                    </button>
                                )}
                            </div>

                            {/* CHANGE HISTORY */}
                            <h4 className="text-xs uppercase font-bold text-muted-foreground mb-3 flex items-center gap-2">
                                <Edit2 size={14} /> Änderungshistorie
                            </h4>
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
                );
            })()}

            {/* Quota History Modal */}
            {
                showQuotaHistory && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-input backdrop-blur-sm animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-lg border-border shadow-2xl relative bg-card max-h-[80vh] flex flex-col">
                            <div className="p-4 border-b border-border flex items-center justify-between">
                                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                                    <HistoryIcon size={20} className="text-purple-400" />
                                    Änderungshistorie
                                </h2>
                                <button onClick={() => setShowQuotaHistory(false)} className="text-muted-foreground hover:text-foreground">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="p-4 flex-1 overflow-y-auto space-y-4">
                                {quotaAuditLogs.length === 0 ? (
                                    <p className="text-muted-foreground text-center py-4">Keine Änderungen gefunden.</p>
                                ) : (
                                    quotaAuditLogs.map((log) => {
                                        // Resolve name from users list
                                        const changer = users.find(u => u.user_id === log.changed_by);
                                        const name = changer ? changer.display_name : 'Admin/System';
                                        return (
                                            <div key={log.id} className="p-3 bg-muted rounded border border-border text-sm">
                                                <div className="flex justify-between text-muted-foreground text-xs mb-2">
                                                    <span>{new Date(log.created_at).toLocaleString('de-DE')}</span>
                                                    <span>{name}</span>
                                                </div>
                                                <div className="space-y-1">
                                                    <div className="flex justify-between items-center text-muted-foreground">
                                                        <span>Basis:</span>
                                                        <span className="font-mono">
                                                            {log.previous_value?.base} <ArrowLeft size={10} className="inline mx-1" /> {log.new_value?.base}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-muted-foreground">
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
            {/* Permission Denied Modal */}
            {
                showPermissionError && (
                    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-input backdrop-blur-sm animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-sm border-red-500/50 shadow-2xl shadow-red-900/20 relative bg-card text-center p-6">
                            <div className="mx-auto w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4 ring-1 ring-red-500/50">
                                <ShieldAlert size={32} className="text-red-400" />
                            </div>
                            <h2 className="text-xl font-bold text-foreground mb-2">Zugriff verweigert</h2>
                            <p className="text-muted-foreground text-sm mb-6">
                                Nur der <span className="text-red-300 font-bold">Chef</span> (oder Administrator) darf den Urlaubsanspruch ändern.
                            </p>
                            <button
                                onClick={() => setShowPermissionError(false)}
                                className="w-full py-2 bg-card hover:bg-accent rounded-xl text-foreground font-bold transition-all"
                            >
                                Verstanden
                            </button>
                        </GlassCard>
                    </div>
                )
            }
        </div>
    );
};

export default OfficeUserPage;