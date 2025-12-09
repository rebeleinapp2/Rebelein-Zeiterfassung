import React, { useEffect, useState, useMemo } from 'react';
import { useOfficeService } from '../services/dataService';
import { supabase } from '../services/supabaseClient';
import { GlassCard, GlassInput } from '../components/GlassCard';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CheckCircle, AlertTriangle, CalendarClock, Shield, X, Save, Edit2, Clock, StickyNote, Briefcase, FileDown } from 'lucide-react';
import { TimeEntry, UserSettings, UserAbsence } from '../types';
import BatchExportModal from '../components/BatchExportModal';

const OfficeDashboard: React.FC = () => {
    const { users, fetchAllUsers } = useOfficeService();
    const navigate = useNavigate();

    const [selectedDate, setSelectedDate] = useState(new Date());
    const [monthlyEntries, setMonthlyEntries] = useState<TimeEntry[]>([]);
    const [monthlyAbsences, setMonthlyAbsences] = useState<UserAbsence[]>([]);
    const [loadingStats, setLoadingStats] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);

    // Review Modal State
    const [reviewingUser, setReviewingUser] = useState<UserSettings | null>(null);
    const [entriesToReview, setEntriesToReview] = useState<TimeEntry[]>([]);

    // Inline Edit State inside Modal
    const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<{ hours: string, note: string, start: string, end: string }>({ hours: '', note: '', start: '', end: '' });

    // Initial Load Users
    useEffect(() => {
        fetchAllUsers();
    }, []);

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

        setLoadingStats(false);
    };

    useEffect(() => {
        fetchMonthData();

        // REALTIME SUBSCRIPTION FOR DASHBOARD
        // We listen to ANY changes in time_entries and user_absences to update the stats immediately
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

        return () => {
            supabase.removeChannel(entriesChannel);
            supabase.removeChannel(absencesChannel);
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
            end: entry.end_time || ''
        });
    };

    const handleSaveEdit = async (entryId: string) => {
        const { error } = await supabase.from('time_entries').update({
            hours: parseFloat(editForm.hours.replace(',', '.')),
            note: editForm.note || null,
            start_time: editForm.start || null,
            end_time: editForm.end || null
        }).eq('id', entryId);

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

        // 1. Actual Hours (Ist) - Exclude Breaks
        let actualHours = userEntries.reduce((sum, e) => (e.type === 'break' ? sum : sum + e.hours), 0);

        // Helper to check absence for a specific date
        const getAbsenceForDate = (dateStr: string) => {
            return monthlyAbsences.find(a =>
                a.user_id === user.user_id &&
                dateStr >= a.start_date &&
                dateStr <= a.end_date
            );
        };

        // 2. Target Hours (Soll) calculation with Unpaid Logic
        let targetHours = 0;
        const daysInMonth = getDaysInMonth(selectedDate);

        for (let d = 1; d <= daysInMonth; d++) {
            const tempDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), d);
            const dateStr = new Date(tempDate.getTime() - (tempDate.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

            const dayOfWeek = tempDate.getDay(); // 0 = Sun
            const dailyTarget = user.target_hours[dayOfWeek as keyof typeof user.target_hours] || 0;

            const absence = getAbsenceForDate(dateStr);

            // Logic:
            // If Unpaid -> Target does NOT increase. Actual does NOT increase.
            // If Vacation/Sick/Holiday -> Target INCREASES. Actual INCREASES (to fill the bar).

            if (absence && absence.type === 'unpaid') {
                // Do nothing (Target stays same, effectively reduced for the month)
            } else {
                targetHours += dailyTarget;

                // If it's a paid absence, we credit the hours to "Actuals" so the bar fills up
                if (absence && (absence.type === 'vacation' || absence.type === 'sick' || absence.type === 'holiday')) {
                    if (dailyTarget > 0) {
                        actualHours += dailyTarget;
                    }
                }
            }
        }

        // 3. Pending Confirmations (including Overtime Reduction)
        const confirmationTypes = ['company', 'office', 'warehouse', 'car', 'overtime_reduction'];
        const pendingEntries = userEntries.filter(e =>
            confirmationTypes.includes(e.type || '') && !e.confirmed_at
        );
        const pendingCount = pendingEntries.length;

        // 4. Last Submitted Date
        const lastSubmittedEntry = userEntries
            .filter(e => e.submitted)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

        const lastSubmittedDate = lastSubmittedEntry
            ? new Date(lastSubmittedEntry.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
            : null;

        return { actualHours, targetHours, pendingCount, pendingEntries, lastSubmittedDate };
    };

    // Sort users
    const sortedUsers = useMemo(() => {
        return [...users].sort((a, b) => {
            const statsA = getUserStats(a);
            const statsB = getUserStats(b);
            if (statsA.pendingCount !== statsB.pendingCount) {
                return statsB.pendingCount - statsA.pendingCount; // High pending first
            }
            return a.display_name.localeCompare(b.display_name);
        });
    }, [users, monthlyEntries, monthlyAbsences]);

    return (
        <div className="p-6 h-full overflow-y-auto md:max-w-7xl md:mx-auto w-full pb-24">

            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-200 to-emerald-400">
                        Büro Dashboard
                    </h1>
                    <p className="text-white/50 text-sm mt-1">Übersicht aller Mitarbeiter & Leistungen</p>
                </div>

                {/* Controls Group */}
                <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
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

            {/* Content Grid */}
            {loadingStats ? (
                <div className="flex justify-center items-center h-40">
                    <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {sortedUsers.map(user => {
                        const stats = getUserStats(user);
                        const progressPercent = Math.min(100, (stats.actualHours / (stats.targetHours || 1)) * 100);
                        const isInstaller = user.role === 'installer';

                        return (
                            <GlassCard
                                key={user.user_id}
                                onClick={() => navigate(`/office/user/${user.user_id}`)}
                                className="group cursor-pointer hover:border-teal-500/30 transition-all duration-300 relative overflow-hidden flex flex-col"
                            >
                                {/* Role Badge */}
                                <div className="absolute top-4 right-4">
                                    {isInstaller ? (
                                        <span className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider">Monteur</span>
                                    ) : (
                                        <span className="bg-blue-500/10 text-blue-300 border border-blue-500/20 text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider flex items-center gap-1">
                                            <Shield size={10} /> {user.role}
                                        </span>
                                    )}
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

                                {/* Progress Section */}
                                <div className="mb-6">
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
                                </div>

                                {/* Footer Stats / Alerts */}
                                <div className="flex items-center justify-between border-t border-white/5 pt-4 mt-auto">
                                    {stats.pendingCount > 0 ? (
                                        <button
                                            onClick={(e) => handleOpenReview(e, user, stats.pendingEntries)}
                                            className="flex items-center gap-2 text-orange-400 hover:text-orange-300 transition-colors bg-orange-500/10 px-3 py-1.5 rounded-lg border border-orange-500/20 hover:bg-orange-500/20 animate-pulse hover:animate-none"
                                        >
                                            <AlertTriangle size={16} />
                                            <span className="text-sm font-bold">{stats.pendingCount} Bestätigen</span>
                                        </button>
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
                                                    <div className="flex items-center gap-3 text-xs text-white/50">
                                                        {entry.type !== 'overtime_reduction' && <span className="flex items-center gap-1 font-mono"><Clock size={12} /> {entry.start_time || '--:--'} - {entry.end_time || '--:--'}</span>}
                                                        <span className="flex items-center gap-1 font-mono text-white/80 font-bold"><Briefcase size={12} /> {entry.hours.toFixed(2)} h</span>
                                                    </div>
                                                    {entry.note && (
                                                        <div className="mt-1 flex items-start gap-1 text-xs text-white/40 italic truncate">
                                                            <StickyNote size={10} className="mt-0.5 shrink-0" /> {entry.note}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-2 shrink-0">
                                                    <button
                                                        onClick={() => handleEditClick(entry)}
                                                        className="p-2 rounded-lg bg-white/5 text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                                                        title="Bearbeiten"
                                                    >
                                                        <Edit2 size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleConfirmEntry(entry.id)}
                                                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-400 hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/30 transition-all font-bold text-xs"
                                                    >
                                                        <CheckCircle size={16} /> Bestätigen
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </GlassCard>
                </div>
            )}
            {/* Batch Export Modal */}
            <BatchExportModal isOpen={showExportModal} onClose={() => setShowExportModal(false)} />
        </div>
    );
};

export default OfficeDashboard;