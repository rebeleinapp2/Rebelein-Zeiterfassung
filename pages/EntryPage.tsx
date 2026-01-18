import React, { useState, useEffect, useRef, useCallback } from 'react';
import { differenceInCalendarDays } from 'date-fns';
import { useTimeEntries, useSettings, useDailyLogs, useAbsences, useInstallers, usePeerReviews, getLocalISOString, useOfficeService, useDepartments } from '../services/dataService'; // Added useDepartments
import { supabase } from '../services/supabaseClient'; // Ensure supabase is imported
import { GlassCard, GlassInput, GlassButton } from '../components/GlassCard';
import GlassDatePicker from '../components/GlassDatePicker';
import { PlusCircle, Save, X, Calendar, ChevronLeft, ChevronRight, Clock, Coffee, Building, Briefcase, Truck, Sun, Heart, AlertCircle, AlertTriangle, CheckCircle, Info, Lock, History, User, FileText, Palmtree, UserX, Copy, Loader2, RefreshCw, Send, ArrowLeft, Trash2, CalendarDays, Plus, ChevronDown, ChevronUp, ArrowRight, MessageSquareText, StickyNote, Building2, Warehouse, Car, Stethoscope, PartyPopper, Ban, TrendingDown, Play, Square, UserCheck, Check, UserPlus, ArrowLeftRight, Baby, Coins, PiggyBank, Siren, Percent, ShieldAlert, Edit2, XCircle } from 'lucide-react';
import { TimeSegment, QuotaChangeNotification, TimeEntry } from '../types';
import { formatDuration, getGracePeriodDate } from '../services/utils/timeUtils';

// Zentrale Konfiguration für das Modal (Icons & Farben)
const ENTRY_TYPES_CONFIG = {
    work: { label: 'Arbeit / Projekt', icon: Briefcase, color: 'text-emerald-300' },
    break: { label: 'Pause', icon: Coffee, color: 'text-orange-300' },
    company: { label: 'Firma', icon: Building2, color: 'text-blue-300' },
    office: { label: 'Büro', icon: Building, color: 'text-purple-300' },
    warehouse: { label: 'Lager', icon: Warehouse, color: 'text-amber-300' },
    car: { label: 'Auto / Fahrt', icon: Car, color: 'text-gray-300' },
    vacation: { label: 'Urlaub', icon: Palmtree, color: 'text-purple-300' },
    sick: { label: 'Krank', icon: Stethoscope, color: 'text-red-300' },
    holiday: { label: 'Feiertag', icon: PartyPopper, color: 'text-blue-300' },
    unpaid: { label: 'Unbezahlt', icon: Ban, color: 'text-gray-300' },
    sick_child: { label: 'Kind krank', icon: Baby, color: 'text-rose-300' },
    sick_pay: { label: 'Krankengeld', icon: Coins, color: 'text-yellow-300' },
    overtime_reduction: { label: 'Gutstunden', icon: PiggyBank, color: 'text-pink-300' },
    emergency_service: { label: 'Notdienst', icon: Siren, color: 'text-rose-500' },
    special_holiday: { label: 'Sonderurlaub', icon: PartyPopper, color: 'text-teal-300' }
};

type EntryType = keyof typeof ENTRY_TYPES_CONFIG;
const ENTRY_TYPE_ORDER: EntryType[] = ['work', 'break', 'company', 'office', 'warehouse', 'car', 'vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay', 'overtime_reduction', 'emergency_service'];

// --- Sub-Component for Debounced Note Input ---
const DebouncedSegmentNote: React.FC<{
    initialValue: string,
    onSave: (val: string) => void
}> = ({ initialValue, onSave }) => {
    const [value, setValue] = useState(initialValue);
    const [status, setStatus] = useState<'idle' | 'typing' | 'saved'>('idle');

    useEffect(() => {
        // Sync local state if prop changes remotely (rare, but good practice)
        // But only if we are not typing to avoid overwriting user input
        if (status === 'idle' && initialValue !== value) {
            setValue(initialValue);
        }
    }, [initialValue]);

    useEffect(() => {
        if (status !== 'typing') return;

        const timer = setTimeout(() => {
            onSave(value);
            setStatus('saved');
            setTimeout(() => setStatus('idle'), 1500); // Back to idle after showing checkmark
        }, 2000); // 2 seconds debounce

        return () => clearTimeout(timer);
    }, [value, status, onSave]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setValue(e.target.value);
        setStatus('typing');
    };

    return (
        <div className="flex items-center gap-2 pt-1 border-t border-white/5 w-full relative">
            <MessageSquareText size={14} className="text-white/30 shrink-0" />
            <input
                type="text"
                value={value}
                onChange={handleChange}
                placeholder="Bemerkung..."
                className="w-full bg-transparent text-xs text-white/70 focus:outline-none placeholder-white/20 py-1 pr-6"
            />
            <div className="absolute right-0 top-1/2 -translate-y-1/2 text-white/50">
                {status === 'typing' && <RefreshCw size={12} className="animate-spin text-teal-400" />}
                {status === 'saved' && <Check size={12} className="text-emerald-400 animate-in zoom-in" />}
            </div>
        </div>
    );
};

