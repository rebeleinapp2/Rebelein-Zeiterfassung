import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Siren, CheckCircle, UserCheck, X, List, Clock } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { EmergencySchedule, UserSettings } from '../types';
import { GlassCard } from './GlassCard';

interface Props {
    isAdmin?: boolean;
    users: UserSettings[];
    currentUserId?: string;
}

const EmergencyCalendar: React.FC<Props> = ({ isAdmin, users, currentUserId }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [schedule, setSchedule] = useState<EmergencySchedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [userYearlySchedule, setUserYearlySchedule] = useState<EmergencySchedule[]>([]);

    // Modal State
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [selectedUserForDay, setSelectedUserForDay] = useState<string>(''); // user_id or ''
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [selectedAllowanceHours, setSelectedAllowanceHours] = useState<string>('');

    const fetchSchedule = async () => {
        setLoading(true);
        const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

        const { data, error } = await supabase
            .from('emergency_schedule')
            .select('*')
            .gte('date', start.toISOString().split('T')[0])
            .lte('date', end.toISOString().split('T')[0]);

        if (!error && data) {
            setSchedule(data as EmergencySchedule[]);
        }
        setLoading(false);
    };

    const fetchUserYearlySchedule = async () => {
        if (!currentUserId) return;
        const yearStart = new Date(currentDate.getFullYear(), 0, 1).toISOString().split('T')[0];
        const yearEnd = new Date(currentDate.getFullYear(), 11, 31).toISOString().split('T')[0];

        const { data, error } = await supabase
            .from('emergency_schedule')
            .select('*')
            .eq('user_id', currentUserId)
            .gte('date', yearStart)
            .lte('date', yearEnd)
            .order('date', { ascending: true });

        if (!error && data) {
            setUserYearlySchedule(data as EmergencySchedule[]);
        }
    };

    useEffect(() => {
        fetchSchedule();
        fetchUserYearlySchedule();
    }, [currentDate.getFullYear(), currentDate.getMonth(), currentUserId]);

    const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

    const getDaysInMonth = (year: number, month: number) => {
        return new Date(year, month + 1, 0).getDate();
    };

    const getFirstDayOfMonth = (year: number, month: number) => {
        let day = new Date(year, month, 1).getDay();
        // Adjust to Monday = 0, Sunday = 6
        return day === 0 ? 6 : day - 1;
    };

    const daysInMonth = getDaysInMonth(currentDate.getFullYear(), currentDate.getMonth());
    const firstDay = getFirstDayOfMonth(currentDate.getFullYear(), currentDate.getMonth());

    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const blanks = Array.from({ length: firstDay }, (_, i) => i);

    const getDefaultAllowance = (d: Date): number => {
        const dow = d.getDay(); // 0=Sun, 5=Fri, 6=Sat
        if (dow === 5) return 0.5;
        if (dow === 6 || dow === 0) return 1;
        return 0;
    };

    const handleDayClick = (day: number) => {
        const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), day, 12);
        const dateStr = d.toISOString().split('T')[0];

        // Find who is assigned
        const assigned = schedule.find(s => s.date === dateStr);
        setSelectedDate(d);
        if (assigned?.swap_status === 'pending' && assigned?.proposed_user_id) {
            setSelectedUserForDay(assigned.proposed_user_id);
        } else {
            setSelectedUserForDay(assigned ? assigned.user_id : '');
        }
        // Pre-populate allowance: use stored value or compute default
        if (assigned?.allowance_hours != null) {
            setSelectedAllowanceHours(assigned.allowance_hours.toString());
        } else {
            setSelectedAllowanceHours(getDefaultAllowance(d).toString());
        }
        setIsModalOpen(true);
    };

    const handleSaveDay = async () => {
        if (!selectedDate) return;
        setIsSaving(true);
        const dateStr = selectedDate.toISOString().split('T')[0];

        // Find existing to know if we need to update/delete/insert
        const existing = schedule.find(s => s.date === dateStr);

        const parsedAllowance = parseFloat(selectedAllowanceHours.replace(',', '.'));
        const allowanceVal = isNaN(parsedAllowance) ? null : parsedAllowance;

        try {
            if (isAdmin) {
                if (!selectedUserForDay) {
                    if (existing) {
                        await supabase.from('emergency_schedule').delete().eq('id', existing.id);
                    }
                } else {
                    if (existing) {
                        const updates: any = { allowance_hours: allowanceVal };
                        if (existing.user_id !== selectedUserForDay) {
                            updates.user_id = selectedUserForDay;
                            updates.proposed_user_id = null;
                            updates.swap_status = null;
                            updates.swap_requested_at = null;
                        } else if (existing.swap_status === 'pending') {
                            updates.proposed_user_id = null;
                            updates.swap_status = null;
                            updates.swap_requested_at = null;
                        }
                        await supabase.from('emergency_schedule').update(updates).eq('id', existing.id);
                    } else {
                        await supabase.from('emergency_schedule').insert({ date: dateStr, user_id: selectedUserForDay, allowance_hours: allowanceVal });
                    }
                }
            } else {
                if (!existing) {
                    alert('Du kannst keinen neuen Notdienst erstellen, sondern nur prüfen oder tauchen.');
                    setIsSaving(false);
                    return;
                }
                if (selectedUserForDay === existing.user_id) {
                    await supabase.from('emergency_schedule').update({ proposed_user_id: null, swap_status: null, swap_requested_at: null }).eq('id', existing.id);
                } else {
                    if (!selectedUserForDay) {
                        alert('Bitte wähle einen Kollegen aus, dem du den Dienst übergeben möchtest.');
                        setIsSaving(false);
                        return;
                    }
                    await supabase.from('emergency_schedule').update({
                        proposed_user_id: selectedUserForDay,
                        swap_status: 'pending',
                        swap_requested_at: new Date().toISOString()
                    }).eq('id', existing.id);
                }
            }
            await fetchSchedule();
            await fetchUserYearlySchedule();
            setIsModalOpen(false);
        } catch (err) {
            alert('Fehler beim Speichern des Notdienstes.');
        } finally {
            setIsSaving(false);
        }
    };

    const monthNames = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

    const groupedPeriods = React.useMemo(() => {
        if (userYearlySchedule.length === 0) return [];

        const sorted = [...userYearlySchedule].sort((a, b) => a.date.localeCompare(b.date));
        const periods: { start: string, end: string }[] = [];
        let currentStart = sorted[0].date;
        let currentEnd = sorted[0].date;

        for (let i = 1; i < sorted.length; i++) {
            const prevDate = new Date(currentEnd);
            const currDate = new Date(sorted[i].date);

            // Adjust difference computation ignoring timezones/DST issues by using UTC timestamps or robust logic
            const diffTime = Date.UTC(currDate.getFullYear(), currDate.getMonth(), currDate.getDate()) - Date.UTC(prevDate.getFullYear(), prevDate.getMonth(), prevDate.getDate());
            const diffDays = Math.round(diffTime / (1000 * 3600 * 24));

            if (diffDays === 1) {
                currentEnd = sorted[i].date;
            } else {
                periods.push({ start: currentStart, end: currentEnd });
                currentStart = sorted[i].date;
                currentEnd = sorted[i].date;
            }
        }
        periods.push({ start: currentStart, end: currentEnd });
        return periods;
    }, [userYearlySchedule]);

    return (
        <GlassCard className="mt-8 flex flex-col items-center">
            <div className="w-full flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Siren size={24} className="text-rose-400" />
                    Notdienst Plan
                </h2>

                <div className="flex items-center justify-between md:justify-center gap-2 md:gap-4 bg-white/5 rounded-full px-2 md:px-4 py-2 border border-white/10 w-full md:w-auto">
                    <button onClick={prevMonth} className="p-2 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors">
                        <ChevronLeft size={20} />
                    </button>
                    <span className="font-bold text-white min-w-[120px] text-center text-sm md:text-base">
                        {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
                    </span>
                    <button onClick={nextMonth} className="p-2 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors">
                        <ChevronRight size={20} />
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            ) : (
                <div className="w-full h-full text-white">
                    <div className="grid grid-cols-7 gap-1 md:gap-2 mb-2">
                        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => (
                            <div key={d} className="text-center text-xs font-bold text-white/50 pb-2">{d}</div>
                        ))}
                    </div>

                    <div className="grid grid-cols-7 gap-1 md:gap-2 relative">
                        {blanks.map(b => (
                            <div key={`blank-${b}`} className="min-h-[80px] md:min-h-[100px] bg-white/[0.02] rounded-xl border border-white/[0.05]"></div>
                        ))}
                        {days.map(day => {
                            const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), day, 12);
                            const dateStr = d.toISOString().split('T')[0];
                            const isToday = new Date().toISOString().split('T')[0] === dateStr;

                            const assigned = schedule.find(s => s.date === dateStr);
                            const assignedUser = assigned ? users.find(u => u.user_id === assigned.user_id) : null;

                            const isWeekend = d.getDay() === 0 || d.getDay() === 6;

                            return (
                                <div
                                    key={day}
                                    onClick={() => handleDayClick(day)}
                                    className={`min-h-[80px] md:min-h-[100px] flex flex-col p-1 md:p-2 rounded-xl border cursor-pointer transition-all hover:scale-[1.02] ${isToday ? 'border-teal-500 bg-teal-500/10' :
                                        isWeekend ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-white/[0.02] border-white/5 hover:bg-white/10'
                                        }`}
                                >
                                    <span className={`text-xs md:text-sm font-bold mb-1 ${isToday ? 'text-teal-300' : 'text-white/60'} ${isWeekend ? 'text-rose-300' : ''}`}>
                                        {day}.
                                    </span>

                                    {assignedUser && (
                                        <div className={`mt-auto rounded content-center py-1 md:px-2 shadow-sm truncate overflow-hidden flex items-center gap-1 justify-center border ${assigned?.swap_status === 'pending' ? 'bg-orange-500/20 border-orange-500/30' : 'bg-rose-500/20 border-rose-500/30'}`}>
                                            <p className={`text-[10px] md:text-xs font-bold truncate ${assigned?.swap_status === 'pending' ? 'text-orange-200' : 'text-rose-200'}`}>
                                                <span className="lg:hidden">{assignedUser.display_name.split(' ')[0]}</span>
                                                <span className="hidden lg:inline">{assignedUser.display_name}</span>
                                                {assigned?.swap_status === 'pending' && <span className="hidden md:inline ml-1 text-orange-400">?</span>}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* USER YEARLY SCHEDULE */}
            {currentUserId && (
                <div className="w-full mt-8 pt-6 border-t border-white/10">
                    <h3 className="text-sm font-bold text-rose-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <List size={16} /> Meine Notdienste in {currentDate.getFullYear()}
                    </h3>
                    {groupedPeriods.length === 0 ? (
                        <p className="text-white/40 text-sm italic">Keine Notdienste im Jahr {currentDate.getFullYear()} eingetragen.</p>
                    ) : (
                        <div className="space-y-2">
                            {groupedPeriods.map((p, i) => (
                                <div key={i} className="bg-white/5 border border-white/10 rounded-lg p-3 flex justify-between items-center group hover:bg-rose-500/10 hover:border-rose-500/30 transition-colors">
                                    <span className="font-bold text-white text-sm">
                                        {p.start === p.end
                                            ? new Date(p.start).toLocaleDateString('de-DE')
                                            : `${new Date(p.start).toLocaleDateString('de-DE')} - ${new Date(p.end).toLocaleDateString('de-DE')}`}
                                    </span>
                                    <Siren size={16} className="text-rose-500/50 group-hover:text-rose-400 transition-colors" />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Modal for assign/swap */}
            {isModalOpen && selectedDate && (() => {
                const existingForModal = schedule.find(s => s.date === selectedDate.toISOString().split('T')[0]);
                const isPendingSwap = existingForModal?.swap_status === 'pending';
                const pendingTargetUser = isPendingSwap ? users.find(u => u.user_id === existingForModal.proposed_user_id) : null;
                const assignedUserDisplay = existingForModal ? users.find(u => u.user_id === existingForModal.user_id) : null;
                const canSwap = isAdmin || (currentUserId && existingForModal?.user_id === currentUserId);

                return (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-sm !p-0 overflow-hidden ring-1 ring-white/20 shadow-2xl">
                            <div className="p-5 bg-gradient-to-b from-rose-900/20 to-transparent">
                                <div className="flex justify-between items-start mb-4">
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        <Siren size={20} className="text-rose-400" />
                                        Notdienst am {selectedDate.toLocaleDateString('de-DE')}
                                    </h3>
                                    <button onClick={() => setIsModalOpen(false)} className="text-white/50 hover:text-white p-1">
                                        <X size={20} />
                                    </button>
                                </div>

                                {existingForModal && (
                                    <div className="mb-4 text-sm bg-black/20 p-3 rounded-lg border border-white/5">
                                        <p className="text-white/70">Zuständig: <span className="font-bold text-white">{assignedUserDisplay?.display_name || 'Niemand'}</span></p>
                                        {isPendingSwap && (
                                            <div className="mt-2 text-orange-300">
                                                <p>Tauschanfrage an: <span className="font-bold">{pendingTargetUser?.display_name || 'Unbekannt'}</span></p>
                                                <p className="text-xs opacity-70">Angefragt am: {existingForModal.swap_requested_at ? new Date(existingForModal.swap_requested_at).toLocaleDateString('de-DE') : ''}</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <p className="text-sm text-white/50 mb-4">
                                    {isAdmin ? 'Wähle einen Mitarbeiter aus, um ihn für den Notdienst einzuteilen.' : canSwap ? 'Intern tauschen: Wähle aus, wem du den Notdienst übergeben möchtest.' : 'Du kannst nur deine eigenen Dienste tauschen.'}
                                </p>

                                <select
                                    value={selectedUserForDay}
                                    onChange={(e) => setSelectedUserForDay(e.target.value)}
                                    disabled={!isAdmin && !canSwap}
                                    className="w-full bg-slate-900/50 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-rose-500 transition-colors appearance-none disabled:opacity-50"
                                >
                                    <option value="">-- Niemand (Dienst freigeben) --</option>
                                    {users.filter(u => u.is_active && u.role !== 'azubi').map(user => (
                                        <option key={user.user_id} value={user.user_id}>
                                            {user.display_name}
                                        </option>
                                    ))}
                                </select>

                                {isAdmin && selectedUserForDay && (
                                    <div className="mt-4">
                                        <label className="text-xs font-bold text-white/50 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                            <Clock size={14} /> Pauschale (Stunden)
                                        </label>
                                        <div className="flex items-center gap-2 mt-1">
                                            {['0', '0.5', '1'].map(val => (
                                                <button
                                                    key={val}
                                                    type="button"
                                                    onClick={() => setSelectedAllowanceHours(val)}
                                                    className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-bold border transition-all ${selectedAllowanceHours === val
                                                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                                        : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10 hover:text-white'
                                                        }`}
                                                >
                                                    {val === '0' ? '0h' : val === '0.5' ? '0,5h' : '1,0h'}
                                                </button>
                                            ))}
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                value={selectedAllowanceHours}
                                                onChange={(e) => setSelectedAllowanceHours(e.target.value)}
                                                placeholder="...h"
                                                className="w-20 bg-slate-900/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white text-center focus:outline-none focus:border-rose-500 transition-colors"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="p-4 bg-black/20 flex justify-end gap-3 border-t border-white/5">
                                <button
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 rounded-xl text-sm font-bold text-white/50 hover:text-white hover:bg-white/5 transition-colors"
                                >
                                    Abbrechen
                                </button>
                                {(canSwap) && (
                                    <button
                                        onClick={handleSaveDay}
                                        disabled={isSaving}
                                        className="px-4 py-2 rounded-xl text-sm font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 transition-colors flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {isSaving ? <><CheckCircle size={16} className="animate-spin" /> Speichern...</> : 'Speichern'}
                                    </button>
                                )}
                            </div>
                        </GlassCard>
                    </div>
                );
            })()}
        </GlassCard>
    );
};

export default EmergencyCalendar;
