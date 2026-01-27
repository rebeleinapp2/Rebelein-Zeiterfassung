import React, { useEffect, useState, useMemo } from 'react';
import { useOfficeService, getLocalISOString, useDepartments } from '../services/dataService';
import { supabase } from '../services/supabaseClient';
import { GlassCard, GlassInput } from '../components/GlassCard';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CheckCircle, AlertTriangle, CalendarClock, Shield, X, Save, Edit2, Clock, StickyNote, Briefcase, FileDown, Palmtree, Power, ChevronDown, ChevronUp, Settings2 } from 'lucide-react';
import { TimeEntry, UserSettings, UserAbsence, Department } from '../types';
import BatchExportModal from '../components/BatchExportModal';

const OfficeUserListPage: React.FC = () => {
    const { users, fetchAllUsers, updateOfficeUserSettings } = useOfficeService();
    const { departments, updateDepartment } = useDepartments();
    const navigate = useNavigate();

    const [selectedDate, setSelectedDate] = useState(new Date());
    const [monthlyEntries, setMonthlyEntries] = useState<TimeEntry[]>([]);
    const [monthlyAbsences, setMonthlyAbsences] = useState<UserAbsence[]>([]);
    const [pendingRequests, setPendingRequests] = useState<any[]>([]); // Vacation Requests
    const [loadingStats, setLoadingStats] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);

    // Review Modal State
    const [reviewingUser, setReviewingUser] = useState<UserSettings | null>(null);
    const [entriesToReview, setEntriesToReview] = useState<TimeEntry[]>([]);

    // Inline Edit State inside Modal
    const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<{ hours: string, note: string, start: string, end: string, reason: string }>({ hours: '', note: '', start: '', end: '', reason: '' });

    // UI Configuration State
    const [isDeptMgmtOpen, setIsDeptMgmtOpen] = useState(false);
    const [openGroups, setOpenGroups] = useState<string[]>([]);

    // Initial Load Users
    useEffect(() => {
        fetchAllUsers();
    }, []);

    // Current User Role Check
    const [currentUser, setCurrentUser] = useState<UserSettings | null>(null);
    useEffect(() => {
        const checkUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user && users.length > 0) {
                const found = users.find(u => u.user_id === user.id);
                if (found) setCurrentUser(found);
            }
        };
        checkUser();
    }, [users]);

    // Sync UI Preferences
    useEffect(() => {
        if (currentUser?.preferences?.visible_dashboard_groups) {
            setOpenGroups(currentUser.preferences.visible_dashboard_groups);
        } else if (departments.length > 0 && openGroups.length === 0) {
            // Default: All Open if no preference
            setOpenGroups([...departments.map(d => d.id), 'unassigned']);
        }
    }, [currentUser, departments]);

    const toggleGroup = (groupId: string) => {
        const newGroups = openGroups.includes(groupId)
            ? openGroups.filter(g => g !== groupId)
            : [...openGroups, groupId];
        setOpenGroups(newGroups);

        if (currentUser && currentUser.user_id) {
            updateOfficeUserSettings(currentUser.user_id, {
                preferences: { ...currentUser.preferences, visible_dashboard_groups: newGroups }
            });
        }
    };

    // Permissions
    const isAdmin = currentUser?.role === 'admin';

    // Check which departments the current user is responsible for
    const responsibleDepartments = useMemo(() => {
        if (!currentUser || !currentUser.user_id) return [];
        return departments.filter(d =>
            d.responsible_user_id === currentUser.user_id ||
            (d.additional_responsible_ids && currentUser.user_id && d.additional_responsible_ids.includes(currentUser.user_id))
        );
    }, [departments, currentUser]);

    // Check which departments the current user is active substitute for
    const activeSubstituteDepartments = useMemo(() => {
        if (!currentUser) return [];
        return departments.filter(d => d.substitute_user_id === currentUser.user_id && d.is_substitute_active);
    }, [departments, currentUser]);

    // VIEWABLE USERS LOGIC
    const viewableUserIds = useMemo(() => {
        if (!currentUser) return [];
        // Admin AND Office see ALL users now (Rule Change)
        // But we will use 'responsibleDepartments' to gray out others later
        if (isAdmin || currentUser.role === 'office') return users.map(u => u.user_id);

        // Fallback for other roles (e.g. if we had sub-managers)
        const deptIds = new Set<string>();
        responsibleDepartments.forEach(d => deptIds.add(d.id));
        activeSubstituteDepartments.forEach(d => deptIds.add(d.id));

        if (deptIds.size === 0) return []; // No rights

        return users.filter(u => u.department_id && deptIds.has(u.department_id)).map(u => u.user_id);
    }, [currentUser, isAdmin, users, responsibleDepartments, activeSubstituteDepartments]);



    // Load Entries when Date or Users change
    const fetchMonthData = async () => {
        setLoadingStats(true);
        const year = selectedDate.getFullYear();
        const month = selectedDate.getMonth();

        // First day of month
        const startDate = new Date(year, month, 1);
        // Last day of month
        const endDate = new Date(year, month + 1, 0);

        // Format YYYY-MM-DD for Supabase
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        // 1. Fetch Time Entries
        const { data: entriesData, error: entriesError } = await supabase
            .from('time_entries')
            .select('*')
            .gte('date', startStr)
            .lte('date', endStr);

        if (entriesError) {
            console.error("Error fetching dashboard data:", entriesError);
        } else {
            setMonthlyEntries(entriesData as TimeEntry[]);
        }

        // 2. Fetch Absences
        const { data: absencesData, error: absencesError } = await supabase
            .from('user_absences')
            .select('*');

        if (absencesError) {
            console.error("Error fetching absences:", absencesError);
        } else {
            setMonthlyAbsences(absencesData as UserAbsence[]);
        }

        // 3. Fetch Pending Vacation Requests (ALL)
        const { data: requestsData, error: requestsError } = await supabase
            .from('vacation_requests')
            .select('*')
            .eq('status', 'pending');

        if (requestsError) {
            console.error("Error fetching vacation requests:", requestsError);
        } else {
            setPendingRequests(requestsData || []);
        }

        setLoadingStats(false);
    };

    useEffect(() => {
        fetchMonthData();

        // REALTIME SUBSCRIPTION FOR DASHBOARD
        // We listen to ANY changes in time_entries, user_absences AND vacation_requests
        const entriesChannel = supabase
            .channel('dashboard_entries')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries' }, () => {
                fetchMonthData();
            })
            .subscribe();

        const absencesChannel = supabase
            .channel('dashboard_absences')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'user_absences' }, () => {
                fetchMonthData();
            })
            .subscribe();

        const requestsChannel = supabase
            .channel('dashboard_requests')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'vacation_requests' }, () => {
                fetchMonthData();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(entriesChannel);
            supabase.removeChannel(absencesChannel);
            supabase.removeChannel(requestsChannel);
        };
    }, [selectedDate, users.length]);

    // --- Actions ---

    const handleOpenReview = (e: React.MouseEvent, user: UserSettings, pendingEntries: TimeEntry[]) => {
        e.stopPropagation(); // Prevent navigation to user page
        setReviewingUser(user);
        setEntriesToReview(pendingEntries);
    };

    const handleConfirmEntry = async (entryId: string) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { error } = await supabase.from('time_entries').update({
            confirmed_by: user.id,
            confirmed_at: new Date().toISOString()
        }).eq('id', entryId);

        if (!error) {
            // Update Local State (also handled by realtime, but this makes UI snappy)
            setMonthlyEntries(prev => prev.map(e => e.id === entryId ? { ...e, confirmed_at: new Date().toISOString() } : e));
            setEntriesToReview(prev => prev.filter(e => e.id !== entryId));

            // Close modal if empty
            if (entriesToReview.length <= 1) {
                setReviewingUser(null);
            }
        }
    };

    const handleEditClick = (entry: TimeEntry) => {
        setEditingEntryId(entry.id);
        setEditForm({
            hours: entry.hours.toString(),
            note: entry.note || '',
            start: entry.start_time || '',
            end: entry.end_time || '',
            reason: '' // Reset reason
        });
    };

    const handleSaveEdit = async (entryId: string) => {
        // Enforce Reason for Admins/Office (Assuming this dashboard IS for office/admin)
        if (!editForm.reason || editForm.reason.trim() === '') {
            alert("Bitte geben Sie einen Änderungsgrund an.");
            return;
        }

        const { data: { user } } = await supabase.auth.getUser();

        const updates = {
            hours: parseFloat(editForm.hours.replace(',', '.')),
            note: editForm.note || null,
            start_time: editForm.start || null,
            end_time: editForm.end || null,
            // Tracking Fields
            last_changed_by: user?.id,
            change_reason: editForm.reason,
            change_confirmed_by_user: false,
            updated_at: new Date().toISOString()
        };

        const { error } = await supabase.from('time_entries').update(updates).eq('id', entryId);

        if (!error) {
            setMonthlyEntries(prev => prev.map(e => e.id === entryId ? {
                ...e,
                hours: parseFloat(editForm.hours.replace(',', '.')),
                note: editForm.note || undefined,
                start_time: editForm.start || undefined,
                end_time: editForm.end || undefined
            } : e));

            setEntriesToReview(prev => prev.map(e => e.id === entryId ? {
                ...e,
                hours: parseFloat(editForm.hours.replace(',', '.')),
                note: editForm.note || undefined,
                start_time: editForm.start || undefined,
                end_time: editForm.end || undefined
            } : e));

            setEditingEntryId(null);
        }
    };

    // --- Helpers ---

    const prevMonth = () => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1));
    const nextMonth = () => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1));

    const getDaysInMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

    // Calculate Stats per User
    const getUserStats = (user: UserSettings) => {
        const userEntries = monthlyEntries.filter(e => e.user_id === user.user_id);
        const employmentStart = user.employment_start_date ? new Date(user.employment_start_date) : null;

        // 1. Project Hours (Real Work) - Exclude Absences/Special Types represented as entries
        const specialTypes = ['vacation', 'sick', 'holiday', 'special_holiday', 'sick_child', 'sick_pay', 'unpaid'];
        const projectHours = userEntries
            .filter(e => {
                const d = new Date(e.date);
                if (employmentStart && d < employmentStart) return false;
                return e.type !== 'break' && !specialTypes.includes(e.type || '');
            })
            .reduce((sum, e) => sum + e.hours, 0);

        let creditHours = 0;
        let targetHours = 0;

        // Helper to check absence for a specific date
        const getAbsenceForDate = (dateStr: string) => {
            return monthlyAbsences.find(a =>
                a.user_id === user.user_id &&
                dateStr >= a.start_date &&
                dateStr <= a.end_date
            );
        };

        const daysInMonth = getDaysInMonth(selectedDate);

        for (let d = 1; d <= daysInMonth; d++) {
            const tempDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), d);
            const dateStr = getLocalISOString(tempDate);

            // Employment Start Check
            if (employmentStart && tempDate < employmentStart) {
                continue;
            }

            const dayOfWeek = tempDate.getDay(); // 0 = Sun
            const dailyTarget = user.target_hours[dayOfWeek as keyof typeof user.target_hours] || 0;

            const absence = getAbsenceForDate(dateStr);
            const entry = userEntries.find(e => e.date === dateStr);

            // 1. UNPAID LOGIC (Absence OR Entry)
            const isUnpaidAbsence = absence && ['unpaid', 'sick_child', 'sick_pay'].includes(absence.type);
            const isUnpaidEntry = entry && ['unpaid', 'sick_child', 'sick_pay'].includes(entry.type || '');

            if (isUnpaidAbsence || isUnpaidEntry) {
                // Treated as Unpaid
            } else {
                // 2. Add Target
                targetHours += dailyTarget;

                // 3. CREDIT LOGIC (Paid Absence OR Paid Entry)
                const isPaidAbsence = absence && ['vacation', 'sick', 'holiday'].includes(absence.type);
                const isPaidEntry = entry && ['vacation', 'sick', 'holiday', 'special_holiday'].includes(entry.type || '');

                if (isPaidAbsence || isPaidEntry) {
                    if (dailyTarget > 0) creditHours += dailyTarget;
                }
            }
        }

        const actualHours = projectHours + creditHours;

        // 3. Pending Confirmations
        const confirmationTypes = ['company', 'office', 'warehouse', 'car', 'overtime_reduction'];
        const pendingEntries = userEntries.filter(e =>
            (confirmationTypes.includes(e.type || '') || e.late_reason) && !e.confirmed_at
        );
        const pendingCount = pendingEntries.length;

        // 4. Pending Vacation Requests
        const userPendingRequests = pendingRequests.filter(r => r.user_id === user.user_id);
        const pendingRequestsCount = userPendingRequests.length;

        // 5. Last Submitted Date (Entry OR Absence OR Special Holiday)
        // Treat special_holiday as implicitly submitted for display purposes
        const submittedEntries = userEntries.filter(e => e.submitted || e.type === 'special_holiday');
        let maxDateStr = submittedEntries.length > 0
            ? submittedEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0].date
            : null;

        // Check Absences covering the end of the month
        const monthStartStr = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1).toISOString().split('T')[0];
        const monthEndStr = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).toISOString().split('T')[0];

        const userAbsences = monthlyAbsences.filter(a => a.user_id === user.user_id);
        for (const abs of userAbsences) {
            if (abs.end_date >= monthStartStr && abs.start_date <= monthEndStr) {
                const effectiveEnd = abs.end_date > monthEndStr ? monthEndStr : abs.end_date;
                if (!maxDateStr || effectiveEnd > maxDateStr) {
                    maxDateStr = effectiveEnd;
                }
            }
        }

        const lastSubmittedDate = maxDateStr
            ? new Date(maxDateStr).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
            : null;

        return { actualHours, targetHours, pendingCount, pendingEntries, pendingRequestsCount, lastSubmittedDate };
    };

    // Sort users & FILTER VIEW
    const sortedUsers = useMemo(() => {
        // Filter by permissions
        const visibleUsers = users.filter(u => viewableUserIds.includes(u.user_id));

        return [...visibleUsers].sort((a, b) => {
            const statsA = getUserStats(a);
            const statsB = getUserStats(b);

            // Prioritize Vacation Requests then Pending Entries
            if (statsA.pendingRequestsCount !== statsB.pendingRequestsCount) {
                return statsB.pendingRequestsCount - statsA.pendingRequestsCount;
            }
            if (statsA.pendingCount !== statsB.pendingCount) {
                return statsB.pendingCount - statsA.pendingCount; // High pending first
            }
            return a.display_name.localeCompare(b.display_name);
        });
    }, [users, monthlyEntries, monthlyAbsences, pendingRequests]);

    return (
        <div className="p-6 h-full overflow-y-auto md:max-w-7xl md:mx-auto w-full pb-24">

            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-200 to-emerald-400">
                        Mitarbeiter Übersicht
                    </h1>
                    <p className="text-white/50 text-sm mt-1">Status & Leistungen aller Mitarbeiter</p>
                </div>

                {/* Controls Group */}
                <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
                    {/* Department Toggle */}
                    {(isAdmin || responsibleDepartments.length > 0) && (
                        <button
                            onClick={() => setIsDeptMgmtOpen(!isDeptMgmtOpen)}
                            className={`flex items-center justify-center gap-2 border rounded-xl px-4 py-2 font-medium transition-colors ${isDeptMgmtOpen
                                ? 'bg-teal-500/20 text-teal-300 border-teal-500/30'
                                : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white'
                                }`}
                        >
                            <Settings2 size={20} />
                            <span>Verwaltung</span>
                        </button>
                    )}

                    {/* Export Button */}
                    <button
                        onClick={() => setShowExportModal(true)}
                        className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-4 py-2 text-white font-medium transition-colors"
                    >
                        <FileDown size={20} className="text-teal-400" />
                        <span>Export</span>
                    </button>

                    {/* Month Selector */}
                    <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl p-1 backdrop-blur-md w-full md:w-auto min-w-[250px]">
                        <button onClick={prevMonth} className="p-2 hover:bg-white/10 rounded-lg text-white transition-colors">
                            <ChevronLeft size={20} />
                        </button>
                        <span className="font-bold text-white text-lg">
                            {selectedDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
                        </span>
                        <button onClick={nextMonth} className="p-2 hover:bg-white/10 rounded-lg text-white transition-colors">
                            <ChevronRight size={20} />
                        </button>
                    </div>
                </div>
            </div>

            {/* DEPARTMENT MANAGEMENT (Admin & Responsible) */}
            {(isAdmin || responsibleDepartments.length > 0) && isDeptMgmtOpen && (
                <div className="mb-8 animate-in slide-in-from-top-4">
                    <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                        <Briefcase size={20} className="text-teal-400" /> Abteilungs-Verwaltung
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {departments.map(dept => {
                            const isResponsible = dept.responsible_user_id === currentUser?.user_id;

                            // Permission Split:
                            // 1. Substitute Management: Admin OR Responsible User
                            const canManageSubstitute = isAdmin || isResponsible;
                            // 2. Retroactive Settings: Admin ONLY
                            const canManageRetro = isAdmin;

                            // canEdit is deprecated/ambiguous, we use specific flags now.
                            // But we keep the loop filter:
                            if (!isAdmin && !isResponsible) return null;

                            return (
                                <GlassCard key={dept.id} className="!p-0 flex flex-col overflow-hidden border-teal-500/20 bg-teal-900/10 h-full">
                                    {/* Card Header */}
                                    <div className="bg-white/5 px-4 py-3 border-b border-white/10 flex items-center justify-between">
                                        <div className="font-bold text-teal-300 uppercase tracking-wider text-sm flex items-center gap-2">
                                            <Briefcase size={14} />
                                            {dept.label}
                                        </div>
                                        {/* Status Indicators (Mini dots) */}
                                        <div className="flex gap-1.5">
                                            <div className={`w-2 h-2 rounded-full ${dept.is_substitute_active ? 'bg-teal-500 shadow-[0_0_8px_rgba(20,184,166,0.6)]' : 'bg-white/10'}`} title="Vertretung Status" />
                                            <div className={`w-2 h-2 rounded-full ${dept.is_retro_substitute_active ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)]' : 'bg-white/10'}`} title="Rückwirkend Status" />
                                        </div>
                                    </div>

                                    <div className="p-4 space-y-6 flex-1 flex flex-col">

                                        {/* SECTION 1: MAIN RESPONSIBILITY */}
                                        <div className="space-y-3">
                                            <div>
                                                <label className="text-[10px] text-white/50 uppercase font-bold block mb-1.5 pl-1">Haupt-Zuständigkeit</label>
                                                {isAdmin ? (
                                                    <div className="relative">
                                                        <select
                                                            className="w-full bg-slate-950/40 text-white text-sm rounded-lg border border-white/10 px-3 py-2.5 focus:border-teal-500 focus:bg-slate-950/60 outline-none appearance-none cursor-pointer transition-colors"
                                                            value={dept.responsible_user_id || ''}
                                                            onChange={(e) => updateDepartment(dept.id, { responsible_user_id: e.target.value })}
                                                        >
                                                            <option value="" className="bg-slate-900 text-slate-300">- Wählen -</option>
                                                            {users.map(u => (
                                                                <option key={u.user_id} value={u.user_id} className="bg-slate-900 text-slate-200">{u.display_name}</option>
                                                            ))}
                                                        </select>
                                                        <ChevronDown size={14} className="absolute right-3 top-3 text-white/30 pointer-events-none" />
                                                    </div>
                                                ) : (
                                                    <div className="text-sm text-white font-medium bg-white/5 px-3 py-2.5 rounded-lg border border-white/5">
                                                        {users.find(u => u.user_id === dept.responsible_user_id)?.display_name || '-'}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Additional Responsible Users */}
                                            <div>
                                                <label className="text-[10px] text-teal-300/50 uppercase font-bold block mb-1.5 pl-1">Weitere Zuständige</label>
                                                <div className="bg-black/20 rounded-lg p-2 border border-white/5 space-y-2">
                                                    {isAdmin ? (
                                                        <>
                                                            <div className="flex flex-wrap gap-2">
                                                                {(dept.additional_responsible_ids || []).map(id => {
                                                                    const user = users.find(u => u.user_id === id);
                                                                    return (
                                                                        <div key={id} className="flex items-center gap-1.5 bg-teal-500/10 text-teal-200 pl-2 pr-1 py-1 rounded text-xs border border-teal-500/20">
                                                                            <span>{user?.display_name || 'Unbekannt'}</span>
                                                                            <button
                                                                                onClick={() => {
                                                                                    const newIds = (dept.additional_responsible_ids || []).filter(existingId => existingId !== id);
                                                                                    updateDepartment(dept.id, { additional_responsible_ids: newIds });
                                                                                }}
                                                                                className="hover:bg-teal-500/20 rounded p-0.5 text-teal-400 hover:text-white transition-colors"
                                                                            >
                                                                                <X size={12} />
                                                                            </button>
                                                                        </div>
                                                                    );
                                                                })}
                                                                {(dept.additional_responsible_ids || []).length === 0 && (
                                                                    <span className="text-white/20 text-xs italic px-1 py-0.5">Keine weiteren Zuständigen</span>
                                                                )}
                                                            </div>
                                                            <div className="relative mt-2">
                                                                <select
                                                                    className="w-full bg-slate-950/30 text-teal-100/70 text-xs rounded border border-teal-500/10 px-2 py-1.5 focus:border-teal-500/50 outline-none appearance-none cursor-pointer hover:bg-slate-900/50 transition-colors"
                                                                    value=""
                                                                    onChange={(e) => {
                                                                        const idToAdd = e.target.value;
                                                                        if (!idToAdd) return;
                                                                        const currentIds = dept.additional_responsible_ids || [];
                                                                        if (!currentIds.includes(idToAdd)) {
                                                                            updateDepartment(dept.id, { additional_responsible_ids: [...currentIds, idToAdd] });
                                                                        }
                                                                    }}
                                                                >
                                                                    <option value="" className="bg-slate-900 text-slate-400">+ Hinzufügen</option>
                                                                    {users
                                                                        .filter(u => u.user_id && u.user_id !== dept.responsible_user_id && !(dept.additional_responsible_ids || []).includes(u.user_id))
                                                                        .map(u => (
                                                                            <option key={u.user_id} value={u.user_id} className="bg-slate-900 text-slate-200">{u.display_name}</option>
                                                                        ))}
                                                                </select>
                                                                <ChevronDown size={12} className="absolute right-2 top-2 text-teal-100/30 pointer-events-none" />
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="text-xs text-white/80 font-medium flex flex-wrap gap-2">
                                                            {(dept.additional_responsible_ids || []).length > 0 ? (
                                                                (dept.additional_responsible_ids || []).map(id => (
                                                                    <span key={id} className="bg-white/10 px-2 py-1 rounded text-xs border border-white/5">
                                                                        {users.find(u => u.user_id === id)?.display_name || '-'}
                                                                    </span>
                                                                ))
                                                            ) : (
                                                                <span className="text-white/30 italic px-1">- Keine -</span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                                        {/* SECTION 2: VERTRETUNG */}
                                        <div className="bg-teal-500/5 rounded-xl p-3 border border-teal-500/10 space-y-3">
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="text-[10px] text-teal-200/70 uppercase font-bold flex items-center gap-1.5">
                                                    <Shield size={10} /> Vertretung (Aktuell)
                                                </label>
                                                {/* Active Switch */}
                                                {canManageSubstitute && (
                                                    <button
                                                        onClick={() => updateDepartment(dept.id, { is_substitute_active: !dept.is_substitute_active })}
                                                        className={`flex items-center gap-2 px-2 py-1 rounded-full text-[10px] font-bold transition-all border ${dept.is_substitute_active
                                                            ? 'bg-teal-500/20 text-teal-300 border-teal-500/30 hover:bg-teal-500/30'
                                                            : 'bg-white/5 text-white/40 border-white/5 hover:bg-white/10'}`}
                                                    >
                                                        <span>{dept.is_substitute_active ? 'AKTIV' : 'INAKTIV'}</span>
                                                        <div className={`w-2 h-2 rounded-full ${dept.is_substitute_active ? 'bg-teal-400 shadow-[0_0_5px_currentColor]' : 'bg-white/20'}`} />
                                                    </button>
                                                )}
                                            </div>

                                            {canManageSubstitute ? (
                                                <div className="relative">
                                                    <select
                                                        className="w-full bg-slate-950/40 text-white text-xs rounded-lg border border-teal-500/10 px-2 py-2 focus:border-teal-500 focus:bg-slate-950/60 outline-none appearance-none cursor-pointer transition-colors"
                                                        value={dept.substitute_user_id || ''}
                                                        onChange={(e) => updateDepartment(dept.id, { substitute_user_id: e.target.value })}
                                                    >
                                                        <option value="" className="bg-slate-900 text-slate-300">- Keine Vertretung -</option>
                                                        {users.map(u => (
                                                            <option key={u.user_id} value={u.user_id} className="bg-slate-900 text-slate-200">{u.display_name}</option>
                                                        ))}
                                                    </select>
                                                    <ChevronDown size={12} className="absolute right-2.5 top-2.5 text-white/30 pointer-events-none" />
                                                </div>
                                            ) : (
                                                <div className="text-xs text-white bg-black/20 px-2 py-2 rounded-lg border border-white/5">
                                                    {users.find(u => u.user_id === dept.substitute_user_id)?.display_name || <span className="text-white/30 italic">- Keine -</span>}
                                                </div>
                                            )}
                                        </div>

                                        {/* SECTION 3: RÜCKWIRKEND */}
                                        <div className="bg-orange-500/5 rounded-xl p-3 border border-orange-500/10 space-y-3 mt-auto">
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="text-[10px] text-orange-200/70 uppercase font-bold flex items-center gap-1.5">
                                                    <Clock size={10} /> Rückwirkend
                                                </label>
                                                {canManageRetro && (
                                                    <button
                                                        onClick={() => updateDepartment(dept.id, { is_retro_substitute_active: !dept.is_retro_substitute_active })}
                                                        className={`flex items-center gap-2 px-2 py-1 rounded-full text-[10px] font-bold transition-all border ${dept.is_retro_substitute_active
                                                            ? 'bg-orange-500/20 text-orange-300 border-orange-500/30 hover:bg-orange-500/30'
                                                            : 'bg-white/5 text-white/40 border-white/5 hover:bg-white/10'}`}
                                                    >
                                                        <span>{dept.is_retro_substitute_active ? 'AKTIV' : 'INAKTIV'}</span>
                                                        <div className={`w-2 h-2 rounded-full ${dept.is_retro_substitute_active ? 'bg-orange-400 shadow-[0_0_5px_currentColor]' : 'bg-white/20'}`} />
                                                    </button>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-2 gap-2">
                                                {/* Chef Retro */}
                                                <div>
                                                    <label className="text-[9px] text-white/30 uppercase font-bold block mb-1 ml-1">Chef</label>
                                                    {canManageRetro ? (
                                                        <div className="relative">
                                                            <select
                                                                className="w-full bg-slate-950/40 text-orange-100 text-[11px] rounded-lg border border-orange-500/10 p-1.5 focus:border-orange-500/50 outline-none appearance-none cursor-pointer"
                                                                value={dept.retro_responsible_user_id || ''}
                                                                onChange={(e) => updateDepartment(dept.id, { retro_responsible_user_id: e.target.value })}
                                                            >
                                                                <option value="" className="bg-slate-900 text-slate-400">Standard</option>
                                                                {users.map(u => (
                                                                    <option key={u.user_id} value={u.user_id} className="bg-slate-900 text-slate-200">{u.display_name}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    ) : (
                                                        <div className="text-[11px] text-orange-200 bg-black/20 p-1.5 rounded-lg border border-white/5 truncate">
                                                            {users.find(u => u.user_id === dept.retro_responsible_user_id)?.display_name || '(Std)'}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Substitute Retro */}
                                                <div>
                                                    <label className="text-[9px] text-white/30 uppercase font-bold block mb-1 ml-1">Vertr.</label>
                                                    {canManageRetro ? (
                                                        <div className="relative">
                                                            <select
                                                                className="w-full bg-slate-950/40 text-orange-100 text-[11px] rounded-lg border border-orange-500/10 p-1.5 focus:border-orange-500/50 outline-none appearance-none cursor-pointer"
                                                                value={dept.retro_substitute_user_id || ''}
                                                                onChange={(e) => updateDepartment(dept.id, { retro_substitute_user_id: e.target.value })}
                                                            >
                                                                <option value="" className="bg-slate-900 text-slate-400">Standard</option>
                                                                {users.map(u => (
                                                                    <option key={u.user_id} value={u.user_id} className="bg-slate-900 text-slate-200">{u.display_name}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    ) : (
                                                        <div className="text-[11px] text-orange-200 bg-black/20 p-1.5 rounded-lg border border-white/5 truncate">
                                                            {users.find(u => u.user_id === dept.retro_substitute_user_id)?.display_name || '(Std)'}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                    </div>
                                </GlassCard>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Content Grid */}
            {loadingStats ? (
                <div className="flex justify-center items-center h-40">
                    <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            ) : (
                <div className="space-y-8 pb-12">
                    {[...departments, { id: 'unassigned', label: 'Nicht zugewiesen' } as Department].map(dept => {
                        const deptUsers = sortedUsers.filter(u => {
                            if (dept.id === 'unassigned') return !u.department_id;
                            return u.department_id === dept.id;
                        });

                        if (deptUsers.length === 0) return null;
                        const isOpen = openGroups.includes(dept.id);

                        return (
                            <div key={dept.id} className="animate-in fade-in slide-in-from-bottom-4">
                                {/* Group Header */}
                                <div
                                    onClick={() => toggleGroup(dept.id)}
                                    className="flex items-center gap-3 mb-4 cursor-pointer group select-none"
                                >
                                    <div className={`p-2 rounded-lg transition-colors ${isOpen ? 'bg-teal-500/20 text-teal-400' : 'bg-white/5 text-white/50 group-hover:bg-white/10 group-hover:text-white'}`}>
                                        {isOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                    </div>
                                    <span className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60 group-hover:to-teal-200 transition-all">
                                        {dept.label}
                                    </span>
                                    <span className="text-xs font-bold text-white/30 bg-white/5 px-2 py-0.5 rounded-full">
                                        {deptUsers.length}
                                    </span>
                                    <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent ml-4" />
                                </div>

                                {isOpen && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                        {deptUsers.map(user => {
                                            const stats = getUserStats(user);
                                            const progressPercent = Math.min(100, (stats.actualHours / (stats.targetHours || 1)) * 100);
                                            const isInstaller = user.role === 'installer';

                                            const isResponsibleForUser = isAdmin || responsibleDepartments.some(d => d.id === user.department_id) || activeSubstituteDepartments.some(d => d.id === user.department_id) || user.department_id === null; // Admins handle unassigned too usually

                                            // Opacity Logic: 
                                            // - Full Opacity if Responsible OR Admin
                                            // - Reduced Opacity (0.5) if Office view but not responsible
                                            const cardOpacity = isResponsibleForUser ? 'opacity-100' : 'opacity-50 hover:opacity-100';

                                            return (
                                                <GlassCard
                                                    key={user.user_id}
                                                    onClick={() => navigate(`/office/user/${user.user_id}`)}
                                                    className={`group cursor-pointer hover:border-teal-500/30 transition-all duration-300 relative overflow-hidden flex flex-col pt-4 ${cardOpacity}`}
                                                >
                                                    {/* Card Header (Dept & Role) */}
                                                    <div className="flex justify-between items-start mb-4 relative z-10">
                                                        {/* Department Dropdown (Admin Only) */}
                                                        <div onClick={e => e.stopPropagation()}>
                                                            {isAdmin && (
                                                                <select
                                                                    className="bg-black/40 text-white/70 hover:text-white text-[10px] rounded border border-white/10 p-1 backdrop-blur-sm outline-none focus:border-teal-500 uppercase font-bold tracking-wider max-w-[100px]"
                                                                    value={user.department_id || ''}
                                                                    onChange={(e) => updateOfficeUserSettings(user.user_id!, { department_id: e.target.value })}
                                                                    title="Abteilung zuweisen"
                                                                >
                                                                    <option value="">- Abt. -</option>
                                                                    {departments.map(d => (
                                                                        <option key={d.id} value={d.id}>{d.label}</option>
                                                                    ))}
                                                                </select>
                                                            )}
                                                        </div>

                                                        {/* Role & Actions */}
                                                        <div className="flex items-center gap-2">
                                                            {isInstaller ? (
                                                                <span className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider">Monteur</span>
                                                            ) : (
                                                                <span className="bg-blue-500/10 text-blue-300 border border-blue-500/20 text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider flex items-center gap-1">
                                                                    <Shield size={10} /> {user.role}
                                                                </span>
                                                            )}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (confirm(`Möchten Sie den Benutzer ${user.display_name} wirklich ${user.is_active === false ? 'aktivieren' : 'deaktivieren'}?`)) {
                                                                        updateOfficeUserSettings(user.user_id!, { is_active: user.is_active === false ? true : false });
                                                                    }
                                                                }}
                                                                className={`p-1.5 rounded-full transition-colors order-last ${user.is_active === false
                                                                    ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/30'
                                                                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30'
                                                                    }`}
                                                                title={user.is_active === false ? "Benutzer ist deaktiviert. Klicken zum Aktivieren." : "Benutzer ist aktiv. Klicken zum Deaktivieren."}
                                                            >
                                                                <Power size={14} />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-4 mb-6">
                                                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 border border-white/10 flex items-center justify-center text-xl font-bold text-white shadow-lg group-hover:scale-105 transition-transform">
                                                            {user.display_name.charAt(0)}
                                                        </div>
                                                        <div>
                                                            <h3 className="font-bold text-white text-lg leading-tight">{user.display_name}</h3>
                                                            <div className="flex items-center gap-2 mt-1">
                                                                {stats.lastSubmittedDate ? (
                                                                    <span className="text-xs text-emerald-400 flex items-center gap-1 bg-emerald-900/20 px-1.5 py-0.5 rounded">
                                                                        <CheckCircle size={10} /> Abgabe: {stats.lastSubmittedDate}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-xs text-white/30 flex items-center gap-1">
                                                                        <CalendarClock size={10} /> Keine Abgabe
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* PENDING VACATION REQUEST ALERT */}
                                                    {stats.pendingRequestsCount > 0 && (
                                                        <div className="mb-4 bg-purple-500/10 border border-purple-500/30 rounded-lg p-2 flex items-center justify-between animate-pulse">
                                                            <div className="flex items-center gap-2 text-purple-300">
                                                                <Palmtree size={16} />
                                                                <span className="text-xs font-bold uppercase tracking-wide">
                                                                    {stats.pendingRequestsCount} Urlaubsantrag
                                                                </span>
                                                            </div>
                                                            <ChevronRight size={16} className="text-purple-300" />
                                                        </div>
                                                    )}

                                                    {/* Progress Section */}
                                                    <div className="mb-6">
                                                        {selectedDate.getMonth() === 11 ? (
                                                            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                                                                <p className="text-xs text-blue-200 text-center leading-relaxed">
                                                                    Aufgrund des Sonderurlaubs ist die Darstellung des Monatsziels für den Dezember ausgeblendet.
                                                                </p>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <div className="flex justify-between items-end mb-2">
                                                                    <span className="text-xs text-white/50 font-bold uppercase tracking-wider">Monatsziel</span>
                                                                    <div className="text-right">
                                                                        <span className={`font-mono font-bold text-lg ${stats.actualHours >= stats.targetHours ? 'text-emerald-300' : 'text-white'}`}>
                                                                            {stats.actualHours.toFixed(1)}
                                                                        </span>
                                                                        <span className="text-white/40 text-sm font-mono"> / {stats.targetHours.toFixed(0)} h</span>
                                                                    </div>
                                                                </div>
                                                                <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                                                                    <div
                                                                        className={`h-full rounded-full transition-all duration-1000 ease-out ${progressPercent >= 100 ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-gradient-to-r from-blue-500 to-cyan-400'
                                                                            }`}
                                                                        style={{ width: `${progressPercent}%` }}
                                                                    />
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>

                                                    {/* Footer Stats / Alerts */}
                                                    <div className="flex items-center justify-between border-t border-white/5 pt-4 mt-auto">
                                                        {stats.pendingCount > 0 ? (
                                                            <div className="w-full space-y-2">
                                                                <div className="flex items-center gap-2 text-orange-400 text-xs font-bold uppercase tracking-wider mb-1">
                                                                    <AlertTriangle size={12} />
                                                                    <span>{stats.pendingCount} Offene Bestätigungen</span>
                                                                </div>
                                                                <div className="flex flex-col gap-1.5">
                                                                    {stats.pendingEntries.slice(0, 3).map(entry => (
                                                                        <div key={entry.id} className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-2 flex items-center justify-between group/entry hover:bg-orange-500/20 transition-colors">
                                                                            <div className="flex flex-col min-w-0 flex-1 mr-2">
                                                                                <div className="flex items-center gap-2 text-[10px] text-orange-200">
                                                                                    <span className="font-mono font-bold whitespace-nowrap">{new Date(entry.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span>
                                                                                    <span className="opacity-50">|</span>
                                                                                    <span className="uppercase font-bold truncate">
                                                                                        {entry.late_reason ? (
                                                                                            <span className="text-amber-400">RÜCKWIRKEND</span>
                                                                                        ) : (
                                                                                            entry.type === 'company' ? 'Firma' : entry.type
                                                                                        )}
                                                                                    </span>
                                                                                    <span className="opacity-50">|</span>
                                                                                    <span className="font-mono font-bold whitespace-nowrap">{entry.hours}h</span>
                                                                                </div>
                                                                                {entry.late_reason && (
                                                                                    <div className="text-[10px] text-amber-300 italic mt-0.5 font-bold truncate" title={entry.late_reason}>
                                                                                        Grund: {entry.late_reason}
                                                                                    </div>
                                                                                )}
                                                                                {entry.note && (
                                                                                    <div className="text-[10px] text-white/50 truncate italic mt-0.5" title={entry.note}>
                                                                                        {entry.note}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    handleConfirmEntry(entry.id);
                                                                                }}
                                                                                className="p-1.5 bg-emerald-500/20 hover:bg-emerald-500 text-emerald-400 hover:text-white rounded transition-colors"
                                                                                title="Bestätigen"
                                                                            >
                                                                                <CheckCircle size={14} />
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                    {stats.pendingCount > 3 && (
                                                                        <button
                                                                            onClick={(e) => handleOpenReview(e, user, stats.pendingEntries)}
                                                                            className="w-full py-1 text-[10px] text-orange-300/70 hover:text-orange-300 hover:bg-orange-500/10 rounded transition-colors"
                                                                        >
                                                                            + {stats.pendingCount - 3} weitere anzeigen
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-2 text-white/30">
                                                                <CheckCircle size={18} />
                                                                <span className="text-sm">Alles erledigt</span>
                                                            </div>
                                                        )}

                                                        <div className="text-xs text-teal-400 font-bold uppercase tracking-wider group-hover:underline">
                                                            Details &rarr;
                                                        </div>
                                                    </div>
                                                </GlassCard>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* QUICK REVIEW MODAL */}
            {reviewingUser && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
                    <GlassCard className="w-full max-w-2xl max-h-[90vh] flex flex-col !p-0 overflow-hidden shadow-2xl border-white/20">
                        {/* Modal Header */}
                        <div className="p-4 bg-gradient-to-r from-gray-900 to-gray-800 border-b border-white/10 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center font-bold text-white shadow-lg">
                                    {reviewingUser.display_name.charAt(0)}
                                </div>
                                <div>
                                    <h3 className="font-bold text-white text-lg">{reviewingUser.display_name}</h3>
                                    <p className="text-orange-300 text-xs font-bold uppercase tracking-wider">
                                        {entriesToReview.length} Bestätigungen offen
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setReviewingUser(null)} className="p-2 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {entriesToReview.map(entry => {
                                const isEditing = editingEntryId === entry.id;
                                const dateObj = new Date(entry.date);

                                return (
                                    <div key={entry.id} className="bg-white/5 border border-white/10 rounded-xl p-3 hover:bg-white/10 transition-colors">
                                        {isEditing ? (
                                            <div className="space-y-3">
                                                <div className="flex justify-between items-center border-b border-white/5 pb-2 mb-2">
                                                    <span className="text-sm font-bold text-white/70">{dateObj.toLocaleDateString('de-DE')}</span>
                                                    <span className="text-xs uppercase font-bold text-teal-400">{entry.type}</span>
                                                </div>
                                                <div className="grid grid-cols-3 gap-2">
                                                    <div>
                                                        <label className="text-[10px] uppercase font-bold text-white/40 block mb-1">Von</label>
                                                        <GlassInput type="time" value={editForm.start} onChange={e => setEditForm({ ...editForm, start: e.target.value })} className="!py-1.5 !text-sm text-center" />
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] uppercase font-bold text-white/40 block mb-1">Bis</label>
                                                        <GlassInput type="time" value={editForm.end} onChange={e => setEditForm({ ...editForm, end: e.target.value })} className="!py-1.5 !text-sm text-center" />
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] uppercase font-bold text-white/40 block mb-1">Stunden</label>
                                                        <GlassInput type="number" value={editForm.hours} onChange={e => setEditForm({ ...editForm, hours: e.target.value })} className="!py-1.5 !text-sm text-center" />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] uppercase font-bold text-white/40 block mb-1">Notiz</label>
                                                    <GlassInput type="text" value={editForm.note} onChange={e => setEditForm({ ...editForm, note: e.target.value })} className="!py-1.5 !text-sm" />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] uppercase font-bold text-orange-400 block mb-1">Änderungsgrund (Pflicht)</label>
                                                    <GlassInput type="text" value={editForm.reason} onChange={e => setEditForm({ ...editForm, reason: e.target.value })} className="!py-1.5 !text-sm border-orange-500/30 bg-orange-500/10 placeholder-orange-300/30" placeholder="Warum wird geändert?" />
                                                </div>
                                                <div className="flex justify-end gap-2 pt-1">
                                                    <button onClick={() => setEditingEntryId(null)} className="px-3 py-1.5 rounded text-xs font-bold text-white/50 hover:text-white hover:bg-white/10">Abbrechen</button>
                                                    <button onClick={() => handleSaveEdit(entry.id)} className="px-3 py-1.5 rounded bg-teal-500 text-white text-xs font-bold flex items-center gap-1 hover:bg-teal-400"><Save size={14} /> Speichern</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex justify-between items-center gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-sm font-bold text-white">{dateObj.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
                                                        <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-white/60 uppercase font-bold">{entry.type === 'company' ? 'Firma' : entry.type === 'car' ? 'Auto' : entry.type === 'office' ? 'Büro' : entry.type === 'overtime_reduction' ? 'Abbau' : 'Lager'}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-xs text-white/50">
                                                        <Clock size={12} />
                                                        <span>{entry.start_time} - {entry.end_time}</span>
                                                        <span className="font-bold text-teal-300">({entry.hours}h)</span>
                                                    </div>
                                                    {entry.note && (
                                                        <div className="flex items-center gap-1 text-[10px] text-white/30 mt-1 truncate">
                                                            <StickyNote size={10} /> {entry.note}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <button onClick={() => handleEditClick(entry)} className="p-2 hover:bg-white/10 rounded-lg text-white/50 hover:text-white transition-colors"><Edit2 size={16} /></button>
                                                    <button onClick={() => handleConfirmEntry(entry.id)} className="p-2 bg-teal-500/20 hover:bg-teal-500/40 text-teal-400 rounded-lg transition-colors" title="Bestätigen">
                                                        <CheckCircle size={20} />
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Modal Footer */}
                        {showExportModal && (
                            <BatchExportModal
                                isOpen={showExportModal}
                                onClose={() => setShowExportModal(false)}
                            />
                        )}
                    </GlassCard>
                </div>
            )}

            {/* EXPORT MODAL (Moved outside of Review Modal) */}
            {showExportModal && (
                <BatchExportModal
                    isOpen={showExportModal}
                    onClose={() => setShowExportModal(false)}
                />
            )}
        </div>
    );
};

export default OfficeUserListPage;