const EntryPage: React.FC = () => {
    const { addEntry, entries, updateEntry } = useTimeEntries();
    const { addAbsence } = useAbsences();
    const { settings, updateSettings } = useSettings();
    const { getLogForDate, saveDailyLog } = useDailyLogs();

    // Notification & Office Services
    const { fetchQuotaNotifications, respondToQuotaNotification } = useOfficeService();
    const { departments, fetchDepartments } = useDepartments(); // Fetched for late entry routing
    useEffect(() => { fetchDepartments(); }, []); // Load departments on mount
    const [pendingQuotaNotifications, setPendingQuotaNotifications] = useState<QuotaChangeNotification[]>([]);
    const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false); // NEU: Modal Visibility State
    const [notificationRejectionReason, setNotificationRejectionReason] = useState('');

    // Rejected Entries State
    const [rejectedEntries, setRejectedEntries] = useState<TimeEntry[]>([]);

    useEffect(() => {
        const fetchRejected = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data } = await supabase.from('time_entries')
                .select('*')
                .eq('user_id', user.id)
                .not('rejected_at', 'is', null)
                .is('confirmed_at', null);

            setRejectedEntries(data as TimeEntry[] || []);
        };

        fetchRejected();

        const channel = supabase
            .channel('entry_updates_rejected')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries' }, () => {
                fetchRejected();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    // Peer Review Hooks (Wiederhergestellt)
    const installers = useInstallers();
    const { reviews: pendingReviews, processReview } = usePeerReviews();

    // Nutzung von getLocalISOString statt UTC
    const [date, setDate] = useState(getLocalISOString());
    const [client, setClient] = useState('');
    const [hours, setHours] = useState('');
    const [note, setNote] = useState('');

    // Edit State
    const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

    // NEU: State für verantwortlichen Monteur
    const [responsibleUserId, setResponsibleUserId] = useState<string>(() => {
        // Initialize from localStorage if available
        return localStorage.getItem('lastResponsibleUserId') || '';
    });

    // Fetch notifications on mount
    useEffect(() => {
        const checkNotifications = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const notifs = await fetchQuotaNotifications(user.id);
                if (notifs) {
                    setPendingQuotaNotifications(notifs);
                    if (notifs.length > 0) setIsNotificationModalOpen(true); // Auto-open on first load
                }
            }
        };
        checkNotifications();
    }, []);

    const handleQuotaResponse = async (status: 'confirmed' | 'rejected') => {
        if (pendingQuotaNotifications.length === 0) return;
        const current = pendingQuotaNotifications[0];

        try {
            await respondToQuotaNotification(current.id, status, status === 'rejected' ? notificationRejectionReason : undefined);
            // Remove from list
            setPendingQuotaNotifications(prev => prev.slice(1));
            setNotificationRejectionReason('');
        } catch (e) {
            console.error(e);
            alert("Fehler beim Senden der Antwort.");
        }
    };

    const [showInstallerMenu, setShowInstallerMenu] = useState(false); // Dropdown State

    // NOTIFICATION STATE for Deleted/Modified Entries
    const [entryNotifications, setEntryNotifications] = useState<TimeEntry[]>([]);
    const [isEntryNotificationModalOpen, setIsEntryNotificationModalOpen] = useState(false);

    // Check for modifications/deletions on load
    useEffect(() => {
        const checkEntryNotifications = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // 1. Deleted Entries needing confirmation (Legacy or direct soft-delete)
            const { data: deleted } = await supabase
                .from('time_entries')
                .select('*')
                .eq('user_id', user.id)
                .eq('is_deleted', true)
                .eq('deletion_confirmed_by_user', false);

            // 1b. Deletion REQUESTS (New Flow)
            const { data: deletionRequests } = await supabase
                .from('time_entries')
                .select('*')
                .eq('user_id', user.id)
                .not('deletion_requested_at', 'is', null)
                .eq('is_deleted', false);

            // 2. Modified Entries needing confirmation (Based on History Table)
            // Fetch entries that have PENDING history records
            const { data: pendingHistory } = await supabase
                .from('entry_change_history')
                .select('entry_id')
                .eq('status', 'pending');

            let modifiedDetails: any[] = [];
            if (pendingHistory && pendingHistory.length > 0) {
                const entryIds = Array.from(new Set(pendingHistory.map(h => h.entry_id)));
                const { data: entriesWithPending } = await supabase
                    .from('time_entries')
                    .select('*')
                    .in('id', entryIds)
                    .eq('user_id', user.id) // Ensure only own entries
                    .eq('is_deleted', false); // Exclude deleted ones (handled above)

                if (entriesWithPending) modifiedDetails = entriesWithPending;
            }

            // Combine DELETED (priority) + MODIFIED + DELETION REQUESTS
            // Filter duplicates just in case
            const allNotifs = [...(deleted || []), ...(deletionRequests || []), ...modifiedDetails].filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);

            if (allNotifs.length > 0) {
                setEntryNotifications(allNotifs as TimeEntry[]);
                // Modal removed, now using persistent dashboard card
                // setIsEntryNotificationModalOpen(true);
            }
        };

        checkEntryNotifications();
    }, []);

    const confirmEntryNotification = async (entry: TimeEntry) => {
        if (entry.is_deleted) {
            // Legacy/Soft-Delete Confirmation
            await supabase.from('time_entries').update({ deletion_confirmed_by_user: true }).eq('id', entry.id);
        } else if (entry.deletion_requested_at) {
            // New Mutual Deletion: User CONFIRMS deletion -> set is_deleted = true
            const { error } = await supabase.from('time_entries').update({
                is_deleted: true,
                deleted_at: new Date().toISOString(),
                deleted_by: entry.deletion_requested_by, // The admin/office who requested it
                deletion_reason: entry.deletion_request_reason,
                deletion_confirmed_by_user: true
            }).eq('id', entry.id);

            if (error) {
                alert("Fehler beim Löschen: " + error.message);
                return;
            }
        } else {
            // Logik für Änderungsbestätigung via RPC (Sicherer update beider Tabellen)
            const { error } = await supabase.rpc('handle_entry_history_response', {
                p_entry_id: entry.id,
                p_action: 'confirm'
            });

            if (error) {
                console.error("Error confirming history:", error);
                alert("Fehler beim Bestätigen: " + error.message);
                return; // Don't remove from list if failed
            }
        }

        setEntryNotifications(prev => prev.filter(e => e.id !== entry.id));
        // Persistent card doesn't use modal state anymore, so no need to check length for modal
    };

    // NEU: State für Review-Ablehnung
    const [rejectingEntryId, setRejectingEntryId] = useState<string | null>(null);
    const [rejectionReason, setRejectionReason] = useState('');

    const [entryType, setEntryType] = useState<EntryType>('work');
    const [surcharge, setSurcharge] = useState<number>(0);

    // New fields for start/end logic
    const [projectStartTime, setProjectStartTime] = useState('');
    const [projectEndTime, setProjectEndTime] = useState('');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);

    // --- OVERLAP DETECTION STATE ---
    const [overlapWarning, setOverlapWarning] = useState<{
        isOpen: boolean;
        overlappedEntries: { entry: any; overlapMinutes: number }[];
        newEntryData: any; // To store what we wanted to add
    }>({ isOpen: false, overlappedEntries: [], newEntryData: null });

    // State for Correction Modal (Rejected Entries)
    const [correctionModal, setCorrectionModal] = useState<{ isOpen: boolean; entry: TimeEntry | null; form: any }>({ isOpen: false, entry: null, form: {} });

    // --- LATE ENTRY STATE (RETROSPECTIVE) ---
    const [gracePeriodCutoff, setGracePeriodCutoff] = useState<Date>(getGracePeriodDate());
    const [isLateEntry, setIsLateEntry] = useState(false);
    const [lateReason, setLateReason] = useState('');

    // Re-calculate cutoff on mount (and potentially midnight?)
    useEffect(() => {
        setGracePeriodCutoff(getGracePeriodDate());
    }, []);

    // Check if selected date is late
    useEffect(() => {
        if (!gracePeriodCutoff) return;
        const currentEntryDate = new Date(date);
        // Set to end of day to check if it's strictly BEFORE the cutoff DAY.
        // Cutoff is set to 00:00:00 of the allowed day.
        // If EntryDate is 2024-05-01 and Cutoff is 2024-05-02 00:00
        // EntryDate < Cutoff check:
        // We compare ISO dates (strings) usually, but here Date objects.
        // Let's rely on timeUtils logic: Cutoff is the first VALID day.
        // So anything strictly smaller than Cutoff (at 00:00) is Late.
        // But date state is YYYY-MM-DD string.
        const d = new Date(date);
        d.setHours(23, 59, 59, 999); // Compare end of day?
        // No. If cutoff is Thursday 00:00.
        // If I select Wednesday. Wed 23:59 < Thu 00:00 ? Yes. Late.
        d.setHours(23, 59, 59, 999);
        setIsLateEntry(d < gracePeriodCutoff);
    }, [date, gracePeriodCutoff]);

    const [lateEntryWarning, setLateEntryWarning] = useState<{
        isOpen: boolean;
        diffDays: number;
        reason: string;
    }>({ isOpen: false, diffDays: 0, reason: '' });

    const [showAzubiInstallerModal, setShowAzubiInstallerModal] = useState(false); // NEU: Azubi Warning Modal

    // NEW: Rejected Entries State


    // Card Collapsed State
    const [isTimeCardCollapsed, setIsTimeCardCollapsed] = useState(false);

    // --- Long Press Logic State ---
    const [showTypeMenu, setShowTypeMenu] = useState(false);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isLongPress = useRef(false);

    // Load initial collapsed state
    useEffect(() => {
        if (settings.preferences?.timeCardCollapsed !== undefined) {
            setIsTimeCardCollapsed(settings.preferences.timeCardCollapsed);
        }
    }, [settings.preferences]);

    const toggleTimeCard = () => {
        const newState = !isTimeCardCollapsed;
        setIsTimeCardCollapsed(newState);
        updateSettings({
            ...settings,
            preferences: {
                ...settings.preferences,
                timeCardCollapsed: newState
            }
        });
    };

    // Helper to determine optimal start time based on history
    const getSuggestedStartTime = useCallback(() => {
        const dayEntries = entries
            .filter(e => e.date === date)
            .sort((a, b) => (a.end_time || '').localeCompare(b.end_time || ''));

        if (dayEntries.length > 0) {
            const lastEntry = dayEntries[dayEntries.length - 1];
            if (lastEntry.end_time) {
                return lastEntry.end_time;
            }
        }

        const dayIndex = new Date(date).getDay();
        return settings.work_config?.[dayIndex as keyof typeof settings.work_config] || "07:00";
    }, [date, entries, settings.work_config]);

    // Helper to update fields based on type
    const updateFieldsForType = (nextType: EntryType) => {
        // Auto-fill names
        switch (nextType) {
            case 'work': setClient(''); break;
            case 'break': setClient('Pause'); break;
            case 'company': setClient('Firma'); break;
            case 'office': setClient('Büro'); break;
            case 'warehouse': setClient('Lager'); break;
            case 'car': setClient('Auto / Fahrt'); break;
            case 'vacation': setClient('Urlaub'); break;
            case 'sick': setClient('Krank'); break;
            case 'holiday': setClient('Feiertag'); break;
            case 'unpaid': setClient('Unbezahlt'); break;
            case 'sick_child': setClient('Kind krank'); break;
            case 'sick_pay': setClient('Krankengeld'); break;
            case 'overtime_reduction': setClient('Gutstunden'); break;
            case 'emergency_service': setClient(''); break;
        }

        // --- PERSISTENCE LOGIC START ---
        // If switching TO 'company'/'office'/etc (global types), clear the responsible user ID visually (but keep in storage).
        // If switching TO 'work'/'break', RESTORE it from storage.
        const globalConfirmationTypes = ['company', 'office', 'warehouse', 'car'];
        if (globalConfirmationTypes.includes(nextType)) {
            setResponsibleUserId('');
        } else if (nextType === 'work' || nextType === 'break') {
            // Only restore if NOT a late entry
            if (!isLateEntry) {
                const stored = localStorage.getItem('lastResponsibleUserId');
                if (stored) setResponsibleUserId(stored);
            }
        }
        // --- PERSISTENCE LOGIC END ---

        const isNextAbsence = ['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay'].includes(nextType);

        if (isNextAbsence) {
            setHours('0');
            setProjectStartTime('');
            setProjectEndTime('');
        } else {
            // Restore start time if it was cleared (e.g. by passing through absence types) or is empty
            if (!projectStartTime) {
                setProjectStartTime(getSuggestedStartTime());
            }

            // Clear hours if coming from absence type (where we set it to '0')
            if (['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay'].includes(entryType)) {
                setHours('');
            }
        }

        if (nextType !== 'emergency_service') {
            setSurcharge(0);
        }
    };

    // Cycle Entry Types (Short Press)
    const cycleEntryType = () => {
        const currentIndex = ENTRY_TYPE_ORDER.indexOf(entryType);
        const nextIndex = (currentIndex + 1) % ENTRY_TYPE_ORDER.length;
        const nextType = ENTRY_TYPE_ORDER[nextIndex];

        setEntryType(nextType);
        updateFieldsForType(nextType);
    };

    // Select Specific Type (Long Press Menu)
    const handleTypeSelect = (type: EntryType) => {
        setEntryType(type);
        updateFieldsForType(type);
        setShowTypeMenu(false);
    };

    // --- Long Press Handlers ---
    const handleButtonDown = (e: React.MouseEvent | React.TouchEvent) => {
        isLongPress.current = false;
        longPressTimer.current = setTimeout(() => {
            isLongPress.current = true;
            setShowTypeMenu(true);
        }, 500); // 500ms threshold
    };

    const handleButtonUp = (e: React.MouseEvent | React.TouchEvent) => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }

        if (isLongPress.current) {
            e.preventDefault();
        } else {
            // Short press behavior
            if (!showTypeMenu) {
                cycleEntryType();
            }
        }
        isLongPress.current = false;
    };

    const handleButtonLeave = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    // Helpers
    const formatTimeInput = (val: string) => {
        const cleanVal = val.trim();
        if (/^\d{1,2}$/.test(cleanVal)) {
            const h = parseInt(cleanVal, 10);
            if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:00`;
        }
        if (/^\d{3}$/.test(cleanVal)) {
            const h = parseInt(cleanVal.substring(0, 1), 10);
            const m = parseInt(cleanVal.substring(1), 10);
            if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }
        if (/^\d{4}$/.test(cleanVal)) {
            const h = parseInt(cleanVal.substring(0, 2), 10);
            const m = parseInt(cleanVal.substring(2), 10);
            if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }
        return val;
    };

    const addMinutesToTime = (time: string, mins: number): string => {
        if (!time || !time.includes(':')) return '';
        const [h, m] = time.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) return '';
        const date = new Date();
        date.setHours(h, m, 0, 0);
        date.setMinutes(date.getMinutes() + mins);
        return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    };

    const getMinutesDiff = (start: string, end: string): number => {
        if (!start || !end) return 0;
        if (!start.includes(':') || !end.includes(':')) return 0;
        const [h1, m1] = start.split(':').map(Number);
        const [h2, m2] = end.split(':').map(Number);
        if (isNaN(h1) || isNaN(m1) || isNaN(h2) || isNaN(m2)) return 0;
        const d1 = new Date().setHours(h1, m1, 0, 0);
        const d2 = new Date().setHours(h2, m2, 0, 0);
        return (d2 - d1) / (1000 * 60);
    };

    // 1. When DATE (or entries/settings) changes, determine default start time
    // Using useCallback dependency getSuggestedStartTime
    useEffect(() => {
        setProjectStartTime(getSuggestedStartTime());
        setProjectEndTime('');
        setHours('');
    }, [getSuggestedStartTime]);

    const handleHoursChange = (val: string) => {
        setHours(val);
        if (val && projectStartTime && projectStartTime.includes(':')) {
            const h = parseFloat(val.replace(',', '.'));
            if (!isNaN(h)) {
                const minutes = Math.round(h * 60);
                setProjectEndTime(addMinutesToTime(projectStartTime, minutes));
            }
        } else if (!val) {
            setProjectEndTime('');
        }
    };

    const handleStartTimeChange = (val: string) => {
        setProjectStartTime(val);
        if (hours && val && val.includes(':')) {
            const h = parseFloat(hours.replace(',', '.'));
            const minutes = Math.round(h * 60);
            setProjectEndTime(addMinutesToTime(val, minutes));
        }
    };

    const handleEndTimeChange = (val: string) => {
        setProjectEndTime(val);
        if (projectStartTime && val && projectStartTime.includes(':') && val.includes(':')) {
            const diffMins = getMinutesDiff(projectStartTime, val);
            if (diffMins > 0) {
                setHours((diffMins / 60).toFixed(2));
            } else {
                setHours('');
            }
        }
    };

    const handleStartTimeBlur = () => {
        const formatted = formatTimeInput(projectStartTime);
        if (formatted !== projectStartTime) {
            setProjectStartTime(formatted);
            if (hours) {
                const h = parseFloat(hours.replace(',', '.'));
                const minutes = Math.round(h * 60);
                setProjectEndTime(addMinutesToTime(formatted, minutes));
            } else if (projectEndTime && projectEndTime.includes(':')) {
                const diffMins = getMinutesDiff(formatted, projectEndTime);
                if (diffMins > 0) setHours((diffMins / 60).toFixed(2));
            }
        }
    };

    const handleEndTimeBlur = () => {
        const formatted = formatTimeInput(projectEndTime);
        if (formatted !== projectEndTime) {
            setProjectEndTime(formatted);
            if (projectStartTime && projectStartTime.includes(':')) {
                const diffMins = getMinutesDiff(projectStartTime, formatted);
                if (diffMins > 0) setHours((diffMins / 60).toFixed(2));
            }
        }
    };

    // --- DAILY LOG LOGIC ---
    const [dailyLog, setDailyLog] = useState<{
        start_time: string;
        end_time: string;
        break_start: string;
        break_end: string;
        segments: TimeSegment[];
    }>({ start_time: '', end_time: '', break_start: '', break_end: '', segments: [] });

    const isUserChange = useRef(false);

    useEffect(() => {
        const log = getLogForDate(date);
        let segments = log.segments || [];
        if (segments.length === 0) {
            if (log.start_time) segments.push({ id: crypto.randomUUID(), type: 'work', start: log.start_time, end: log.end_time || '', note: '' });
            if (log.break_start) segments.push({ id: crypto.randomUUID(), type: 'break', start: log.break_start, end: log.break_end || '', note: '' });
        }

        const newLog = {
            start_time: log.start_time || '',
            end_time: log.end_time || '',
            break_start: log.break_start || '',
            break_end: log.break_end || '',
            segments: segments
        };

        setDailyLog(prev => {
            if (JSON.stringify(prev) !== JSON.stringify(newLog)) return newLog;
            return prev;
        });
    }, [date, getLogForDate]);

    useEffect(() => {
        if (!isUserChange.current) return;
        const timer = setTimeout(() => {
            const firstWork = dailyLog.segments.find(s => s.type === 'work');
            const firstBreak = dailyLog.segments.find(s => s.type === 'break');
            saveDailyLog({
                ...dailyLog,
                date,
                start_time: firstWork ? firstWork.start : '',
                end_time: firstWork ? firstWork.end : '',
                break_start: firstBreak ? firstBreak.start : '',
                break_end: firstBreak ? firstBreak.end : ''
            });
            isUserChange.current = false;
        }, 800);
        return () => clearTimeout(timer);
    }, [dailyLog, date, saveDailyLog]);

    const addSegment = (type: 'work' | 'break') => {
        isUserChange.current = true;
        setDailyLog(prev => ({
            ...prev,
            segments: [...prev.segments, { id: crypto.randomUUID(), type, start: '', end: '', note: '' }]
        }));
    };

    const removeSegment = (id: string) => {
        isUserChange.current = true;
        setDailyLog(prev => ({
            ...prev,
            segments: prev.segments.filter(s => s.id !== id)
        }));
    };

    const updateSegment = (id: string, field: 'start' | 'end' | 'note', value: string) => {
        isUserChange.current = true;
        setDailyLog(prev => ({
            ...prev,
            segments: prev.segments.map(s => s.id === id ? { ...s, [field]: value } : s)
        }));
    };

    // --- TIMER LOGIC (START / STOP) ---
    const getCurrentTimeStr = () => new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    const activeTimerSegment = dailyLog.segments.find(s => s.type === 'work' && s.start && !s.end);

    const handleToggleTimer = () => {
        isUserChange.current = true;
        const now = getCurrentTimeStr();

        if (activeTimerSegment) {
            // STOP
            setDailyLog(prev => ({
                ...prev,
                segments: prev.segments.map(s => s.id === activeTimerSegment.id ? { ...s, end: now } : s)
            }));
        } else {
            // START
            setDailyLog(prev => ({
                ...prev,
                segments: [...prev.segments, { id: crypto.randomUUID(), type: 'work', start: now, end: '', note: '' }]
            }));
        }
    };

    // --- OVERLAP LOGIC ---
    const calculateOverlap = (start1: string, end1: string, start2: string, end2: string) => {
        if (!start1 || !end1 || !start2 || !end2) return 0;

        const toMinutes = (s: string) => {
            const [h, m] = s.split(':').map(Number);
            return h * 60 + m;
        };

        const s1 = toMinutes(start1);
        const e1 = toMinutes(end1);
        const s2 = toMinutes(start2);
        const e2 = toMinutes(end2);

        const start = Math.max(s1, s2);
        const end = Math.min(e1, e2);

        return Math.max(0, end - start);
    };

    const confirmOverlap = async () => {
        const { overlappedEntries, newEntryData } = overlapWarning;
        setIsSubmitting(true);

        try {
            // 1. Update overlapped entries (reduce hours)
            for (const { entry, overlapMinutes } of overlappedEntries) {
                const overlapHours = overlapMinutes / 60;
                // Ensure we don't go negative, though logic shouldn't allow it if calculated correctly
                const newHours = Math.max(0, parseFloat((entry.hours - overlapHours).toFixed(2)));

                // Use the service hook instead of direct supabase call
                await updateEntry(entry.id, { hours: newHours });
            }

            // 2. Add the new entry (The Break)
            if (newEntryData) {
                await addEntry(newEntryData);
            }

            // Reset
            setOverlapWarning({ isOpen: false, overlappedEntries: [], newEntryData: null });
            finishSubmit();

        } catch (err) {
            console.error("Fehler beim Speichern der Überlappung:", err);
            // Optional: Show user feedback
            setIsSubmitting(false);
            alert("Fehler beim Speichern. Bitte Konsole prüfen.");
        }
    };

    const finishSubmit = () => {
        const isAbsence = ['vacation', 'sick', 'holiday', 'unpaid'].includes(entryType);

        if (projectEndTime && !isAbsence) {
            setProjectStartTime(projectEndTime);
        }

        setClient('');
        if (isAbsence) {
            setEntryType('work');
            if (!projectEndTime) {
                setProjectStartTime(getSuggestedStartTime());
            }
        }
        setHours('');
        setNote('');
        setProjectEndTime('');
        setResponsibleUserId('');
        setSurcharge(0);
        setLateEntryWarning({ isOpen: false, diffDays: 0, reason: '' }); // Reset Late Warning
        setIsSubmitting(false);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const isAbsence = ['vacation', 'sick', 'holiday', 'unpaid'].includes(entryType);

        if (!client || (!isAbsence && !hours)) return;

        // Determine Responsible User for Late Entry
        let finalResponsibleUserId = isLateEntry ? undefined : (responsibleUserId || undefined);

        if (isLateEntry && settings.department_id) {
            const myDept = departments.find(d => d.id === settings.department_id);
            if (myDept) {
                if (myDept.is_substitute_active && myDept.retro_substitute_user_id) {
                    finalResponsibleUserId = myDept.retro_substitute_user_id;
                } else if (myDept.retro_responsible_user_id) {
                    finalResponsibleUserId = myDept.retro_responsible_user_id;
                }
            }
        }

        // Prepare Data
        const entryData = {
            date: date,
            client_name: client,
            hours: parseFloat(hours.replace(',', '.')),
            start_time: projectStartTime || undefined,
            end_time: projectEndTime || undefined,
            note: note || undefined,
            type: entryType as any,
            responsible_user_id: finalResponsibleUserId,
            surcharge: entryType === 'emergency_service' ? surcharge : undefined,
            late_reason: isLateEntry ? lateReason : (lateEntryWarning.reason || undefined)
        };


        // --- CHECK LATE ENTRY ---
        // If we haven't already confirmed the reason (isOpen is false check usually implies we are in initial submit, 
        // but here we might need a flag or check if reason is empty but required)

        const today = new Date();
        const entryDate = new Date(date);
        const diffDays = differenceInCalendarDays(today, entryDate);

        // If > 2 days and no reason provided yet (or modal not open), TRIGGER MODAL
        // If we have an inline reason, we pass it to the modal for confirmation
        if (diffDays > 2 && !lateEntryWarning.isOpen) {
            // If called from Modal Button (isOpen=true), we skip this and proceed to Save.
            // If called from Form Submit, we enter here.

            setLateEntryWarning({ isOpen: true, diffDays, reason: lateReason || '' });
            return; // STOP and show modal
        }

        // --- AZUBI CONFIRMATION CHECK ---
        // Azubis MUST select a coworker for 'work' and 'break' entries
        // --- AZUBI CONFIRMATION CHECK ---
        // Azubis MUST select a coworker for 'work' and 'break' entries
        if (settings.role === 'azubi' && (entryType === 'work' || entryType === 'break') && !responsibleUserId) {
            setShowAzubiInstallerModal(true);
            return;
        }


        // --- CHECK OVERLAP IF ADDING BREAK ---
        if (entryType === 'break' && projectStartTime && projectEndTime) {
            // Check against existing WORK entries
            const workEntries = entries.filter(ent =>
                ent.date === date &&
                ent.type === 'work' &&
                ent.start_time && ent.end_time
            );

            const overlaps = workEntries.map(work => {
                const mins = calculateOverlap(projectStartTime, projectEndTime, work.start_time!, work.end_time!);
                return { entry: work, overlapMinutes: mins };
            }).filter(o => o.overlapMinutes > 0);

            if (overlaps.length > 0) {
                setOverlapWarning({
                    isOpen: true,
                    overlappedEntries: overlaps,
                    newEntryData: entryData
                });
                return; // STOP HERE, wait for confirmation
            }
        }

        // --- CHECK OVERLAP IF ADDING WORK (OVER EXISTING BREAK) ---
        // (Optional/Inverse case: User adds Work over existing Break -> should we reduce Work hours?
        // Requirement says: "wenn eine Pause über einen weiteren Projekt eintrag drüber gelegt wird"
        // This implies Action = Adding Break.
        // It doesn't explicitly mention adding Work over Break, but good UX might handle it.
        // For now, let's stick to the EXPLICIT requirement: Adding Break reduces Project.

        setIsSubmitting(true);

        if (isAbsence) {
            await addAbsence({
                start_date: date,
                end_date: date,
                type: entryType as any,
                note: note || undefined
            });
        } else {
            if (editingEntryId) {
                // Update existing
                await updateEntry(editingEntryId, entryData);
                setEditingEntryId(null);
            } else {
                // Create new
                await addEntry(entryData);
            }
        }

        finishSubmit();
    };

    const setToday = () => setDate(getLocalISOString());
    const setYesterday = () => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        setDate(getLocalISOString(d));
    };

    // --- REJECTED ENTRY HANDLER ---
    // --- REJECTED ENTRY HANDLER ---
    const handleEditRejected = (entry: TimeEntry) => {
        // Old logic: setEditingEntryId(entry.id); setDate(entry.date); ...
        // New logic: Open Correction Modal
        setCorrectionModal({
            isOpen: true,
            entry: entry,
            form: {
                hours: entry.hours.toString().replace('.', ','),
                start: entry.start_time || '',
                end: entry.end_time || '',
                note: entry.note || '',
                client_name: entry.client_name || '',
                late_reason: entry.late_reason || '' // Allow editing if it was late
            }
        });
    };

    const handleSaveCorrection = async () => {
        if (!correctionModal.entry) return;

        setIsSubmitting(true);
        const { entry, form } = correctionModal;

        const updates = {
            hours: parseFloat(form.hours.replace(',', '.')),
            start_time: form.start || null,
            end_time: form.end || null,
            note: form.note || null,
            client_name: form.client_name || 'Projekt',
            late_reason: form.late_reason || null,
            // Reset rejection status is handled by updateEntry in dataService
        };

        await updateEntry(entry.id, updates);

        setIsSubmitting(false);
        setCorrectionModal({ isOpen: false, entry: null, form: {} });

        // Show success toast or similar (optional, but updateEntry usually updates list automatically)
    };



    const dateObj = new Date(date);
    const displayDate = dateObj.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

    // UI Helpers based on Entry Type
    const getTypeColor = () => {
        switch (entryType) {
            case 'break': return 'text-orange-300 border-orange-500/30 bg-orange-900/10';
            case 'company': return 'text-blue-300 border-blue-500/30 bg-blue-900/10';
            case 'office': return 'text-purple-300 border-purple-500/30 bg-purple-900/10';
            case 'warehouse': return 'text-amber-300 border-amber-500/30 bg-amber-900/10';
            case 'car': return 'text-gray-300 border-gray-500/30 bg-gray-800/30';
            case 'vacation': return 'text-purple-300 border-purple-500/30 bg-purple-900/10';
            case 'sick': return 'text-red-300 border-red-500/30 bg-red-900/10';
            case 'holiday': return 'text-blue-300 border-blue-500/30 bg-blue-900/10';
            case 'unpaid': return 'text-gray-300 border-gray-500/30 bg-gray-800/30';
            case 'overtime_reduction': return 'text-pink-300 border-pink-500/30 bg-pink-900/10';
            case 'emergency_service': return 'text-rose-300 border-rose-500/30 bg-rose-900/10';
            default: return 'text-emerald-300';
        }
    };

    const getTypeIcon = () => {
        switch (entryType) {
            case 'break': return <Coffee size={20} />;
            case 'company': return <Building2 size={20} />;
            case 'office': return <Building size={20} />;
            case 'warehouse': return <Warehouse size={20} />;
            case 'car': return <Car size={20} />;
            case 'vacation': return <Palmtree size={20} />;
            case 'sick': return <Stethoscope size={20} />;
            case 'holiday': return <PartyPopper size={20} />;
            case 'unpaid': return <Ban size={20} />;
            case 'overtime_reduction': return <PiggyBank size={20} />;
            case 'emergency_service': return <Siren size={20} />;
            default: return <Briefcase size={20} />;
        }
    };

    const getButtonGradient = () => {
        switch (entryType) {
            case 'break': return '!bg-gradient-to-r !from-orange-500/80 !to-red-600/80 !shadow-orange-900/20';
            case 'company': return '!bg-gradient-to-r !from-blue-500/80 !to-cyan-600/80 !shadow-blue-900/20';
            case 'office': return '!bg-gradient-to-r !from-purple-500/80 !to-indigo-600/80 !shadow-purple-900/20';
            case 'warehouse': return '!bg-gradient-to-r !from-amber-500/80 !to-yellow-600/80 !shadow-amber-900/20';
            case 'car': return '!bg-gradient-to-r !from-gray-500/80 !to-gray-600/80 !shadow-gray-900/20';
            case 'vacation': return '!bg-gradient-to-r !from-purple-500/80 !to-pink-600/80 !shadow-purple-900/20';
            case 'sick': return '!bg-gradient-to-r !from-red-500/80 !to-rose-600/80 !shadow-red-900/20';
            case 'holiday': return '!bg-gradient-to-r !from-blue-500/80 !to-sky-600/80 !shadow-blue-900/20';
            case 'unpaid': return '!bg-gradient-to-r !from-gray-600/80 !to-slate-700/80 !shadow-gray-900/20';
            case 'overtime_reduction': return '!bg-gradient-to-r !from-pink-500/80 !to-rose-600/80 !shadow-pink-900/20';
            case 'emergency_service': return '!bg-gradient-to-r !from-rose-600/80 !to-red-700/80 !shadow-red-900/30';
            default: return 'shadow-teal-900/20';
        }
    };

    return (
        <div className="p-6 flex flex-col h-full pb-24 overflow-y-auto md:max-w-5xl md:mx-auto md:w-full md:justify-center">
            <header className="mt-6 mb-6 md:mb-10 md:text-center">
                <h1 className="text-2xl md:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-white/70">
                    Hallo, {settings.display_name}
                </h1>
                <p className="text-white/50 text-sm md:text-lg mt-1">Erfasse deine Arbeitszeit schnell und einfach.</p>
            </header>

            {/* DEACTIVATED ACCOUNT BANNER */}
            {settings?.is_active === false && (
                <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-4 animate-in slide-in-from-top-2">
                    <div className="p-3 bg-red-500/20 rounded-full text-red-400">
                        <Ban size={24} />
                    </div>
                    <div>
                        <h3 className="text-red-300 font-bold text-base">Account deaktiviert</h3>
                        <p className="text-red-200/70 text-sm">
                            Dein Account wurde deaktiviert. Du kannst keine neuen Einträge erstellen oder bearbeiten.
                        </p>
                    </div>
                </div>
            )}

            {/* PENDING NOTIFICATION BANNER (Trigger to re-open modal) */}
            {pendingQuotaNotifications.length > 0 && !isNotificationModalOpen && (
                <button
                    onClick={() => setIsNotificationModalOpen(true)}
                    className="mb-4 w-full bg-purple-500/10 border border-purple-500/20 p-3 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-top-2 hover:bg-purple-500/20 transition-colors group"
                >
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center ring-1 ring-purple-500/30 group-hover:bg-purple-500/30 transition-colors">
                            <Palmtree size={20} className="text-purple-300" />
                            <div className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-gray-900"></div>
                        </div>
                        <div className="text-left">
                            <div className="text-sm font-bold text-white flex items-center gap-2">
                                Urlaubsanspruch
                                <span className="bg-purple-500/20 text-purple-200 text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider">Neu</span>
                            </div>
                            <div className="text-xs text-white/50">Bitte neuen Anspruch bestätigen</div>
                        </div>
                    </div>
                    <div className="bg-purple-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-lg shadow-purple-900/20 group-hover:scale-105 transition-transform">
                        Ansehen
                    </div>
                </button>
            )}

            {/* NEW: PERSISTENT ENTRY NOTIFICATIONS (Replacing Modal) */}
            {/* NEW: PERSISTENT ENTRY NOTIFICATIONS (Replacing Modal) */}
            {entryNotifications.length > 0 && (
                <div className="mb-6 space-y-4 animate-in slide-in-from-top-2">
                    {entryNotifications.map(entry => {
                        const isLegacyDeletion = entry.is_deleted;
                        const isDeletionRequest = !!entry.deletion_requested_at;
                        const isDel = isLegacyDeletion || isDeletionRequest;

                        const dateStr = new Date(entry.date).toLocaleDateString('de-DE');
                        const reason = isDeletionRequest ? entry.deletion_request_reason : (isLegacyDeletion ? entry.deletion_reason : entry.change_reason);

                        return (
                            <GlassCard key={entry.id} className={`!p-4 border ${isDel ? 'bg-red-900/10 border-red-500/30' : 'bg-orange-900/10 border-orange-500/30'}`}>
                                <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Info size={16} className={isDel ? "text-red-400" : "text-orange-400"} />
                                            <span className={`text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${isDel ? 'bg-red-500/20 text-red-300' : 'bg-orange-500/20 text-orange-300'}`}>
                                                {isDel ? 'Löschung' : 'Änderung'}
                                            </span>
                                            <span className="text-white/50 text-xs">wartet auf Bestätigung</span>
                                        </div>
                                        <div className="text-white font-bold text-lg">{entry.client_name}</div>
                                        <div className="text-white/60 text-sm mb-2">{dateStr}</div>

                                        <div className="bg-black/20 p-2 rounded text-sm text-white/80 italic border border-white/5">
                                            "{reason || 'Kein Grund angegeben'}"
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-end w-full md:w-auto gap-2">
                                        {!isDel && (
                                            <button
                                                onClick={() => {
                                                    alert("Um Details zu sehen oder abzulehnen, nutze bitte das 'Verlauf'-Symbol direkt am Eintrag unten.");
                                                }}
                                                className="flex items-center gap-2 px-3 py-2 rounded-lg font-bold text-xs bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
                                            >
                                                <Info size={14} /> Details / Ablehnen
                                            </button>
                                        )}
                                        {isDeletionRequest && (
                                            <button
                                                onClick={async () => {
                                                    // REJECT DELETION REQUEST
                                                    const { error } = await supabase.from('time_entries').update({
                                                        deletion_requested_at: null,
                                                        deletion_requested_by: null,
                                                        deletion_request_reason: null
                                                    }).eq('id', entry.id);

                                                    if (!error) {
                                                        setEntryNotifications(prev => prev.filter(e => e.id !== entry.id));
                                                    } else {
                                                        alert("Fehler beim Ablehnen: " + error.message);
                                                    }
                                                }}
                                                className="flex items-center gap-2 px-3 py-2 rounded-lg font-bold text-xs bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
                                            >
                                                <XCircle size={14} /> Behalten (Ablehnen)
                                            </button>
                                        )}
                                        <button
                                            onClick={() => confirmEntryNotification(entry)}
                                            className={`
                                                flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm shadow-lg transition-all hover:scale-105 active:scale-95
                                                ${isDel
                                                    ? 'bg-red-500/20 text-red-100 border border-red-500/30 hover:bg-red-500/30'
                                                    : 'bg-orange-500/20 text-orange-100 border border-orange-500/30 hover:bg-orange-500/30'}
                                            `}
                                        >
                                            <CheckCircle size={16} />
                                            {isDel ? 'Löschen bestätigen' : 'Bestätigen'}
                                        </button>
                                    </div>
                                </div>
                            </GlassCard>
                        );
                    })}
                </div>
            )}

            {/* CORRECTION MODAL */}
            {correctionModal.isOpen && correctionModal.entry && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <GlassCard className="w-full max-w-lg border-red-500/50 shadow-2xl relative bg-gray-900/95 overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-red-900/20 to-transparent">
                            <div className="flex items-center gap-3">
                                <RefreshCw className="text-red-400" size={24} />
                                <div>
                                    <h2 className="text-lg font-bold text-white">Eintrag korrigieren</h2>
                                    <p className="text-xs text-white/50">{new Date(correctionModal.entry.date).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                                </div>
                            </div>
                            <button onClick={() => setCorrectionModal({ isOpen: false, entry: null, form: {} })} className="p-2 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-6">
                            {/* Rejection Reason Display */}
                            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex gap-3 items-start">
                                <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={20} />
                                <div>
                                    <span className="text-xs font-bold text-red-300 uppercase tracking-wider block mb-1">Ablehnungsgrund</span>
                                    <p className="text-white italic">"{correctionModal.entry.rejection_reason}"</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-white/60 uppercase mb-1.5 ml-1">Kunde / Projekt</label>
                                    <GlassInput
                                        value={correctionModal.form.client_name}
                                        onChange={e => setCorrectionModal(prev => ({ ...prev, form: { ...prev.form, client_name: e.target.value } }))}
                                        placeholder="Kunde..."
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-white/60 uppercase mb-1.5 ml-1">Von</label>
                                        <GlassInput
                                            type="time"
                                            value={correctionModal.form.start}
                                            onChange={e => setCorrectionModal(prev => ({ ...prev, form: { ...prev.form, start: e.target.value } }))}
                                            className="text-center"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-white/60 uppercase mb-1.5 ml-1">Bis</label>
                                        <GlassInput
                                            type="time"
                                            value={correctionModal.form.end}
                                            onChange={e => setCorrectionModal(prev => ({ ...prev, form: { ...prev.form, end: e.target.value } }))}
                                            className="text-center"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-white/60 uppercase mb-1.5 ml-1">Stunden (Gesamt)</label>
                                    <GlassInput
                                        type="number"
                                        step="0.25"
                                        value={correctionModal.form.hours}
                                        onChange={e => {
                                            const newHours = e.target.value;
                                            setCorrectionModal(prev => {
                                                const start = prev.form.start;
                                                let newEnd = prev.form.end;

                                                if (start && newHours) {
                                                    const h = parseFloat(newHours);
                                                    if (!isNaN(h)) {
                                                        const [hours, minutes] = start.split(':').map(Number);
                                                        const date = new Date();
                                                        date.setHours(hours, minutes, 0, 0);
                                                        date.setMinutes(date.getMinutes() + (h * 60));
                                                        newEnd = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                                                    }
                                                }

                                                return { ...prev, form: { ...prev.form, hours: newHours, end: newEnd } };
                                            });
                                        }}
                                        className="text-center font-bold text-lg text-emerald-400"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-white/60 uppercase mb-1.5 ml-1">Notiz</label>
                                    <textarea
                                        value={correctionModal.form.note}
                                        onChange={e => setCorrectionModal(prev => ({ ...prev, form: { ...prev.form, note: e.target.value } }))}
                                        className="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-white focus:border-teal-500/50 outline-none resize-none h-24 text-sm"
                                        placeholder="Notiz zur Arbeit..."
                                    />
                                </div>

                                {correctionModal.form.late_reason && (
                                    <div>
                                        <label className="block text-xs font-bold text-orange-400/80 uppercase mb-1.5 ml-1">Grund für Verspätung</label>
                                        <GlassInput
                                            value={correctionModal.form.late_reason}
                                            onChange={e => setCorrectionModal(prev => ({ ...prev, form: { ...prev.form, late_reason: e.target.value } }))}
                                            className="border-orange-500/30 text-orange-200"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="p-4 border-t border-white/10 bg-black/40 flex justify-end gap-3 sticky bottom-0">
                            <button
                                onClick={() => setCorrectionModal({ isOpen: false, entry: null, form: {} })}
                                className="px-5 py-2.5 rounded-xl border border-white/10 text-white/60 hover:bg-white/5 font-bold transition-all"
                            >
                                Abbrechen
                            </button>
                            <button
                                onClick={handleSaveCorrection}
                                disabled={isSubmitting}
                                className="px-8 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 text-white font-bold shadow-lg shadow-red-900/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <div className="flex items-center gap-2"><Send size={18} /> Korrektur senden</div>}
                            </button>
                        </div>
                    </GlassCard>
                </div>
            )}

            {/* REJECTED ENTRIES NOTIFICATIONS */}
            {rejectedEntries.length > 0 && (
                <div className="mb-6 space-y-4 animate-in slide-in-from-top-2">
                    {rejectedEntries.map(entry => {
                        const dateStr = new Date(entry.date).toLocaleDateString('de-DE');
                        const safeType = entry.type || 'work';
                        const conf = ENTRY_TYPES_CONFIG[safeType];
                        const Icon = conf.icon;

                        return (
                            <GlassCard key={entry.id} className="!p-4 border bg-red-900/10 border-red-500/30">
                                <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <AlertCircle size={16} className="text-red-400" />
                                            <span className="text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">
                                                Abgelehnt
                                            </span>
                                            <span className="text-white/50 text-xs">Bitte korrigieren</span>
                                        </div>
                                        <div className="text-white font-bold text-lg flex items-center gap-2">
                                            <Icon size={18} className={conf.color} />
                                            {entry.client_name}
                                        </div>
                                        <div className="text-white/60 text-sm mb-2">{dateStr} • {formatDuration(entry.hours)} h</div>

                                        {entry.rejection_reason && (
                                            <div className="bg-black/20 p-2 rounded text-sm text-white/80 italic border border-white/5">
                                                "Grund: {entry.rejection_reason}"
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-center justify-end w-full md:w-auto gap-2">
                                        <button
                                            onClick={() => handleEditRejected(entry)}
                                            className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm bg-red-500/20 text-red-100 border border-red-500/30 hover:bg-red-500/30 shadow-lg transition-all hover:scale-105 active:scale-95"
                                        >
                                            <RefreshCw size={16} />
                                            Korrigieren
                                        </button>
                                    </div>
                                </div>
                            </GlassCard>
                        );
                    })}
                </div>
            )}

            {/* HOLIDAY SPECIAL NOTICE */}
            {(() => {
                const d = new Date(date);
                const isSpecial = d.getMonth() === 11 && (d.getDate() === 24 || d.getDate() === 31);
                const isWeekday = d.getDay() >= 1 && d.getDay() <= 5;
                if (isSpecial && isWeekday) {
                    return (
                        <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-teal-900/40 to-emerald-900/40 border border-teal-500/30 flex items-center gap-4 animate-in slide-in-from-top-2">
                            <div className="p-3 bg-teal-500/20 rounded-full text-teal-300">
                                <PartyPopper size={24} />
                            </div>
                            <div>
                                <h3 className="text-teal-200 font-bold text-sm md:text-base">Sonderregelung {d.getDate()}.12.</h3>
                                <p className="text-teal-100/70 text-xs md:text-sm">
                                    Heute gilt: Halber Arbeitstag & halber Tag Sonderurlaub gutgeschrieben! 🎄🎆
                                </p>
                            </div>
                        </div>
                    );
                }
                return null;
            })()}

            {/* --- LATE ENTRY WARNING MODAL --- */}
            {lateEntryWarning.isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <GlassCard className="w-full max-w-lg border-red-500/50 shadow-2xl relative bg-gray-900/90">
                        <div className="p-4 border-b border-white/10 flex items-center gap-3">
                            <ShieldAlert className="text-red-400" size={24} />
                            <h2 className="text-lg font-bold text-white">Verspäteter Eintrag</h2>
                        </div>
                        <div className="p-4 space-y-4">
                            <p className="text-white/80">
                                Du trägst Zeiten für den <strong>{new Date(date).toLocaleDateString('de-DE')}</strong> nach ({lateEntryWarning.diffDays} Tage zurück).
                                <br />
                                <span className="text-red-300 text-sm">Einträge, die älter als 2 Tage sind, müssen vom Büro bestätigt werden.</span>
                            </p>

                            <div>
                                <label className="text-xs uppercase font-bold text-white/50 block mb-2">Begründung (Pflicht)</label>
                                {lateReason ? (
                                    <div className="bg-white/10 p-3 rounded-lg border border-white/10 text-white italic">
                                        "{lateEntryWarning.reason}"
                                    </div>
                                ) : (
                                    <textarea
                                        value={lateEntryWarning.reason}
                                        onChange={(e) => setLateEntryWarning(prev => ({ ...prev, reason: e.target.value }))}
                                        placeholder="Warum erfolgt der Eintrag erst jetzt?"
                                        className="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-white focus:border-red-500/50 outline-none resize-none h-24"
                                    />
                                )}
                            </div>
                        </div>
                        <div className="p-4 border-t border-white/10 flex gap-3">
                            <button
                                onClick={() => setLateEntryWarning({ isOpen: false, diffDays: 0, reason: '' })}
                                className="flex-1 py-2 rounded-lg border border-white/10 text-white/60 hover:bg-white/5"
                            >
                                Abbrechen
                            </button>
                            <button
                                onClick={handleSubmit} // Re-trigger submit
                                disabled={!lateEntryWarning.reason.trim()}
                                className="flex-1 py-2 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold shadow-lg shadow-red-900/20"
                            >
                                {lateReason ? 'Bestätigen & Speichern' : 'Mit Begründung speichern'}
                            </button>
                        </div>
                    </GlassCard>
                </div>
            )}

            {/* --- AZUBI INSTALLER SELECTION MODAL --- */}
            {showAzubiInstallerModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <GlassCard className="w-full max-w-lg border-teal-500/50 shadow-2xl relative bg-gray-900/90 max-h-[80vh] flex flex-col">
                        <div className="p-4 border-b border-white/10 flex items-center gap-3 shrink-0">
                            <UserCheck className="text-teal-400" size={24} />
                            <h2 className="text-lg font-bold text-white">Mitarbeiter auswählen</h2>
                        </div>
                        <div className="p-4 overflow-y-auto">
                            <p className="text-white/80 mb-4 text-sm">
                                Als Azubi muss deine Zeit von einem Mitarbeiter bestätigt werden. Bitte wähle aus, wer diesen Eintrag prüfen soll.
                            </p>

                            <div className="space-y-2">
                                {installers.filter(i => i.user_id !== settings.user_id && (i.is_visible_to_others !== false || settings.role === 'admin' || settings.role === 'office')).map(installer => (
                                    <button
                                        key={installer.user_id}
                                        onClick={() => {
                                            setResponsibleUserId(installer.user_id!);
                                            localStorage.setItem('lastResponsibleUserId', installer.user_id!);
                                            setShowAzubiInstallerModal(false);
                                            // Optional: Auto-Update state so next click on submit works, or trigger submit?
                                            // Ideally we just close it and let them click "Erfassen" again, or we could trigger it.
                                            // But since handleSubmit uses state, we can't easily re-call it with updated state immediately in one tick without a ref or useEffect.
                                            // The simplest/safest way is to close modal, update state, and let them click big button again (visual feedback: button now shows user).
                                        }}
                                        className="w-full text-left px-4 py-3 rounded-lg bg-white/5 border border-white/10 hover:bg-teal-500/10 hover:border-teal-500/30 transition-all flex items-center justify-between group"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/70 group-hover:bg-teal-500/20 group-hover:text-teal-300 transition-colors">
                                                {installer.display_name.charAt(0)}
                                            </div>
                                            <span className="text-white font-medium group-hover:text-teal-200 transition-colors">{installer.display_name}</span>
                                        </div>
                                        <ChevronRight size={16} className="text-white/20 group-hover:text-teal-400 opacity-0 group-hover:opacity-100 transition-all" />
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="p-4 border-t border-white/10 shrink-0">
                            <button
                                onClick={() => setShowAzubiInstallerModal(false)}
                                className="w-full py-3 rounded-lg border border-white/10 text-white/60 hover:bg-white/5 font-bold transition-colors"
                            >
                                Abbrechen
                            </button>
                        </div>
                    </GlassCard>
                </div>
            )}

            {/* --- OVERLAP WARNING MODAL --- */}
            {overlapWarning.isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <GlassCard className="w-full max-w-lg border-orange-500/50 shadow-2xl relative bg-gray-900/90">
                        <div className="p-4 border-b border-white/10 flex items-center gap-3">
                            <AlertCircle className="text-orange-400" size={24} />
                            <h2 className="text-lg font-bold text-white">Pause überschneidet Projekt</h2>
                        </div>
                        <div className="p-4 space-y-4">
                            <p className="text-white/80">
                                Die eingetragene Pause überschneidet sich mit folgenden Projekteinträgen:
                            </p>
                            <div className="space-y-2">
                                {overlapWarning.overlappedEntries.map((o, idx) => (
                                    <div key={idx} className="bg-white/5 border border-white/10 p-3 rounded-lg flex justify-between items-center">
                                        <div>
                                            <div className="text-white font-bold">{o.entry.client_name}</div>
                                            <div className="text-xs text-white/50">{o.entry.start_time} - {o.entry.end_time}</div>
                                        </div>
                                        <div className="text-orange-300 font-mono font-bold">
                                            -{(o.overlapMinutes / 60).toFixed(2)}h
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="bg-orange-900/20 border border-orange-500/20 p-3 rounded-lg text-sm text-orange-200">
                                Soll die Arbeitszeit dieser Projekte automatisch um die Pausenzeit gekürzt werden?
                            </div>
                        </div>
                        <div className="p-4 border-t border-white/10 flex gap-3">
                            <button
                                onClick={() => setOverlapWarning({ isOpen: false, overlappedEntries: [], newEntryData: null })}
                                className="flex-1 py-2 rounded-lg border border-white/10 text-white/60 hover:bg-white/5"
                            >
                                Abbrechen
                            </button>
                            <button
                                onClick={confirmOverlap}
                                className="flex-1 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-bold shadow-lg shadow-orange-900/20"
                            >
                                Ja, kürzen & Speichern
                            </button>
                        </div>
                    </GlassCard>
                </div>
            )}

            {/* --- NEU: EINGEHENDE BESTÄTIGUNGEN --- */}
            {pendingReviews.length > 0 && (
                <div className="mb-6 w-full max-w-5xl mx-auto animate-in slide-in-from-top-4 duration-300">
                    <GlassCard className="!border-orange-500/30 bg-orange-900/10 !p-4">
                        <div className="flex items-center gap-2 text-orange-400 font-bold uppercase text-xs tracking-wider mb-3">
                            <AlertCircle size={16} /> Mitarbeiter-Bestätigungen ausstehend ({pendingReviews.length})
                        </div>
                        <div className="space-y-2">
                            {pendingReviews.map(review => {
                                // Finde den Namen des Mitarbeiters
                                const requester = installers.find(u => u.user_id === review.user_id);

                                return (
                                    <div key={review.id} className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col gap-2">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                {/* ANZEIGE DES MITARBEITER-NAMENS */}
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-[10px] uppercase font-bold text-teal-400 bg-teal-900/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                                                        <User size={10} /> {requester?.display_name || 'Unbekannt'}
                                                    </span>
                                                </div>
                                                <div className="font-bold text-white text-sm">{review.client_name}</div>
                                                <div className="text-xs text-white/50">{new Date(review.date).toLocaleDateString('de-DE')} • {review.hours.toFixed(2)}h</div>
                                                {review.note && <div className="text-xs text-white/40 italic mt-1">"{review.note}"</div>}
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setRejectingEntryId(review.id)}
                                                    className="p-2 bg-red-500/20 text-red-300 rounded-lg hover:bg-red-500/30 transition-colors"
                                                    title="Ablehnen"
                                                >
                                                    <X size={16} />
                                                </button>
                                                <button
                                                    onClick={() => processReview(review.id, 'confirm')}
                                                    className="p-2 bg-emerald-500/20 text-emerald-300 rounded-lg hover:bg-emerald-500/30 transition-colors"
                                                    title="Bestätigen"
                                                >
                                                    <Check size={16} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Reject Reason Input */}
                                        {rejectingEntryId === review.id && (
                                            <div className="mt-2 flex gap-2 animate-in fade-in">
                                                <input
                                                    type="text"
                                                    placeholder="Grund für Ablehnung..."
                                                    value={rejectionReason}
                                                    onChange={(e) => setRejectionReason(e.target.value)}
                                                    className="flex-1 bg-black/20 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-red-500/50"
                                                />
                                                <button
                                                    onClick={() => { processReview(review.id, 'reject', rejectionReason); setRejectingEntryId(null); setRejectionReason(''); }}
                                                    className="px-3 py-1 bg-red-500 text-white text-xs font-bold rounded hover:bg-red-600"
                                                >
                                                    Senden
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </GlassCard>
                </div>
            )}

            <div className="flex flex-col md:grid md:grid-cols-12 gap-6 md:gap-8 items-start">

                {/* 1. DATUM */}
                <div className="order-1 md:col-span-5 lg:col-span-4 space-y-6 w-full">
                    <GlassCard className="space-y-4 border-teal-500/40 shadow-[0_0_25px_-5px_rgba(20,184,166,0.3)] bg-white/15">
                        <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center space-x-2 text-teal-300">
                                <CalendarDays size={20} />
                                <span className="font-bold uppercase text-xs tracking-wider">Datum wählen</span>
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={setYesterday} className="text-[10px] bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md text-white transition-colors font-medium">
                                    Gestern
                                </button>
                                <button type="button" onClick={setToday} className="text-[10px] bg-teal-500/20 hover:bg-teal-500/40 text-teal-200 px-3 py-1.5 rounded-md transition-colors border border-teal-500/30 font-medium">
                                    Heute
                                </button>
                            </div>
                        </div>

                        <div className="relative group" onClick={() => setShowDatePicker(true)}>
                            <div className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 h-14 flex items-center justify-center text-lg text-white font-semibold cursor-pointer hover:bg-white/10 hover:border-teal-500/30 transition-all shadow-inner text-center">
                                {displayDate}
                            </div>
                        </div>
                    </GlassCard>
                </div>

                {/* 2. FORM */}
                <form onSubmit={(e) => { if (settings?.is_active === false) { e.preventDefault(); return; } handleSubmit(e); }} className={`order-2 md:col-span-7 lg:col-span-8 md:row-span-2 grid gap-6 w-full ${settings?.is_active === false ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                    <GlassCard className={`space-y-4 transition-all duration-300 relative z-20 ${getTypeColor()}`}>
                        {/* LATE ENTRY WARNING & REASON */}
                        {isLateEntry && (
                            <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 mb-4 animate-in slide-in-from-top-2">
                                <div className="flex items-center gap-2 text-orange-300 font-bold text-xs uppercase mb-2">
                                    <AlertCircle size={14} />
                                    <span>Rückwirkende Erfassung</span>
                                </div>
                                <p className="text-white/70 text-xs mb-3">
                                    Dieser Eintrag liegt mehr als 2 Arbeitstage zurück. Bitte gib eine Begründung an.
                                    Der Eintrag muss von einem Administrator bestätigt werden.
                                </p>
                                <textarea
                                    className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-sm text-white focus:border-orange-500/50 outline-none resize-none"
                                    placeholder="Begründung (Pflichtfeld)..."
                                    rows={2}
                                    value={lateReason}
                                    onChange={(e) => setLateReason(e.target.value)}
                                    required
                                />
                            </div>
                        )}

                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-3">
                                {getTypeIcon()}
                                <span className="font-semibold uppercase text-xs tracking-wider">
                                    {ENTRY_TYPES_CONFIG[entryType].label}
                                </span>
                            </div>
                        </div>

                        <div className="relative z-50 flex gap-2"> {/* Increased Z-Index here */}
                            <div className="relative flex-1">
                                <GlassInput
                                    type="text"
                                    placeholder={entryType === 'overtime_reduction' ? "Bemerkung..." : "Z.B. Baustelle Müller..."}
                                    value={client}
                                    onChange={(e) => setClient(e.target.value)}
                                    required
                                    className={`h-12 md:h-14 md:text-lg pr-12 ${entryType !== 'work' && entryType !== 'emergency_service' ? 'text-white/90' : ''}`}
                                />

                                {/* Cycle Type Button with Long Press */}
                                <button
                                    type="button"
                                    onMouseDown={handleButtonDown}
                                    onMouseUp={handleButtonUp}
                                    onMouseLeave={handleButtonLeave}
                                    onTouchStart={handleButtonDown}
                                    onTouchEnd={handleButtonUp}
                                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-colors hover:bg-white/10`}
                                    title="Typ ändern (gedrückt halten für Menü)"
                                >
                                    <ArrowLeftRight size={24} />
                                </button>
                            </div>

                            {/* MITARBEITER SELECT BUTTON (NEU) */}
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => !isLateEntry && setShowInstallerMenu(!showInstallerMenu)}
                                    disabled={isLateEntry}
                                    title={isLateEntry ? "Rückwirkende Buchungen müssen vom Admin bestätigt werden." : "Mitarbeiter zur Bestätigung auswählen"}
                                    className={`h-12 md:h-14 w-12 md:w-14 rounded-xl border flex items-center justify-center transition-all 
                                        ${isLateEntry
                                            ? 'bg-gray-800/50 text-gray-500 border-gray-700/50 cursor-not-allowed' // Disabled State
                                            : responsibleUserId
                                                ? 'bg-teal-500/20 text-teal-300 border-teal-500/50 hover:bg-teal-500/30'
                                                : (settings.role === 'azubi' && (entryType === 'work' || entryType === 'break'))
                                                    ? 'bg-red-500/10 text-red-400 border-red-500/50 animate-pulse' // Visual Alert for Azubi
                                                    : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'
                                        }`}
                                >
                                    {isLateEntry ? <Lock size={20} /> : (responsibleUserId ? <UserCheck size={20} /> : <UserPlus size={20} />)}
                                </button>

                                {showInstallerMenu && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setShowInstallerMenu(false)} />
                                        <div className="absolute top-full right-0 mt-2 z-50 w-64 bg-gray-900/95 backdrop-blur-xl border border-white/20 rounded-xl p-2 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                                            <div className="text-xs font-bold text-white/50 uppercase px-2 py-1 mb-1">Mitarbeiter bestätigen lassen</div>
                                            <div className="max-h-48 overflow-y-auto">
                                                <button
                                                    type="button"
                                                    onClick={() => { setResponsibleUserId(''); setShowInstallerMenu(false); }}
                                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 ${!responsibleUserId ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5'}`}
                                                >
                                                    Keine Bestätigung (Standard)
                                                </button>
                                                {installers.filter(i => i.user_id !== settings.user_id && (i.is_visible_to_others !== false || settings.role === 'admin' || settings.role === 'office')).map(installer => (
                                                    <button
                                                        key={installer.user_id}
                                                        type="button"
                                                        onClick={() => {
                                                            const newId = installer.user_id!;
                                                            setResponsibleUserId(newId);
                                                            localStorage.setItem('lastResponsibleUserId', newId); // SAVE TO STORAGE
                                                            setShowInstallerMenu(false);
                                                        }}
                                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between ${responsibleUserId === installer.user_id ? 'bg-teal-500/20 text-teal-300' : 'text-white/70 hover:bg-white/5'}`}
                                                    >
                                                        {installer.display_name}
                                                        {responsibleUserId === installer.user_id && <Check size={14} />}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* VISUAL NAME INDICATOR */}
                            {responsibleUserId && !isLateEntry && (
                                <div className="absolute -bottom-5 right-0 text-[10px] text-teal-400 font-bold whitespace-nowrap">
                                    {installers.find(i => i.user_id === responsibleUserId)?.display_name.split(' ')[0]} ausgew.
                                </div>
                            )}

                            {/* MODAL FOR LONG PRESS (TYPE SELECT) */}
                            {showTypeMenu && (
                                <>
                                    <div className="fixed inset-0 z-40 bg-black/10" onClick={() => setShowTypeMenu(false)} />
                                    <div className="absolute top-full right-0 mt-2 z-50 w-64 bg-gray-900/95 backdrop-blur-xl border border-white/20 rounded-xl p-3 shadow-2xl animate-in slide-in-from-top-2 duration-200">
                                        <div className="flex justify-between items-center mb-2 pb-2 border-b border-white/10">
                                            <span className="text-xs font-bold text-white/50 uppercase">Typ wählen</span>
                                            <button onClick={() => setShowTypeMenu(false)} className="text-white/30 hover:text-white"><X size={14} /></button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {ENTRY_TYPE_ORDER.map(t => {
                                                const conf = ENTRY_TYPES_CONFIG[t];
                                                const Icon = conf.icon;
                                                return (
                                                    <button
                                                        key={t}
                                                        type="button"
                                                        onClick={() => handleTypeSelect(t)}
                                                        className={`flex items-center gap-2 p-2 rounded-lg text-left transition-colors ${entryType === t
                                                            ? 'bg-white/10 text-white'
                                                            : 'hover:bg-white/5 text-white/60 hover:text-white'
                                                            }`}
                                                    >
                                                        <Icon size={16} className={conf.color} />
                                                        <span className="text-xs font-bold">{conf.label.split(' / ')[0]}</span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="flex gap-4 items-center pt-2">
                            <div className="flex-1">
                                <label className="text-xs text-white/50 uppercase font-bold mb-1 block ml-1">Von</label>
                                <GlassInput
                                    type="text"
                                    placeholder="HH:MM"
                                    value={projectStartTime}
                                    onChange={(e) => handleStartTimeChange(e.target.value)}
                                    onBlur={handleStartTimeBlur}
                                    disabled={['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay'].includes(entryType)}
                                    className="text-center font-mono"
                                />
                            </div>
                            <div className="pt-6 text-white/20"><ArrowRight size={16} /></div>
                            <div className="flex-1">
                                <label className="text-xs text-white/50 uppercase font-bold mb-1 block ml-1">Bis</label>
                                <GlassInput
                                    type="text"
                                    placeholder="HH:MM"
                                    value={projectEndTime}
                                    onChange={(e) => handleEndTimeChange(e.target.value)}
                                    onBlur={handleEndTimeBlur}
                                    disabled={['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay'].includes(entryType)}
                                    className="text-center font-mono"
                                />
                            </div>
                        </div>

                        <div className="pt-2">
                            <div className="flex items-center gap-2 mb-1 ml-1">
                                <StickyNote size={12} className="text-white/40" />
                                <label className="text-xs text-white/50 uppercase font-bold">Notiz (Optional)</label>
                            </div>
                            <input
                                type="text"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="Interne Bemerkung..."
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-teal-500/50"
                            />
                        </div>
                    </GlassCard>

                    <GlassCard className="space-y-4 z-10"> {/* Explicit z-10 here */}
                        <div className="flex items-center space-x-3 text-cyan-300 mb-2">
                            <Clock size={20} />
                            <span className="font-semibold uppercase text-xs tracking-wider">Dauer (Stunden)</span>
                        </div>
                        <div className="relative">
                            <GlassInput
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={hours}
                                onChange={(e) => handleHoursChange(e.target.value)}
                                required={!['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay'].includes(entryType)}
                                disabled={['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay'].includes(entryType)}
                                className="text-3xl font-mono pl-4 h-16 tracking-widest disabled:opacity-30"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 text-sm font-medium">Std</span>
                        </div>
                    </GlassCard>

                    {/* SURCHARGE SELECTOR (ONLY FOR EMERGENCY SERVICE) */}
                    {entryType === 'emergency_service' && (
                        <GlassCard className="space-y-4 animate-in slide-in-from-top-2">
                            <div className="flex items-center space-x-3 text-rose-300 mb-2">
                                <Percent size={20} />
                                <span className="font-semibold uppercase text-xs tracking-wider">Zuschlag</span>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                {[25, 50, 100].map(val => (
                                    <button
                                        key={val}
                                        type="button"
                                        onClick={() => setSurcharge(val === surcharge ? 0 : val)}
                                        className={`py-3 rounded-xl border font-mono font-bold text-lg transition-all ${surcharge === val
                                            ? 'bg-rose-500 text-white border-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.4)]'
                                            : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:text-white'
                                            }`}
                                    >
                                        {val}%
                                    </button>
                                ))}
                            </div>
                            {hours && surcharge > 0 && !isNaN(parseFloat(hours)) && (
                                <div className="text-center text-xs text-rose-200/70 mt-2 font-mono">
                                    {hours}h + {surcharge}% = <span className="text-rose-100 font-bold ml-1 text-base">{(parseFloat(hours.replace(',', '.')) * (1 + surcharge / 100)).toFixed(2)}h</span>
                                </div>
                            )}
                        </GlassCard>
                    )}

                    <div className="pt-2 md:pt-4">
                        <GlassButton
                            type="submit"
                            disabled={isSubmitting}
                            className={`h-14 md:h-16 text-lg shadow-xl font-bold tracking-wide ${getButtonGradient()}`}
                        >
                            {isSubmitting ? 'Speichere...' :
                                editingEntryId ? 'Änderung speichern' :
                                    (entryType === 'break' ? 'Pause erfassen' :
                                        (entryType === 'overtime_reduction' ? 'Gutstunden buchen' :
                                            (entryType === 'emergency_service' ? 'Notdienst eintragen' :
                                                (['vacation', 'sick', 'holiday', 'unpaid', 'special_holiday'].includes(entryType) ? 'Abwesenheit eintragen' :
                                                    (responsibleUserId ? 'Zeit zur Prüfung senden' : 'Zeit erfassen')))))}
                        </GlassButton>
                    </div>
                </form>

                {/* 3. ARBEITSZEIT */}
                <div className="order-3 md:col-span-5 lg:col-span-4 space-y-6 w-full md:col-start-1">
                    <GlassCard className={`space-y-0 transition-all duration-300 ${settings?.is_active === false ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                        <div
                            className="flex items-center justify-between text-orange-300 cursor-pointer mb-4"
                            onClick={toggleTimeCard}
                        >
                            <div className="flex items-center space-x-2">
                                <Clock size={20} />
                                <span className="font-bold uppercase text-xs tracking-wider">Arbeitszeit</span>
                            </div>
                            <button className="text-white/50 hover:text-white transition-colors">
                                {isTimeCardCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                            </button>
                        </div>

                        {!isTimeCardCollapsed && (
                            <div className="space-y-4 animate-in slide-in-from-top-2 duration-200 fade-in">
                                {/* START / STOP BUTTON */}
                                <button
                                    onClick={handleToggleTimer}
                                    className={`w-full py-4 rounded-xl flex items-center justify-center gap-3 font-bold text-lg shadow-lg transition-all active:scale-95 ${activeTimerSegment
                                        ? 'bg-red-500/20 text-red-200 border border-red-500/30 hover:bg-red-500/30 animate-pulse'
                                        : 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/30 hover:bg-emerald-500/30'
                                        }`}
                                >
                                    {activeTimerSegment ? (
                                        <><Square size={20} fill="currentColor" /> Stopp</>
                                    ) : (
                                        <><Play size={20} fill="currentColor" /> Start</>
                                    )}
                                </button>

                                {dailyLog.segments.map((segment) => (
                                    <div key={segment.id} className="bg-white/5 rounded-xl p-3 border border-white/5 flex flex-col gap-3 group hover:bg-white/10 transition-colors">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2 text-white/70 text-xs font-bold uppercase tracking-wider">
                                                {segment.type === 'work' ? <><Briefcase size={14} className="text-teal-300" /> Arbeitszeit</> : <><Coffee size={14} className="text-orange-300" /> Pause</>}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => removeSegment(segment.id)}
                                                className="text-white/20 hover:text-red-400 transition-colors"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                        <div className="flex gap-2 items-center">
                                            <div className="flex-1">
                                                <GlassInput
                                                    type="time"
                                                    value={segment.start}
                                                    onChange={(e) => updateSegment(segment.id, 'start', e.target.value)}
                                                    className="!py-2 !px-2 !text-sm text-center font-mono bg-black/20"
                                                />
                                            </div>
                                            <span className="text-white/30">-</span>
                                            <div className="flex-1">
                                                <GlassInput
                                                    type="time"
                                                    value={segment.end}
                                                    onChange={(e) => updateSegment(segment.id, 'end', e.target.value)}
                                                    className="!py-2 !px-2 !text-sm text-center font-mono bg-black/20"
                                                />
                                            </div>
                                        </div>
                                        <DebouncedSegmentNote
                                            initialValue={segment.note || ''}
                                            onSave={(val) => updateSegment(segment.id, 'note', val)}
                                        />
                                    </div>
                                ))}
                                <div className="grid grid-cols-1 gap-3 pt-3 border-t border-white/5">
                                    <button
                                        onClick={() => addSegment('work')}
                                        className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-teal-500/10 border border-teal-500/20 text-teal-200 text-xs font-bold hover:bg-teal-500/20 transition-colors"
                                    >
                                        <Plus size={14} /> Arbeitszeit
                                    </button>
                                </div>
                            </div>
                        )}
                    </GlassCard>
                </div>
            </div>

            {/* Quota Notification Modal */}
            {
                pendingQuotaNotifications.length > 0 && isNotificationModalOpen && (
                    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-300">
                        <GlassCard className="w-full max-w-lg border-purple-500/50 shadow-2xl shadow-purple-900/20 relative bg-gray-900/95">
                            <div className="p-6 text-center space-y-6">
                                <div className="mx-auto w-16 h-16 bg-purple-500/20 rounded-full flex items-center justify-center ring-1 ring-purple-500/50 relative">
                                    <Palmtree size={32} className="text-purple-300" />
                                    <button
                                        onClick={() => setIsNotificationModalOpen(false)}
                                        className="absolute -top-2 -right-2 bg-white/10 hover:bg-white/20 p-1.5 rounded-full text-white/50 hover:text-white transition-colors"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>

                                <div>
                                    <h2 className="text-xl font-bold text-white mb-2">Urlaubsanspruch Aktualisiert</h2>
                                    <p className="text-white/60">
                                        Für das Jahr <span className="text-purple-300 font-bold">{pendingQuotaNotifications[0].year}</span> wurde dein Urlaubsanspruch angepasst.
                                    </p>
                                </div>

                                <div className="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-white/50">Basis-Anspruch</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-white/30 line-through">{pendingQuotaNotifications[0].previous_value?.base}</span>
                                            <ArrowRight size={12} className="text-white/30" />
                                            <span className="text-white font-bold">{pendingQuotaNotifications[0].new_value?.base}</span>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-white/50">Resturlaub (Vorjahr)</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-white/30 line-through">{pendingQuotaNotifications[0].previous_value?.carryover}</span>
                                            <ArrowRight size={12} className="text-white/30" />
                                            <span className="text-white font-bold">{pendingQuotaNotifications[0].new_value?.carryover}</span>
                                        </div>
                                    </div>
                                    <div className="pt-3 border-t border-white/10 flex justify-between items-center">
                                        <span className="text-purple-300 font-bold">Gesamtanspruch</span>
                                        <span className="text-xl font-bold text-white">{pendingQuotaNotifications[0].new_value?.total} Tage</span>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <button
                                        onClick={() => handleQuotaResponse('confirmed')}
                                        className="w-full py-3 bg-purple-600 hover:bg-purple-500 rounded-xl text-white font-bold transition-all shadow-lg shadow-purple-900/20 active:scale-95"
                                    >
                                        Änderungen bestätigen
                                    </button>

                                    <div className="relative">
                                        <details className="group">
                                            <summary className="list-none w-full py-2 text-white/40 hover:text-white/60 text-sm cursor-pointer transition-colors flex items-center justify-center gap-2">
                                                Ablehnen & Melden
                                                <ChevronDown size={14} className="group-open:rotate-180 transition-transform" />
                                            </summary>
                                            <div className="mt-3 space-y-3 animate-in slide-in-from-top-2 duration-200">
                                                <textarea
                                                    value={notificationRejectionReason}
                                                    onChange={(e) => setNotificationRejectionReason(e.target.value)}
                                                    placeholder="Bitte gib einen Grund an..."
                                                    className="w-full h-24 bg-black/40 border border-white/10 rounded-xl p-3 text-white text-sm focus:border-red-500/50 outline-none resize-none"
                                                />
                                                <button
                                                    onClick={() => handleQuotaResponse('rejected')}
                                                    disabled={!notificationRejectionReason.trim()}
                                                    className="w-full py-2 border border-red-500/30 text-red-300 hover:bg-red-500/10 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    Änderung ablehnen
                                                </button>
                                            </div>
                                        </details>
                                    </div>

                                    <button
                                        onClick={() => setIsNotificationModalOpen(false)}
                                        className="w-full py-2 text-white/20 hover:text-white/40 text-xs uppercase font-bold tracking-wider transition-colors mt-2"
                                    >
                                        Später erinnern
                                    </button>
                                </div>
                            </div>
                        </GlassCard>
                    </div>
                )
            }
            {
                showDatePicker && (
                    <GlassDatePicker
                        value={date}
                        onChange={setDate}
                        onClose={() => setShowDatePicker(false)}
                        gracePeriodCutoff={gracePeriodCutoff}
                    />
                )
            }
        </div >
    );
};

export default EntryPage;
