
import React, { useState, useMemo, useEffect } from 'react';
import { useTimeEntries, useSettings, useDailyLogs, useAbsences, useVacationRequests, getDailyTargetForDate, getLocalISOString } from '../services/dataService';
import { formatDuration } from '../services/utils/timeUtils';
import { GlassCard, GlassButton, GlassInput } from '../components/GlassCard';
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Clock, UserCheck, Palmtree, Stethoscope, Ban, PartyPopper, CalendarHeart, X, CheckCircle, Calendar, CalendarDays, BarChart3, List, Grid3X3, ArrowRight, AlertTriangle, Scale } from 'lucide-react';
import GlassDatePicker from '../components/GlassDatePicker';

type ViewMode = 'month' | 'year' | 'overtime';

// Helper for local date string YYYY-MM-DD - NOW USING GLOBAL HELPER
// (Previously local `getLocalDateStr` was here, now removed in favor of import)

const AnalysisPage: React.FC = () => {
    const { entries } = useTimeEntries();
    const { settings } = useSettings();
    const { dailyLogs, fetchDailyLogs } = useDailyLogs();
    const { absences } = useAbsences();
    const { requests, createRequest, deleteRequest } = useVacationRequests();

    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState<ViewMode>('month');

    const [showRequestModal, setShowRequestModal] = useState(false);
    const [reqStart, setReqStart] = useState('');
    const [reqEnd, setReqEnd] = useState('');
    const [reqNote, setReqNote] = useState('');
    const [showStartPicker, setShowStartPicker] = useState(false);
    const [showEndPicker, setShowEndPicker] = useState(false);

    useEffect(() => {
        fetchDailyLogs();
    }, [fetchDailyLogs]);

    // --- Start Date Logic ---
    const effectiveStartDate = useMemo(() => {
        if (settings.employment_start_date) return settings.employment_start_date;
        if (entries.length > 0) {
            const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
            return sorted[0].date;
        }
        return '2024-01-01'; // Fallback
    }, [settings.employment_start_date, entries]);

    const lastEntryDate = useMemo(() => {
        if (entries.length > 0) return entries[0].date;
        return getLocalISOString();
    }, [entries]);


    const next = () => {
        if (viewMode === 'month') {
            setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
        } else if (viewMode === 'year') {
            setCurrentDate(new Date(currentDate.getFullYear() + 1, 0, 1));
        }
    };

    const prev = () => {
        if (viewMode === 'month') {
            setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
        } else if (viewMode === 'year') {
            setCurrentDate(new Date(currentDate.getFullYear() - 1, 0, 1));
        }
    };

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    // --- CALCULATION LOGIC ---

    const calculateTargetHours = (start: Date, end: Date, yearAbsences: typeof absences) => {
        let totalTarget = 0;

        let curr = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0);
        const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0).getTime();

        const unpaidDaysSet = new Set<string>();
        if (yearAbsences) {
            yearAbsences.filter(a => a.type === 'unpaid' || a.type === 'sick_child' || a.type === 'sick_pay').forEach(a => {
                let aStart = new Date(a.start_date); aStart.setHours(12, 0, 0, 0);
                const aEnd = new Date(a.end_date); aEnd.setHours(12, 0, 0, 0);
                while (aStart <= aEnd) {
                    unpaidDaysSet.add(getLocalISOString(aStart));
                    aStart.setDate(aStart.getDate() + 1);
                }
            });
        }
        entries.filter(e => e.type === 'unpaid' || e.type === 'sick_child' || e.type === 'sick_pay').forEach(e => {
            unpaidDaysSet.add(e.date);
        });

        while (curr.getTime() <= endMs) {
            const dateStr = getLocalISOString(curr);

            if (dateStr >= effectiveStartDate) {
                if (!unpaidDaysSet.has(dateStr)) {
                    const dailyTarget = getDailyTargetForDate(dateStr, settings.target_hours);
                    totalTarget += dailyTarget;
                }
            }
            curr.setDate(curr.getDate() + 1);
        }
        return totalTarget;
    };

    const calculateAbsenceCredits = (start: Date, end: Date, yearAbsences: typeof absences) => {
        let credits = 0;
        const creditedDates = new Set<string>();

        const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0).getTime();
        const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0).getTime();

        if (yearAbsences) {
            const paidAbsences = yearAbsences.filter(a => ['vacation', 'sick', 'holiday'].includes(a.type));

            paidAbsences.forEach(abs => {
                const aStart = new Date(abs.start_date); aStart.setHours(12, 0, 0, 0);
                const aEnd = new Date(abs.end_date); aEnd.setHours(12, 0, 0, 0);

                if (aStart.getTime() > endMs || aEnd.getTime() < startMs) return;

                const effectiveStart = aStart.getTime() < startMs ? new Date(startMs) : aStart;
                const effectiveEnd = aEnd.getTime() > endMs ? new Date(endMs) : aEnd;

                let curr = new Date(effectiveStart);
                while (curr <= effectiveEnd) {
                    const dateStr = getLocalISOString(curr);
                    if (dateStr >= effectiveStartDate) {
                        const dailyTarget = getDailyTargetForDate(dateStr, settings.target_hours);
                        if (!creditedDates.has(dateStr)) {
                            credits += dailyTarget;
                            creditedDates.add(dateStr);
                        }
                    }
                    curr.setDate(curr.getDate() + 1);
                }
            });
        }

        entries.forEach(e => {
            if (!['vacation', 'sick', 'holiday'].includes(e.type || '')) return;

            const d = new Date(e.date); d.setHours(12, 0, 0, 0);

            if (d.getTime() >= startMs && d.getTime() <= endMs && e.date >= effectiveStartDate) {
                const dateStr = e.date;
                if (!creditedDates.has(dateStr)) {
                    const dailyTarget = getDailyTargetForDate(dateStr, settings.target_hours);
                    credits += dailyTarget;
                    creditedDates.add(dateStr);
                }
            }
        });

        return credits;
    };

    // --- YEAR ABSENCE STATS ---
    const yearAbsenceStats = useMemo(() => {
        let vacationDays = 0;
        let sickDays = 0;
        let sickChildDays = 0;
        let sickPayDays = 0;
        let unpaidDays = 0;
        let unpaidNotes: { date: string, note: string }[] = [];

        if (absences) {
            absences.forEach(abs => {
                const absStart = new Date(abs.start_date); absStart.setHours(12, 0, 0, 0);
                const absEnd = new Date(abs.end_date); absEnd.setHours(12, 0, 0, 0);

                const yearStart = new Date(year, 0, 1, 12, 0, 0);
                const yearEnd = new Date(year, 11, 31, 12, 0, 0);

                if (absStart > yearEnd || absEnd < yearStart) return;

                const effectiveStart = absStart < yearStart ? yearStart : absStart;
                const effectiveEnd = absEnd > yearEnd ? yearEnd : absEnd;

                let curr = new Date(effectiveStart);
                while (curr <= effectiveEnd) {
                    const dateStr = getLocalISOString(curr);

                    const dailyTarget = getDailyTargetForDate(dateStr, settings.target_hours);

                    if (dailyTarget > 0) {
                        if (abs.type === 'vacation') vacationDays++;
                        if (abs.type === 'sick') sickDays++;
                        if (abs.type === 'sick_child') sickChildDays++;
                        if (abs.type === 'sick_pay') sickPayDays++;
                        if (abs.type === 'unpaid') {
                            unpaidDays++;
                            if (abs.note && !unpaidNotes.some(n => n.note === abs.note)) {
                                unpaidNotes.push({ date: dateStr, note: abs.note });
                            }
                        }
                    }
                    curr.setDate(curr.getDate() + 1);
                }
            });
        }

        const uniqueNotes = Array.from(new Set(unpaidNotes.map(n => n.note)));
        const yearlyAllowance = settings.vacation_days_yearly || 30;
        const remainingVacation = yearlyAllowance - vacationDays;

        return {
            vacationDays,
            sickDays,
            sickChildDays,
            sickPayDays,
            unpaidDays,
            uniqueNotes,
            yearlyAllowance,
            remainingVacation
        };
    }, [absences, year, settings.target_hours, settings.vacation_days_yearly]);


    // --- STATISTICS: MONTH VIEW ---
    const monthStats = useMemo(() => {
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const startDate = new Date(year, month, 1);
        const endDate = new Date(year, month, daysInMonth);

        const target = calculateTargetHours(startDate, endDate, absences);

        const projectHours = entries
            .filter(e => {
                const d = new Date(e.date);
                // INCLUDE OVERTIME REDUCTION for "Visual Progress" in month/year stats (treated as "done")
                return d.getFullYear() === year && d.getMonth() === month && e.type !== 'break' && e.date >= effectiveStartDate;
            })
            .reduce((sum, e) => sum + e.hours, 0);

        const credits = calculateAbsenceCredits(startDate, endDate, absences);
        const attendanceHours = dailyLogs
            .filter(l => {
                const d = new Date(l.date);
                return d.getFullYear() === year && d.getMonth() === month && l.date >= effectiveStartDate;
            })
            .reduce((sum, log) => {
                // simplified logic
                if (log.start_time && log.end_time) {
                    const st = new Date(`1970-01-01T${log.start_time}`).getTime();
                    const en = new Date(`1970-01-01T${log.end_time}`).getTime();
                    return sum + Math.max(0, (en - st) / 3600000);
                }
                return sum;
            }, 0);

        const actualTotal = projectHours + credits;
        const difference = actualTotal - target;

        return { target, actualTotal, projectHours, credits, attendanceHours, difference };
    }, [year, month, entries, absences, dailyLogs, settings.target_hours, effectiveStartDate]);

    // --- STATISTICS: YEAR VIEW ---
    const yearStats = useMemo(() => {
        const monthsData = [];
        let yearTarget = 0;
        let yearActual = 0;
        let yearAttendance = 0;

        for (let m = 0; m < 12; m++) {
            const daysInM = new Date(year, m + 1, 0).getDate();
            const start = new Date(year, m, 1);
            const end = new Date(year, m, daysInM);

            const mTarget = calculateTargetHours(start, end, absences);

            const mProjects = entries
                .filter(e => {
                    const d = new Date(e.date);
                    // INCLUDE OVERTIME REDUCTION for Year Progress (treated as "done")
                    return d.getFullYear() === year && d.getMonth() === m && e.type !== 'break' && e.date >= effectiveStartDate;
                })
                .reduce((sum, e) => sum + e.hours, 0);

            const mCredits = calculateAbsenceCredits(start, end, absences);
            const mActual = mProjects + mCredits;

            yearTarget += mTarget;
            yearActual += mActual;

            monthsData.push({
                monthIndex: m,
                target: mTarget,
                actual: mActual,
                diff: mActual - mTarget
            });
        }

        return {
            yearTarget,
            yearActual,
            yearAttendance,
            difference: yearActual - yearTarget,
            monthsData
        };
    }, [year, entries, absences, dailyLogs, settings.target_hours, effectiveStartDate]);


    // --- TREND LOGIC ---
    const trendStats = useMemo(() => {
        const todayStr = getLocalISOString();
        const limitDateStr = lastEntryDate > todayStr ? todayStr : lastEntryDate;

        let startDate: Date;
        let limitDate = new Date(limitDateStr);

        if (viewMode === 'month') {
            startDate = new Date(year, month, 1);
        } else {
            startDate = new Date(year, 0, 1);
        }

        if (limitDate < startDate) {
            return { target: 0, actual: 0, diff: 0, show: false, limitDateStr: '' };
        }

        const target = calculateTargetHours(startDate, limitDate, absences);
        const startStr = getLocalISOString(startDate);

        // For Trend: Exclude overtime reduction so it reflects "Work Done".
        const projectHours = entries
            .filter(e => {
                return e.date >= startStr && e.date <= limitDateStr && e.type !== 'break' && e.type !== 'overtime_reduction' && e.date >= effectiveStartDate;
            })
            .reduce((sum, e) => sum + e.hours, 0);

        const credits = calculateAbsenceCredits(startDate, limitDate, absences);
        const actual = projectHours + credits;

        return {
            target,
            actual,
            diff: actual - target,
            show: true,
            limitDateStr
        };

    }, [viewMode, year, month, entries, absences, lastEntryDate, effectiveStartDate]);

    // --- LIFETIME BALANCE ---
    const totalBalanceStats = useMemo(() => {
        let startStr = settings.employment_start_date;
        if (!startStr && entries.length > 0) {
            const sortedEntries = [...entries].sort((a, b) => a.date.localeCompare(b.date));
            startStr = sortedEntries[0].date;
        }
        if (!startStr) startStr = getLocalISOString();

        const todayStr = getLocalISOString();

        if (startStr > todayStr) return { target: 0, actual: 0, diff: 0, startStr, cutoffStr: null };

        // CUTOFF: Last Submitted Entry ONLY (Do not extend for overtime_reduction)
        const submittedEntries = entries.filter(e => e.submitted && e.date <= todayStr);
        const lastSubmittedEntry = submittedEntries.sort((a, b) => b.date.localeCompare(a.date))[0];

        // If no submitted entry exists, we calculate nothing or just start
        if (!lastSubmittedEntry) {
            return { target: 0, actual: 0, diff: 0, startStr, cutoffStr: null };
        }

        let cutoffDateStr = lastSubmittedEntry.date;
        if (cutoffDateStr < startStr) cutoffDateStr = startStr;

        let totalTarget = 0;
        let totalCredits = 0;

        let curr = new Date(startStr);
        curr.setHours(12, 0, 0, 0);
        const end = new Date(cutoffDateStr);
        end.setHours(12, 0, 0, 0);

        while (curr.getTime() <= end.getTime()) {
            const dateStr = getLocalISOString(curr);

            const dailyTarget = getDailyTargetForDate(dateStr, settings.target_hours);

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
                    !['break', 'vacation', 'sick', 'holiday', 'unpaid', 'overtime_reduction', 'sick_child', 'sick_pay'].includes(e.type || '');
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
        const initialBalance = settings.initial_overtime_balance || 0;

        return {
            target: totalTarget,
            actual: projectHours + totalCredits,
            diff: (projectHours + totalCredits) - totalTarget - futureReductions + initialBalance,
            startStr,
            cutoffStr: cutoffDateStr
        };

    }, [settings, entries, absences]);


    // --- GRID DATA ---
    const dailyData = useMemo(() => {
        if (viewMode === 'year' || viewMode === 'overtime') return [];

        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const grid = [];
        const firstDayOfMonthDate = new Date(year, month, 1);
        const firstDayIndex = firstDayOfMonthDate.getDay();
        const startOffset = firstDayIndex === 0 ? 6 : firstDayIndex - 1;

        for (let i = 0; i < startOffset; i++) grid.push({ day: 0, type: 'empty' });

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month, d);
            const dateStr = getLocalISOString(dateObj);

            if (dateStr < effectiveStartDate) {
                grid.push({ day: d, type: 'pre-employment' });
                continue;
            }

            const absence = absences.find(a => dateStr >= a.start_date && dateStr <= a.end_date);
            if (absence) {
                grid.push({ day: d, type: 'absence', absenceType: absence.type });
                continue;
            }

            const entryAbsence = entries.find(e => e.date === dateStr && ['vacation', 'sick', 'holiday', 'unpaid'].includes(e.type || ''));
            if (entryAbsence) {
                grid.push({ day: d, type: 'absence', absenceType: entryAbsence.type as any });
                continue;
            }

            const dayEntries = entries.filter(e => e.date === dateStr && e.type !== 'break');

            // Calculate stats
            const totalHours = dayEntries.reduce((sum, e) => sum + e.hours, 0); // Includes Overtime Reduction!
            const workHours = dayEntries.filter(e => e.type !== 'overtime_reduction').reduce((sum, e) => sum + e.hours, 0);
            const hasReduction = dayEntries.some(e => e.type === 'overtime_reduction');

            const target = getDailyTargetForDate(dateStr, settings.target_hours);

            let status = 'empty';

            if (totalHours >= target && target > 0) {
                // Target Reached
                if (workHours === 0 && hasReduction) {
                    status = 'overtime_reduction'; // Pure reduction -> Pink
                } else {
                    status = 'full'; // Work or Mixed -> Green
                }
            } else if (totalHours > 0) {
                // Partial
                status = 'partial';
                if (workHours === 0 && hasReduction) {
                    status = 'overtime_reduction'; // Partial Reduction Only
                }
            } else if (target === 0) {
                status = 'weekend';
            }

            grid.push({ day: d, type: 'work', status, hours: totalHours });
        }
        return grid;
    }, [viewMode, year, month, entries, absences, settings.target_hours, effectiveStartDate]);

    const handleCreateRequest = async () => {
        if (!reqStart || !reqEnd) return;
        await createRequest(reqStart, reqEnd, reqNote);
        setShowRequestModal(false);
        setReqStart('');
        setReqEnd('');
        setReqNote('');
    };

    const getDayColor = (item: any) => {
        if (item.type === 'pre-employment') return 'bg-gray-800/20 border-gray-700/20 text-white/10';
        if (item.type === 'absence') {
            switch (item.absenceType) {
                case 'vacation': return 'bg-purple-500/20 border-purple-500/40 text-purple-200';
                case 'sick': return 'bg-red-500/20 border-red-500/40 text-red-200';
                case 'holiday': return 'bg-blue-500/20 border-blue-500/40 text-blue-200';
                case 'unpaid': return 'bg-gray-700/40 border-gray-500/40 text-gray-400';
            }
        }
        if (item.type === 'work') {
            switch (item.status) {
                case 'full': return 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200';
                case 'partial': return 'bg-yellow-500/20 border-yellow-500/40 text-yellow-200';
                case 'overtime_reduction': return 'bg-pink-500/20 border-pink-500/40 text-pink-200';
                case 'weekend': return 'bg-white/5 border-white/5 text-white/20';
                default: return 'bg-white/5 border-white/10 text-white/50';
            }
        }
        return 'invisible';
    };

    const getMonthColor = (m: any) => {
        if (m.target === 0 && m.actual === 0) return 'bg-white/5 border-white/5 text-white/30';
        if (m.diff >= 0) return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200';
        if (Math.abs(m.diff) < 2) return 'bg-yellow-500/10 border-yellow-500/30 text-yellow-200';
        return 'bg-red-500/10 border-red-500/30 text-red-200';
    };

    const displayTarget = viewMode === 'month' ? monthStats.target : yearStats.yearTarget;
    const displayActual = viewMode === 'month' ? monthStats.actualTotal : yearStats.yearActual;
    const displayAttendance = viewMode === 'month' ? monthStats.attendanceHours : yearStats.yearAttendance;
    const displayDiff = viewMode === 'month' ? monthStats.difference : yearStats.difference;

    const displayedRequests = useMemo(() => {
        return requests.filter(r => {
            const rYear = new Date(r.start_date).getFullYear();
            return rYear === year;
        });
    }, [requests, year]);

    return (
        <div className="p-6 pb-24 h-full overflow-y-auto md:max-w-6xl md:mx-auto w-full">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-white">Analyse</h2>
                    <p className="text-white/50 text-sm">
                        {viewMode === 'month' ? 'Monatsauswertung' : viewMode === 'year' ? 'Jahresbilanz' : 'Überstundenkonto'}
                    </p>
                </div>

                <div className="flex gap-4 items-center self-end md:self-auto">
                    <div className="bg-white/10 p-1 rounded-xl flex">
                        <button
                            onClick={() => setViewMode('month')}
                            className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'month' ? 'bg-teal-500 text-white shadow-lg' : 'text-white/50 hover:text-white'}`}
                        >
                            Monat
                        </button>
                        <button
                            onClick={() => setViewMode('year')}
                            className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'year' ? 'bg-teal-500 text-white shadow-lg' : 'text-white/50 hover:text-white'}`}
                        >
                            Jahr
                        </button>
                        <button
                            onClick={() => setViewMode('overtime')}
                            className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'overtime' ? 'bg-teal-500 text-white shadow-lg' : 'text-white/50 hover:text-white'}`}
                        >
                            Überstunden
                        </button>
                    </div>
                    <GlassButton onClick={() => setShowRequestModal(true)} className="!w-auto px-4 py-2 text-sm flex items-center gap-2 bg-purple-500/20 border-purple-500/40 text-purple-200 hover:bg-purple-500/40">
                        <Palmtree size={16} /> <span className="hidden md:inline">Urlaub beantragen</span>
                    </GlassButton>
                </div>
            </div>

            {/* DATE NAV */}
            {viewMode !== 'overtime' && (
                <div className="flex items-center justify-between bg-white/5 p-2 rounded-xl border border-white/10 mb-6 max-w-md mx-auto md:mx-0">
                    <button onClick={prev} className="p-2 hover:bg-white/10 rounded-lg text-white transition-colors"><ChevronLeft /></button>
                    <span className="font-bold text-white text-lg">
                        {viewMode === 'month'
                            ? currentDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
                            : currentDate.getFullYear()
                        }
                    </span>
                    <button onClick={next} className="p-2 hover:bg-white/10 rounded-lg text-white transition-colors"><ChevronRight /></button>
                </div>
            )}

            {/* OVERTIME VIEW */}
            {viewMode === 'overtime' && (
                <div className="mb-8">
                    <GlassCard className="relative overflow-hidden group bg-emerald-900/10 border-emerald-500/20 flex flex-col justify-between max-w-md mx-auto md:mx-0">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Scale size={120} className="text-emerald-300" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 text-emerald-400 font-bold uppercase text-xs tracking-wider mb-3">
                                <Clock size={16} /> Überstundenkonto
                            </div>
                            <div className="flex items-baseline gap-2 mb-1">
                                <span className={`text-5xl font-bold font-mono ${totalBalanceStats.diff >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                                    {totalBalanceStats.diff > 0 ? '+' : ''}{totalBalanceStats.diff.toFixed(2).replace('.', ',')}
                                </span>
                                <span className="text-lg text-white/40 font-bold">Std</span>
                            </div>
                            <div className={`text-sm font-bold flex items-center gap-1 ${totalBalanceStats.diff >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                                {totalBalanceStats.diff >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                                {totalBalanceStats.diff >= 0 ? 'Guthaben' : 'Minusstunden'}
                            </div>
                        </div>
                        <div className="mt-6 pt-4 border-t border-white/5 space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-white/50">Gesamt Ist:</span>
                                <span className="text-white font-mono">{totalBalanceStats.actual.toFixed(2).replace('.', ',')} h</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-white/50">Gesamt Soll:</span>
                                <span className="text-white font-mono">{totalBalanceStats.target.toFixed(2).replace('.', ',')} h</span>
                            </div>
                            <div className="flex justify-between text-xs mt-3 text-white/30 italic">
                                <span>Seit:</span>
                                <span>{totalBalanceStats.startStr ? new Date(totalBalanceStats.startStr).toLocaleDateString('de-DE') : '-'}</span>
                            </div>
                            <div className="flex justify-between text-xs text-white/30 italic">
                                <span>Stand (Abgegeben / Abbau):</span>
                                <span>{totalBalanceStats.cutoffStr ? new Date(totalBalanceStats.cutoffStr).toLocaleDateString('de-DE') : '-'}</span>
                            </div>
                        </div>
                    </GlassCard>
                </div>
            )}

            {/* REGULAR ANALYSIS VIEW */}
            {viewMode !== 'overtime' && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                        <GlassCard className="relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                <BarChart3 size={120} className="text-teal-300" />
                            </div>
                            <div className="relative z-10">
                                <div className="text-xs font-bold text-teal-400 uppercase tracking-wider mb-1">Projekt Stunden</div>
                                <div className="flex items-end gap-3 mb-2">
                                    <span className="text-4xl md:text-5xl font-bold text-white font-mono">{displayActual.toFixed(2).replace('.', ',')}</span>
                                    <span className="text-white/40 font-bold mb-1.5">/ {displayTarget.toFixed(2)} Soll</span>
                                </div>

                                <div className="h-3 w-full bg-white/10 rounded-full overflow-hidden mb-4">
                                    <div
                                        className={`h-full rounded-full transition-all duration-1000 ${displayActual >= displayTarget ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-gradient-to-r from-yellow-400 to-orange-500'}`}
                                        style={{ width: `${Math.min(100, (displayActual / (displayTarget || 1)) * 100)}%` }}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4 border-t border-white/5 pt-3">
                                    <div>
                                        <span className="text-white/40 text-[10px] uppercase font-bold block mb-1">Prognose (Ende)</span>
                                        <div className={`flex items-center gap-2 font-mono font-bold text-lg ${displayDiff >= 0 ? 'text-emerald-300' : 'text-white/70'}`}>
                                            {displayDiff > 0 ? '+' : ''}{displayDiff.toFixed(2).replace('.', ',')} h
                                        </div>
                                    </div>

                                    {trendStats.show ? (
                                        <div className="text-right">
                                            <span className="text-white/40 text-[10px] uppercase font-bold block mb-1">
                                                Status (bis {trendStats.limitDateStr ? new Date(trendStats.limitDateStr).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : ''})
                                            </span>
                                            <div className={`flex items-center justify-end gap-2 font-mono font-bold text-lg ${trendStats.diff >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                                                {trendStats.diff >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                                                {trendStats.diff > 0 ? '+' : ''}{trendStats.diff.toFixed(2).replace('.', ',')} h
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-right text-white/30 text-xs flex items-end justify-end pb-1">Keine Daten bis heute</div>
                                    )}
                                </div>
                            </div>
                        </GlassCard>

                        <GlassCard className="relative overflow-hidden group">
                            <div className="absolute -bottom-4 -right-4 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                <UserCheck size={100} className="text-blue-300" />
                            </div>
                            <div className="relative z-10">
                                <div className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">Anwesenheit (Total)</div>
                                <div className="text-4xl font-bold text-white font-mono mb-2">{formatDuration(displayAttendance)} <span className="text-lg text-white/40">h</span></div>
                                <p className="text-white/40 text-xs leading-relaxed">
                                    Gemessene Zeit von "Kommen" bis "Gehen" abzüglich Pausen.
                                    <br />
                                    {viewMode === 'month' ? 'Im aktuellen Monat.' : 'Im gesamten Jahr.'}
                                </p>
                            </div>
                        </GlassCard>

                        {viewMode === 'year' && (
                            <GlassCard className="relative overflow-hidden group bg-purple-900/10 border-purple-500/20">
                                <div className="absolute -top-4 -right-4 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                    <Palmtree size={120} className="text-purple-300" />
                                </div>
                                <div className="relative z-10 h-full flex flex-col justify-between">
                                    <div>
                                        <div className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                            <Calendar size={16} /> Abwesenheiten {year}
                                        </div>

                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                                                <span className="text-sm font-bold text-white/70 flex items-center gap-2"><Palmtree size={14} /> Urlaub</span>
                                                <div className="text-right">
                                                    <span className="text-purple-300 font-bold">{yearAbsenceStats.vacationDays}</span>
                                                    <span className="text-white/30 text-xs"> / {yearAbsenceStats.yearlyAllowance}</span>
                                                    <div className="text-[10px] text-emerald-400/80">Rest: {yearAbsenceStats.remainingVacation}</div>
                                                </div>
                                            </div>

                                            <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                                                <span className="text-sm font-bold text-white/70 flex items-center gap-2"><Stethoscope size={14} /> Krank</span>
                                                <span className="text-red-300 font-bold">{yearAbsenceStats.sickDays} T</span>
                                            </div>

                                            <div className="flex justify-between items-start bg-white/5 p-2 rounded-lg flex-col">
                                                <div className="flex justify-between w-full mb-1">
                                                    <span className="text-sm font-bold text-white/70 flex items-center gap-2"><Ban size={14} /> Fehltage (unbezahlt)</span>
                                                    <span className="text-gray-300 font-bold">{yearAbsenceStats.unpaidDays} T</span>
                                                </div>
                                                {yearAbsenceStats.uniqueNotes.length > 0 && (
                                                    <div className="w-full text-[10px] text-white/40 italic pl-6">
                                                        {yearAbsenceStats.uniqueNotes.map((note, i) => (
                                                            <div key={i}>• {note}</div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </GlassCard>
                        )}
                    </div>

                    <GlassCard className="mb-8 p-4 md:p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-white flex items-center gap-2">
                                {viewMode === 'month' ? <CalendarDays size={18} className="text-teal-300" /> : <Grid3X3 size={18} className="text-teal-300" />}
                                {viewMode === 'month' ? 'Monatsübersicht' : 'Jahresübersicht'}
                            </h3>

                            {viewMode === 'month' && (
                                <div className="hidden md:flex gap-3 text-[10px] md:text-xs">
                                    <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Soll erreicht</div>
                                    <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500"></span> Teilweise</div>
                                    <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-pink-500"></span> Abbau</div>
                                    <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500"></span> Urlaub</div>
                                </div>
                            )}
                        </div>

                        {viewMode === 'month' ? (
                            <div className="grid grid-cols-7 gap-1">
                                {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => <div key={d} className="text-center text-xs text-white/30 font-bold uppercase py-1">{d}</div>)}

                                {dailyData.map((item, idx) => {
                                    if (item.day === 0) return <div key={`empty-${idx}`} />;
                                    return (
                                        <div
                                            key={idx}
                                            className={`h-12 md:h-14 rounded-lg border flex flex-col items-center justify-center relative ${getDayColor(item)} transition-transform hover:scale-105`}
                                        >
                                            <span className="font-bold text-sm leading-none">{item.day}</span>
                                            {item.type === 'work' && (item as any).status !== 'overtime_reduction' && (item as any).hours > 0 && <span className="text-[10px] opacity-70 mt-1">{formatDuration((item as any).hours)}</span>}
                                            {item.type === 'work' && (item as any).status === 'overtime_reduction' && <div className="mt-1"><TrendingDown size={10} className="opacity-70" /></div>}
                                            {item.type === 'absence' && (
                                                <div className="mt-1">
                                                    {item.absenceType === 'vacation' ? <Palmtree size={10} className="opacity-70" /> :
                                                        item.absenceType === 'sick' ? <Stethoscope size={10} className="opacity-70" /> :
                                                            item.absenceType === 'holiday' ? <PartyPopper size={10} className="opacity-70" /> :
                                                                <Ban size={10} className="opacity-70" />}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 lg:grid-cols-4 gap-2">
                                {yearStats.monthsData.map((m) => {
                                    const monthName = new Date(year, m.monthIndex, 1).toLocaleDateString('de-DE', { month: 'short' });
                                    const isFuture = new Date(year, m.monthIndex, 1) > new Date();

                                    return (
                                        <div key={m.monthIndex} className={`p-2 rounded-lg border flex flex-col items-center justify-center h-20 ${isFuture ? 'bg-white/5 border-white/5 opacity-50' : getMonthColor(m)}`}>
                                            <span className="text-xs font-bold uppercase tracking-wide opacity-70 mb-1">{monthName}</span>
                                            {m.diff !== 0 && !isFuture ? (
                                                <span className={`text-xl font-mono font-bold ${m.diff > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                                                    {m.diff > 0 ? '+' : ''}{m.diff.toFixed(2).replace('.', ',')}
                                                </span>
                                            ) : (
                                                <span className="text-white/20 font-mono">-</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </GlassCard>
                </>
            )}

            {/* REQUESTS LIST */}
            {viewMode !== 'overtime' && (
                <GlassCard>
                    <div className="flex items-center gap-2 mb-4 text-purple-300 font-bold uppercase text-xs tracking-wider">
                        <List size={16} /> Meine Anträge ({year})
                    </div>
                    {displayedRequests.length === 0 ? (
                        <div className="text-center py-6 text-white/30 italic">Keine Anträge in diesem Jahr.</div>
                    ) : (
                        <div className="space-y-3">
                            {displayedRequests.map(req => (
                                <div key={req.id} className="bg-white/5 rounded-xl p-3 flex justify-between items-center border border-white/5">
                                    <div>
                                        <div className="font-bold text-white text-sm">
                                            {new Date(req.start_date).toLocaleDateString('de-DE')} - {new Date(req.end_date).toLocaleDateString('de-DE')}
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                            {req.status === 'approved' && <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30 flex items-center gap-1"><CheckCircle size={10} /> Genehmigt</span>}
                                            {req.status === 'pending' && <span className="text-[10px] bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded border border-orange-500/30 flex items-center gap-1"><Clock size={10} /> In Prüfung</span>}
                                            {req.status === 'rejected' && <span className="text-[10px] bg-red-500/20 text-red-300 px-2 py-0.5 rounded border border-red-500/30 flex items-center gap-1"><X size={10} /> Abgelehnt</span>}
                                        </div>
                                    </div>
                                    {req.status === 'pending' && (
                                        <button onClick={() => deleteRequest(req.id)} className="p-2 bg-white/5 hover:bg-red-500/20 text-white/50 hover:text-red-300 rounded-lg transition-colors">
                                            <X size={16} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </GlassCard>
            )}

            {/* REQUEST MODAL */}
            {showRequestModal && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <GlassCard className="w-full max-w-sm relative shadow-2xl border-purple-500/30">
                        <button onClick={() => setShowRequestModal(false)} className="absolute top-4 right-4 text-white/50 hover:text-white"><X size={20} /></button>
                        <div className="flex items-center gap-3 text-purple-300 mb-6"><Palmtree size={24} /><h3 className="text-xl font-bold">Urlaub beantragen</h3></div>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs uppercase font-bold text-white/50 mb-1 block">Erster Urlaubstag</label>
                                <div onClick={() => setShowStartPicker(true)} className="flex items-center justify-between w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white cursor-pointer hover:bg-white/10">
                                    <span>{reqStart ? new Date(reqStart).toLocaleDateString('de-DE') : 'Bitte wählen...'}</span>
                                    <Calendar size={18} className="text-white/50" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs uppercase font-bold text-white/50 mb-1 block">Letzter Urlaubstag</label>
                                <div onClick={() => setShowEndPicker(true)} className="flex items-center justify-between w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white cursor-pointer hover:bg-white/10">
                                    <span>{reqEnd ? new Date(reqEnd).toLocaleDateString('de-DE') : 'Bitte wählen...'}</span>
                                    <Calendar size={18} className="text-white/50" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs uppercase font-bold text-white/50 mb-1 block">Bemerkung (Optional)</label>
                                <GlassInput
                                    value={reqNote}
                                    onChange={(e) => setReqNote(e.target.value)}
                                    placeholder="z.B. Sommerurlaub"
                                />
                            </div>
                            <GlassButton onClick={handleCreateRequest} className="w-full mt-2 bg-purple-500/20 hover:bg-purple-500/40 border-purple-500/30 text-purple-200">
                                Antrag senden
                            </GlassButton>
                        </div>
                    </GlassCard>
                </div>
            )}

            {showStartPicker && (
                <GlassDatePicker
                    value={reqStart}
                    onChange={(d) => { setReqStart(d); if (!reqEnd) setReqEnd(d); setShowStartPicker(false); }}
                    onClose={() => setShowStartPicker(false)}
                />
            )}
            {showEndPicker && (
                <GlassDatePicker
                    value={reqEnd}
                    onChange={(d) => { setReqEnd(d); setShowEndPicker(false); }}
                    onClose={() => setShowEndPicker(false)}
                />
            )}
        </div>
    );
};

export default AnalysisPage;
