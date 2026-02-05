import React, { useState, useEffect, useRef, useCallback } from 'react';
import { differenceInCalendarDays } from 'date-fns';
import { useProposals, useTimeEntries, useSettings, useDailyLogs, useAbsences, useInstallers, usePeerReviews, getLocalISOString, useOfficeService, useDepartments } from '../services/dataService'; // Added useDepartments
import { supabase } from '../services/supabaseClient'; // Ensure supabase is imported
import { GlassCard, GlassInput, GlassButton } from '../components/GlassCard';
import GlassDatePicker from '../components/GlassDatePicker';
import { PlusCircle, Save, X, Calendar, ChevronLeft, ChevronRight, Clock, Coffee, Building, Briefcase, Truck, Sun, Heart, AlertCircle, AlertTriangle, CheckCircle, Info, Lock, History, User, FileText, Palmtree, UserX, Copy, Loader2, RefreshCw, Send, ArrowLeft, Trash2, CalendarDays, Plus, ChevronDown, ChevronUp, ArrowRight, MessageSquareText, StickyNote, Building2, Warehouse, Car, Stethoscope, PartyPopper, Ban, TrendingDown, Play, Square, UserCheck, Check, UserPlus, ArrowLeftRight, Baby, Coins, PiggyBank, Siren, Percent, ShieldAlert, Edit2, XCircle, Hash, Users } from 'lucide-react';
import { TimeSegment, QuotaChangeNotification, TimeEntry, UserAbsence } from '../types';
import { formatDuration, getGracePeriodDate, formatMinutesToDecimal, calculateOverlapInMinutes } from '../services/utils/timeUtils';
import { analyzeMontagebericht, uploadBackupFile } from '../services/pdfImportService';


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
    const { addAbsence, absences, confirmAbsenceDeletion, rejectAbsenceDeletion } = useAbsences();
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
    const { proposals, acceptProposal, discardProposal } = useProposals();

    // Nutzung von getLocalISOString statt UTC
    const [date, setDate] = useState(getLocalISOString());
    const [client, setClient] = useState('');
    const [hours, setHours] = useState('');
    const [note, setNote] = useState('');

    // Team Selection State
    const [showTeamMenu, setShowTeamMenu] = useState(false);
    const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem('selectedTeamIds');
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    });

    useEffect(() => {
        localStorage.setItem('selectedTeamIds', JSON.stringify(selectedTeamIds));
    }, [selectedTeamIds]);

    const [teamConfirmModal, setTeamConfirmModal] = useState(false);
    const isTeamConfirmed = useRef(false);
    const ignoreTeam = useRef(false);

    // Edit State
    const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

    // NEU: Order Number State
    const [orderNumber, setOrderNumber] = useState('');

    // Absence Deletion Notifications
    const [absenceNotifications, setAbsenceNotifications] = useState<UserAbsence[]>([]);

    useEffect(() => {
        if (!absences) return;
        const pending = absences.filter(a => a.deletion_requested_at && !a.deletion_confirmed_by_user && !a.is_deleted);
        setAbsenceNotifications(pending);
    }, [absences]);
    const [showOrderInput, setShowOrderInput] = useState(false);

    // NEU: Success Modal State
    const [successModal, setSuccessModal] = useState<{ isOpen: boolean; message: string }>({ isOpen: false, message: '' });

    // NEU: PDF Analyse State
    const [isAnalysing, setIsAnalysing] = useState(false);
    const [analysisMsg, setAnalysisMsg] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsAnalysing(true);
        setAnalysisMsg(null);

        try {
            // 1. Backup Upload
            uploadBackupFile(file).catch(err => console.error("Backup failed", err));

            // 2. Analyse
            const result = await analyzeMontagebericht(file);

            if (result.success) {
                // Kunde & Auftrag setzen
                // Wenn wir eine Auftragsnummer haben, packen wir sie NICHT mehr in den Namen (redundant),
                // sondern nur in das extra Feld.
                if (result.orderNumber) {
                    setOrderNumber(result.orderNumber);
                    setShowOrderInput(true);
                    if (result.customerName) setClient(result.customerName);
                } else {
                    // Fallback: Keine separate Nummer erkannt -> Alles in den Namen (wie bisher)
                    const projectText = `${result.orderNumber || ''} ${result.customerName || ''}`.trim();
                    if (projectText) setClient(projectText);
                }

                // Zeiten berechnen
                if (result.hours && result.hours > 0) {
                    // WICHTIG: State muss "1.5" sein (mit Punkt), nicht "1,50" (Komma), da Input Type="number" (oder ähnlich) das erwartet.
                    // Die Anzeige im Input formatieren wir ggf. anders, aber der State hours sollte raw sein.
                    setHours(result.hours.toString());

                    if (projectStartTime) {
                        const calculatedEndTime = addMinutesToTime(projectStartTime, result.hours * 60);
                        setProjectEndTime(calculatedEndTime);
                    }
                }

                setAnalysisMsg(`✅ ${result.message}`);
            } else {
                setAnalysisMsg(`⚠️ ${result.message}`);
            }

        } catch (error) {
            setAnalysisMsg("❌ Fehler beim Import");
            console.error(error);
        } finally {
            setIsAnalysing(false);
            // Reset Input
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // --- ABSENCE REQUEST HANDLERS ---
    const handleConfirmAbsenceDeletion = async (id: string) => {
        const res = await confirmAbsenceDeletion(id);
        if (res.success) {
            setAnalysisMsg("✅ Löschung bestätigt");
            setTimeout(() => setAnalysisMsg(null), 3000);
        } else {
            setAnalysisMsg("❌ " + (res.message || "Fehler"));
            setTimeout(() => setAnalysisMsg(null), 5000);
        }
    };

    const handleRejectAbsenceDeletion = async (id: string) => {
        const res = await rejectAbsenceDeletion(id);
        if (res.success) {
            setAnalysisMsg("✅ Löschung abgelehnt (Eintrag behalten)");
            setTimeout(() => setAnalysisMsg(null), 3000);
        } else {
            setAnalysisMsg("❌ " + (res.message || "Fehler"));
            setTimeout(() => setAnalysisMsg(null), 5000);
        }
    };


    // --- SHARE TARGET HANDLING START ---
    useEffect(() => {
        const checkSharedFile = async () => {
            // 1. Check URL param or just check IDB directly?
            // Checking IDB is safe.
            // DB Config must match SW
            const DB_NAME = 'share-target-db';
            const STORE_NAME = 'shared-files';

            try {
                // Check if IDB exists
                const dbs = await window.indexedDB.databases?.();
                if (dbs && !dbs.find(db => db.name === DB_NAME)) return;

                const request = indexedDB.open(DB_NAME, 1);

                request.onsuccess = (e: any) => {
                    const db = e.target.result;
                    // Check if store exists (might be empty db)
                    if (!db.objectStoreNames.contains(STORE_NAME)) return;

                    const tx = db.transaction(STORE_NAME, 'readwrite');
                    const store = tx.objectStore(STORE_NAME);

                    const getAll = store.getAll();
                    getAll.onsuccess = () => {
                        const files = getAll.result;
                        if (files && files.length > 0) {
                            console.log("Shared file found:", files[0]);
                            const file = files[0];

                            // 2. Trigger Upload Logic manually
                            // We need to verify if file is valid Blob/File
                            if (file instanceof Blob) {
                                // Create a synthetic event or extract logic
                                // Extracting logic is cleaner, but wrapping in event is faster for now
                                const syntheticEvent = {
                                    target: { files: [file] }
                                } as any;
                                handleFileUpload(syntheticEvent);

                                // 3. Notify User
                                alert("Ein Montagebericht wurde geteilt und wird analysiert!");
                            }

                            // 4. Clear Store
                            store.clear();
                        }
                    };
                };
            } catch (err) {
                console.error("Error checking shared files:", err);
            }
        };

        // Delay slightly to ensure SW has responded and redirected
        setTimeout(checkSharedFile, 1000);
    }, []);
    // --- SHARE TARGET HANDLING END ---

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

        // START CHANGE: Treat overtime_reduction as absence (0 hours, no times)
        const isNextAbsence = ['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay', 'overtime_reduction'].includes(nextType);
        // END CHANGE

        if (isNextAbsence) {
            setHours('0');
            setProjectStartTime('');
            setProjectEndTime('');
            setOrderNumber('');
            setShowOrderInput(false);
        } else {
            // Restore start time if it was cleared (e.g. by passing through absence types) or is empty
            if (!projectStartTime) {
                setProjectStartTime(getSuggestedStartTime());
            }

            // Clear hours if coming from absence type (where we set it to '0')
            // START CHANGE: Include overtime_reduction here too to clear the '0'
            if (['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay', 'overtime_reduction'].includes(entryType)) {
                setHours('');
            }
            // END CHANGE
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

    // --- Long Press Handlers (Improved for Hybrid Touch/Mouse) ---
    const isTouchInteraction = useRef(false);

    const handleButtonDown = (e: React.MouseEvent | React.TouchEvent) => {
        // Prevent double firing on hybrid devices
        if (e.type === 'touchstart') {
            isTouchInteraction.current = true;
        } else if (e.type === 'mousedown' && isTouchInteraction.current) {
            return;
        }

        isLongPress.current = false;
        longPressTimer.current = setTimeout(() => {
            isLongPress.current = true;
            setShowTypeMenu(true);
        }, 500); // 500ms threshold
    };

    const handleButtonUp = (e: React.MouseEvent | React.TouchEvent) => {
        // Prevent double firing
        if (e.type === 'touchend') {
            e.preventDefault(); // Stop browser from firing click/mousedown
        } else if (e.type === 'mouseup' && isTouchInteraction.current) {
            return;
        }

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

        // Reset touch interaction flag after a delay to allow future mouse interactions if mixed usage
        if (e.type === 'touchend') {
            setTimeout(() => { isTouchInteraction.current = false; }, 1000);
        }
    };

    const handleButtonLeave = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    // --- TIME INPUT HELPERS ---
    const enforceTimeFormat = (val: string) => {
        // 1. Replace dots with colons
        let cleaned = val.replace(/\./g, ':');

        // 2. Remove invalid characters (keep only digits and colon)
        cleaned = cleaned.replace(/[^\d:]/g, '');

        // 3. Auto-insert colon if user types 3 or 4 digits without one
        // e.g. "103" -> "10:3", "1030" -> "10:30"
        if (cleaned.length >= 3 && !cleaned.includes(':')) {
            // If they typed something like "103", make it "10:3"
            // If they typed "800", make it "80:0" which is invalid but blur will fix it?
            // Actually, for single digit hours like 800, we might want 08:00
            // But let's keep it simple for now as per plan.
            cleaned = cleaned.slice(0, 2) + ':' + cleaned.slice(2);
        }

        // 4. Limit length to 5 characters (HH:mm)
        if (cleaned.length > 5) {
            cleaned = cleaned.slice(0, 5);
        }

        return cleaned;
    };

    const formatTimeInput = (val: string) => {
        const cleanVal = val.trim().replace(/\./g, ':'); // Handle dot here too
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
        const enforced = enforceTimeFormat(val);
        setProjectStartTime(enforced);
        if (hours && enforced && enforced.includes(':')) {
            const h = parseFloat(hours.replace(',', '.'));
            const minutes = Math.round(h * 60);
            setProjectEndTime(addMinutesToTime(enforced, minutes));
        }
    };

    const handleEndTimeChange = (val: string) => {
        const enforced = enforceTimeFormat(val);
        setProjectEndTime(enforced);
        // Live calculation on valid input
        if (projectStartTime && enforced && projectStartTime.includes(':') && enforced.includes(':')) {
            const diffMins = getMinutesDiff(projectStartTime, enforced);
            if (diffMins > 0) {
                setHours((diffMins / 60).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
            }
        }
    };

    const handleStartTimeBlur = () => {
        const formatted = formatTimeInput(projectStartTime);
        if (formatted !== projectStartTime) {
            setProjectStartTime(formatted);
        }

        // Always try to calculate on blur if both are present
        if (formatted && projectEndTime && projectEndTime.includes(':')) {
            const diffMins = getMinutesDiff(formatted, projectEndTime);
            if (diffMins > 0) {
                setHours((diffMins / 60).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
            }
        } else if (hours && formatted) {
            // Inverse: Start + Hours -> End
            const h = parseFloat(hours.replace(',', '.'));
            if (!isNaN(h)) {
                const minutes = Math.round(h * 60);
                setProjectEndTime(addMinutesToTime(formatted, minutes));
            }
        }
    };

    const handleEndTimeBlur = () => {
        const formatted = formatTimeInput(projectEndTime);
        if (formatted !== projectEndTime) {
            setProjectEndTime(formatted);
        }

        // Always try to calculate on blur if both are present
        if (projectStartTime && formatted && projectStartTime.includes(':')) {
            const diffMins = getMinutesDiff(projectStartTime, formatted);
            if (diffMins > 0) {
                setHours((diffMins / 60).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
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
        setOrderNumber('');
        setShowOrderInput(false);
        setSurcharge(0);
        setLateEntryWarning({ isOpen: false, diffDays: 0, reason: '' }); // Reset Late Warning
        setIsSubmitting(false);
    };

    const handleTeamConfirm = (ignore: boolean) => {
        isTeamConfirmed.current = true;
        ignoreTeam.current = ignore;
        setTeamConfirmModal(false);
        handleSubmit({ preventDefault: () => { } } as React.FormEvent);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // 1. TEAM CONFIRMATION CHECK
        if (selectedTeamIds.length > 0 && !isTeamConfirmed.current) {
            setTeamConfirmModal(true);
            return;
        }


        const isAbsence = ['vacation', 'sick', 'holiday', 'unpaid'].includes(entryType);

        // Validierung: Entweder Stunden ODER (Start + Ende) müssen da sein (außer bei Abwesenheiten)
        const hasTimeRange = projectStartTime && projectEndTime;
        if (!client || (!isAbsence && !hours && !hasTimeRange)) return;

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
            late_reason: isLateEntry ? lateReason : (lateEntryWarning.reason || undefined),
            order_number: orderNumber || undefined
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
                const mins = calculateOverlapInMinutes(projectStartTime, projectEndTime, work.start_time!, work.end_time!);
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

                // --- TEAM / PEER ENTRIES (Proposals) ---
                if (selectedTeamIds.length > 0 && !ignoreTeam.current) {
                    const { data: { user } } = await supabase.auth.getUser();

                    for (const teamUserId of selectedTeamIds) {
                        await addEntry({
                            date: entryData.date,
                            client_name: entryData.client_name,
                            hours: entryData.hours,
                            start_time: entryData.start_time,
                            end_time: entryData.end_time,
                            note: entryData.note,
                            type: entryData.type as any,
                            surcharge: entryData.surcharge,
                            order_number: entryData.order_number,
                            // Proposal Flags
                            is_proposal: true,
                            shared_by_user_id: user?.id,
                            late_reason: undefined, // Proposals don't inherit late reason triggers yet
                            responsible_user_id: undefined // Peer confirms themselves
                        }, teamUserId);
                    }
                    setSuccessModal({ isOpen: true, message: `Eintrag für dich und ${selectedTeamIds.length} Kollegen erstellt.` });
                    // DO NOT CLEAR SELECTION: setSelectedTeamIds([]); 
                }
            }
        }

        // RESET FLAGS
        isTeamConfirmed.current = false;
        ignoreTeam.current = false;

        // --- AUTOMATISCHE PAUSEN-REGEL (> 6 Stunden) ---
        // Prüfen, ob es ein Arbeitseintrag ist und keine Abwesenheit
        const isAbsenceType = ['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay', 'overtime_reduction'].includes(entryType);

        if (entryType === 'work' && !isAbsence && !isAbsenceType) {
            // 1. Berechne aktuelle Tages-Summe (ohne den gerade bearbeiteten Eintrag, falls Edit)
            const currentWorkEntries = entries.filter(e =>
                e.date === date &&
                e.type === 'work' &&
                !e.is_deleted &&
                e.id !== editingEntryId // Bei Edit den alten Wert ignorieren
            );

            const currentSum = currentWorkEntries.reduce((sum, e) => sum + (e.hours || 0), 0);
            const newHours = parseFloat(hours.replace(',', '.'));
            const totalHoursDaily = currentSum + newHours;

            // 2. Prüfen, ob schon IRGENDEINE Pause existiert
            const hasBreak = entries.some(e => e.date === date && e.type === 'break' && !e.is_deleted);

            // 3. Wenn > 6h und noch keine Pause -> Dummy anlegen
            /* DISABLED BY USER REQUEST: Allow manual break entry flow
            if (totalHoursDaily > 6 && !hasBreak) {
                await addEntry({
                    date: date,
                    client_name: 'Pflichtpause (Auto)', // Erkennungs-Name
                    type: 'break',
                    hours: 0,           // 0 Stunden = Keine Berechnung
                    start_time: '',     // Leer lassen -> Keine Überlappungs-Konflikte
                    end_time: '',       // Leer lassen
                    note: 'Automatisch generiert (> 6 Std Regel)',
                    submitted: false
                });
            }
            */
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

    const handleOverlapConfirm = async () => {
        setIsSubmitting(true);
        try {
            // 1. Reduce overlapped entries
            for (const { entry, overlapMinutes } of overlapWarning.overlappedEntries) {
                let newHours = entry.hours;
                if (entry.calc_duration_minutes) {
                    const newMins = entry.calc_duration_minutes - overlapMinutes;
                    newHours = newMins / 60;
                } else {
                    newHours = Math.max(0, entry.hours - (overlapMinutes / 60));
                }

                await updateEntry(entry.id, {
                    hours: newHours,
                    // We only update hours (duration), assuming start/end are fixed "Project Times"
                    // and usage logic handles the deduction visually or logically.
                    // Ideally we might split the entry, but reducing hours is the requested "Wert bereinigen".
                });
            }

            // 2. Create the Break Entry
            if (overlapWarning.newEntryData) {
                await addEntry(overlapWarning.newEntryData);
            }

            setOverlapWarning({ isOpen: false, overlappedEntries: [], newEntryData: null });

            // Reset UI
            setHours('');
            setNote('');
            setProjectStartTime('');
            setProjectEndTime('');
            setOrderNumber('');
            setSuccessModal({ isOpen: true, message: `Pause erledigt & Arbeitszeit angepasst.` });

        } catch (e) {
            console.error(e);
            alert("Fehler beim Speichern der Überschneidung.");
        } finally {
            setIsSubmitting(false);
        }
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

    // --- HISTORY HELPERS ---
    const historyEntries = entries
        .filter(e => e.date === date && !e.is_deleted)
        .sort((a, b) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime());

    const handleEditEntry = (entry: TimeEntry) => {
        setEditingEntryId(entry.id);
        setEntryType((entry.type as EntryType) || 'work');
        setClient(entry.client_name);
        setHours(entry.hours ? entry.hours.toString() : '');
        setProjectStartTime(entry.start_time || '');
        setProjectEndTime(entry.end_time || '');
        setNote(entry.note || '');
        setOrderNumber(entry.order_number || '');
        setShowOrderInput(!!entry.order_number);
    };

    const handleDeleteEntry = async (id: string) => {
        if (!confirm('Eintrag wirklich löschen?')) return;
        const { error } = await supabase.from('time_entries').update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('id', id);
        if (error) alert('Fehler beim Löschen');
    };

    return (
        <div className="relative w-full h-full grid grid-cols-1 md:grid-cols-12 md:overflow-hidden text-white">
            {/* LEFT COLUMN (Header + Form) */}
            <div className="md:col-span-7 lg:col-span-8 flex flex-col h-full overflow-y-auto overflow-x-hidden p-4 md:p-6 lg:p-8 glass-scrollbar pb-32 md:pb-6">

                {/* UNIFIED HEADER & DATE SECTION */}
                <div className="mb-8 animate-in slide-in-from-top-2 duration-500">
                    <header className="flex items-end justify-between mb-6">
                        <div>
                            <p className="text-teal-400 font-bold uppercase tracking-widest text-xs mb-1">Zeiterfassung</p>
                            <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
                                Hallo, <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-200 to-emerald-200">{settings.display_name?.split(' ')[0]}</span>
                            </h1>
                        </div>

                        {/* DESKTOP DATE PICKER (Visible on md+) */}
                        <div className="hidden md:flex gap-2">
                            <GlassButton variant="secondary" onClick={setYesterday} className="!py-2 !px-4 !text-xs !bg-white/5 hover:!bg-white/10">Gestern</GlassButton>
                            <GlassButton variant="primary" onClick={setToday} className="!py-2 !px-4 !text-xs">Heute</GlassButton>
                            <div className="w-px h-6 bg-white/10 mx-1"></div>
                            <GlassButton
                                variant="secondary"
                                onClick={() => fileInputRef.current?.click()}
                                className="!py-2 !px-4 !text-xs !bg-blue-500/10 !text-blue-300 hover:!bg-blue-500/20 !border-blue-500/20"
                            >
                                {isAnalysing ? <Loader2 size={14} className="animate-spin mr-2" /> : <FileText size={14} className="mr-2" />}
                                Montageauftrag analysieren
                            </GlassButton>
                        </div>
                    </header>

                    {/* MAIN DATE CARD */}
                    <GlassCard
                        onClick={() => setShowDatePicker(true)}
                        hoverEffect={true}
                        className="relative !p-6 flex items-center justify-between group cursor-pointer border-teal-500/20 bg-gradient-to-br from-white/5 to-teal-900/10"
                    >
                        <div className="flex items-center gap-5">
                            <div className="w-14 h-14 rounded-2xl bg-teal-500/10 flex items-center justify-center text-teal-300 group-hover:scale-110 group-hover:bg-teal-500/20 transition-all duration-300">
                                <CalendarDays size={28} />
                            </div>
                            <div>
                                <div className="text-xs font-bold text-teal-200/60 uppercase tracking-wider mb-1">Ausgewähltes Datum</div>
                                <div className="text-2xl md:text-3xl font-bold text-white font-mono tracking-tight">{displayDate}</div>
                            </div>
                        </div>
                        <ChevronDown className="text-white/20 group-hover:text-teal-400 transition-colors" size={24} />
                    </GlassCard>
                </div>

                {/* PDF & ACTIONS BAR (Mobile Only Compact) */}
                <div className="md:hidden flex gap-3 mb-6 overflow-x-auto pb-2 scrollbar-hide">
                    <button onClick={setYesterday} className="whitespace-nowrap px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-white/60">Gestern</button>
                    <button onClick={setToday} className="whitespace-nowrap px-4 py-2 rounded-xl bg-teal-500/10 border border-teal-500/20 text-xs font-bold text-teal-300">Heute</button>
                    <div className="w-px h-8 bg-white/10 mx-1"></div>
                    <button onClick={() => fileInputRef.current?.click()} className="whitespace-nowrap px-4 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs font-bold text-blue-300 flex items-center gap-2">
                        {isAnalysing ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} PDF Import
                    </button>
                </div>

                {/* HIDDEN INPUT FOR PDF */}
                <input type="file" accept="application/pdf" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

                {/* ERROR MESSAGES / STATUS */}
                {analysisMsg && (
                    <div className={`mb-6 p-4 rounded-2xl border backdrop-blur-md animate-in slide-in-from-top-4 ${analysisMsg.includes('✅') ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200' : 'bg-red-500/10 border-red-500/20 text-red-200'}`}>
                        <div className="flex items-center gap-3 font-medium">
                            {analysisMsg.includes('✅') ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
                            {analysisMsg}
                        </div>
                    </div>
                )}

                {/* --- NEU: ABWESENHEITSLÖSCHUNGEN BESTÄTIGEN --- */}
                {absenceNotifications.length > 0 && (
                    <div className="mb-8 animate-in slide-in-from-top-4">
                        <div className="flex items-center gap-2 mb-3 px-1">
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                            <h3 className="text-xs font-bold text-red-300 uppercase tracking-wider">Löschanträge Abwesenheit ({absenceNotifications.length})</h3>
                        </div>
                        <div className="grid gap-3">
                            {absenceNotifications.map(absence => (
                                <GlassCard key={absence.id} className="!p-4 border-red-500/30 bg-red-900/5 hover:bg-red-900/10">
                                    <div className="flex justify-between items-start gap-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-bold text-red-400 uppercase tracking-wider">
                                                    {absence.type === 'vacation' ? 'Urlaub' :
                                                        absence.type === 'sick' ? 'Krank' :
                                                            absence.type === 'holiday' ? 'Feiertag' :
                                                                absence.type === 'unpaid' ? 'Unbezahlt' : absence.type}
                                                </span>
                                                <span className="text-white/30 text-xs">•</span>
                                                <span className="text-white/50 text-xs font-mono">
                                                    {new Date(absence.start_date).toLocaleDateString('de-DE')}
                                                    {absence.start_date !== absence.end_date && ` - ${new Date(absence.end_date).toLocaleDateString('de-DE')}`}
                                                </span>
                                            </div>
                                            <div className="text-white font-bold text-sm">
                                                Löschung beantragt
                                            </div>
                                            {absence.deletion_request_reason && (
                                                <div className="mt-2 text-red-200/70 text-sm italic bg-red-500/10 p-2 rounded-lg border border-red-500/10">
                                                    "{absence.deletion_request_reason}"
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-2 shrink-0">
                                            <button
                                                onClick={() => handleConfirmAbsenceDeletion(absence.id)}
                                                className="p-2 bg-emerald-500/20 text-emerald-300 rounded-xl hover:bg-emerald-500/30 font-bold text-xs flex items-center justify-center gap-1 min-w-[32px]"
                                                title="Löschung zustimmen"
                                            >
                                                <Check size={18} />
                                            </button>
                                            <button
                                                onClick={() => handleRejectAbsenceDeletion(absence.id)}
                                                className="p-2 bg-white/10 text-white/50 rounded-xl hover:bg-white/20 font-bold text-xs flex items-center justify-center gap-1 min-w-[32px]"
                                                title="Löschung ablehnen (Behalten)"
                                            >
                                                <X size={18} />
                                            </button>
                                        </div>
                                    </div>
                                </GlassCard>
                            ))}
                        </div>
                    </div>
                )}

                {/* --- NEU: MITARBEITER-BESTÄTIGUNGEN (PEER REVIEW) --- */}
                {pendingReviews.length > 0 && (
                    <div className="mb-8 animate-in slide-in-from-top-4">
                        <div className="flex items-center gap-2 mb-3 px-1">
                            <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse"></span>
                            <h3 className="text-xs font-bold text-teal-300 uppercase tracking-wider">Mitarbeiter-Bestätigungen ({pendingReviews.length})</h3>
                        </div>
                        <div className="grid gap-3">
                            {pendingReviews.map(review => {
                                const creatorName = installers.find(i => i.user_id === review.user_id)?.display_name || 'Unbekannt';
                                return (
                                    <GlassCard key={review.id} className="!p-4 border-teal-500/30 bg-teal-900/5 hover:bg-teal-900/10">
                                        <div className="flex justify-between items-start gap-4">
                                            <div className="flex-1">
                                                <div className="flex justify-between items-center mb-1">
                                                    <div className="text-xs font-bold text-teal-400 uppercase tracking-wider">{creatorName}</div>
                                                    <div className="px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 text-xs font-mono font-bold">{formatDuration(review.hours)}h</div>
                                                </div>
                                                <div className="font-bold text-white text-sm mb-1">{review.client_name}</div>
                                                <div className="text-white/50 text-xs flex flex-wrap gap-2">
                                                    <span>{new Date(review.date).toLocaleDateString()}</span>
                                                    {review.start_time && <span>• {review.start_time} - {review.end_time}</span>}
                                                </div>
                                                {review.note && <div className="mt-2 text-white/70 text-sm italic">"{review.note}"</div>}
                                            </div>
                                            <div className="flex flex-col gap-2 shrink-0">
                                                <button
                                                    onClick={() => processReview(review.id, 'confirm')}
                                                    className="p-2 bg-emerald-500/20 text-emerald-300 rounded-xl hover:bg-emerald-500/30"
                                                    title="Bestätigen"
                                                >
                                                    <Check size={18} />
                                                </button>
                                                {/* Ablehnen Button löst Prompt aus oder direkt Reject? Logic in dataService nutzt Prompt nicht direkt, aber wir können rejectionReason State nutzen wenn gewollt. Vorerst simple, oder einfach Prompt. */}
                                                <button
                                                    onClick={() => {
                                                        const reason = prompt("Grund für Ablehnung:");
                                                        if (reason) processReview(review.id, 'reject', reason);
                                                    }}
                                                    className="p-2 bg-red-500/20 text-red-300 rounded-xl hover:bg-red-500/30"
                                                    title="Ablehnen"
                                                >
                                                    <X size={18} />
                                                </button>
                                            </div>
                                        </div>
                                    </GlassCard>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* --- NEU: BENACHRICHTIGUNGEN (LÖSCHUNGEN / ÄNDERUNGEN) --- */}
                {entryNotifications.length > 0 && (
                    <div className="mb-8 animate-in slide-in-from-top-4">
                        <div className="flex items-center gap-2 mb-3 px-1">
                            <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
                            <h3 className="text-xs font-bold text-orange-300 uppercase tracking-wider">Bestätigungen erforderlich ({entryNotifications.length})</h3>
                        </div>
                        <div className="grid gap-3">
                            {entryNotifications.map(notif => {
                                const isDeletion = notif.is_deleted || notif.deletion_requested_at;
                                const isChange = !isDeletion;
                                const changerName = notif.last_changed_by ? (installers.find(i => i.user_id === notif.last_changed_by)?.display_name || 'Büro') : 'Büro';

                                return (
                                    <GlassCard key={notif.id} className="!p-4 border-orange-500/30 bg-orange-900/5 hover:bg-orange-900/10">
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="text-xs font-bold text-white/50">{new Date(notif.date).toLocaleDateString()}</span>
                                            <span className="bg-orange-500/20 text-orange-200 text-[10px] px-2 py-0.5 rounded uppercase font-bold">
                                                {isDeletion ? 'Löschung' : 'Änderung'}
                                            </span>
                                        </div>
                                        <div className="text-sm text-white/80 mb-4">
                                            {isDeletion ? (
                                                <>
                                                    <p className="font-bold text-red-300">Löschung beantragt</p>
                                                    <p className="text-xs mt-1">Grund: "{notif.deletion_request_reason || notif.deletion_reason || 'Kein Grund'}"</p>
                                                </>
                                            ) : (
                                                <>
                                                    <p>Änderung durch <span className="text-orange-300 font-bold">{changerName}</span></p>
                                                    <p className="text-xs mt-1 italic">"{notif.change_reason || 'Kein Grund'}"</p>
                                                </>
                                            )}
                                        </div>
                                        <div className="flex justify-end gap-2">
                                            <button
                                                onClick={() => confirmEntryNotification(notif)}
                                                className="bg-orange-500 hover:bg-orange-400 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-2 transition-colors"
                                            >
                                                <CheckCircle size={14} /> Akzeptieren
                                            </button>
                                        </div>
                                    </GlassCard>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* DEACTIVATED ACCOUNT */}
                {settings?.is_active === false && (
                    <GlassCard className="mb-6 !border-red-500/30 !bg-red-900/10">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-red-500/20 rounded-full text-red-400"><Ban size={24} /></div>
                            <div>
                                <h3 className="text-red-300 font-bold">Account deaktiviert</h3>
                                <p className="text-red-200/70 text-sm">Keine neuen Einträge möglich.</p>
                            </div>
                        </div>
                    </GlassCard>
                )}

                {/* PROPOSAL INBOX */}
                {proposals.length > 0 && (
                    <div className="mb-8 animate-in slide-in-from-top-4">
                        <div className="flex items-center gap-2 mb-3 px-1">
                            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                            <h3 className="text-xs font-bold text-indigo-300 uppercase tracking-wider">Vorschläge ({proposals.length})</h3>
                        </div>
                        <div className="grid gap-3">
                            {proposals.map(prop => (
                                <GlassCard key={prop.id} className="!p-4 border-indigo-500/30 bg-indigo-900/5 hover:bg-indigo-900/10">
                                    <div className="flex justify-between items-start gap-4">
                                        <div className="flex-1">
                                            <div className="flex justify-between items-center mb-1">
                                                <div className="font-bold text-white">{prop.client_name}</div>
                                                <div className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-xs font-mono font-bold">{formatDuration(prop.hours)}h</div>
                                            </div>
                                            <div className="text-white/50 text-xs flex flex-wrap gap-2">
                                                <span>{new Date(prop.date).toLocaleDateString()}</span>
                                                {prop.start_time && <span>• {prop.start_time} - {prop.end_time}</span>}
                                            </div>
                                            {prop.note && <div className="mt-2 text-white/70 text-sm italic">"{prop.note}"</div>}
                                        </div>
                                        <div className="flex flex-col gap-2 shrink-0">
                                            <button onClick={() => acceptProposal(prop.id)} className="p-2 bg-emerald-500/20 text-emerald-300 rounded-xl hover:bg-emerald-500/30"><Check size={18} /></button>
                                            <button onClick={() => discardProposal(prop.id)} className="p-2 bg-red-500/20 text-red-300 rounded-xl hover:bg-red-500/30"><X size={18} /></button>
                                        </div>
                                    </div>
                                </GlassCard>
                            ))}
                        </div>
                    </div>
                )}

                {/* NOTIFICATIONS & ALERTS */}
                {pendingQuotaNotifications.length > 0 && !isNotificationModalOpen && (
                    <div onClick={() => setIsNotificationModalOpen(true)} className="cursor-pointer mb-6 p-4 rounded-2xl bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition-all flex items-center gap-4 group">
                        <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-300 group-hover:scale-110 transition-transform"><Palmtree size={20} /></div>
                        <div>
                            <div className="font-bold text-purple-200 text-sm">Neuer Urlaubsanspruch</div>
                            <div className="text-xs text-purple-300/60">Bestätigung erforderlich</div>
                        </div>
                    </div>
                )}

                <form
                    onSubmit={(e) => {
                        if (settings?.is_active === false) { e.preventDefault(); return; }
                        handleSubmit(e);
                    }}
                    className={`grid gap-6 w-full ${settings?.is_active === false ? 'opacity-50 pointer-events-none grayscale' : ''}`}
                >
                    <GlassCard className={`!p-3 space-y-3 transition-all duration-300 relative z-20 !overflow-visible ${getTypeColor()}`}>
                        {/* LATE ENTRY WARNING & REASON */}
                        {isLateEntry && (
                            <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 mb-2 animate-in slide-in-from-top-2">
                                <div className="flex items-center gap-2 text-orange-300 font-bold text-xs uppercase mb-1">
                                    <AlertCircle size={14} />
                                    <span>Rückwirkend</span>
                                </div>
                                <textarea
                                    className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-sm text-white focus:border-orange-500/50 outline-none resize-none"
                                    placeholder="Grund für Verspätung..."
                                    rows={1}
                                    value={lateReason}
                                    onChange={(e) => setLateReason(e.target.value)}
                                    required
                                />
                            </div>
                        )}

                        {/* ROW 1: CLIENT + TYPE + ORDER + USER */}
                        <div className="relative z-50 flex gap-2 items-center">
                            {/* LEFT: TYPE INDICATOR (Fixed Icon) */}
                            <div className="flex-shrink-0" title={ENTRY_TYPES_CONFIG[entryType].label}>
                                <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center border border-white/10 bg-white/5 shadow-inner`}>
                                    {getTypeIcon()}
                                </div>
                            </div>

                            {/* MIDDLE: CLIENT INPUT */}
                            <div className="relative flex-1">
                                <GlassInput
                                    type="text"
                                    placeholder={entryType === 'overtime_reduction' ? "Bemerkung..." : "Kunde / Projekt..."}
                                    value={client}
                                    onChange={(e) => setClient(e.target.value)}
                                    onBlur={() => { if (client.length > 0) setShowOrderInput(true); }}
                                    onFocus={() => setShowOrderInput(false)}
                                    required
                                    className={`h-10 md:h-12 text-base md:text-lg ${client.length > 0 && !showOrderInput ? 'pr-20' : 'pr-10'} ${entryType !== 'work' && entryType !== 'emergency_service' ? 'text-white/90' : ''}`}
                                />

                                {/* Cycle Type Button (Small Overlay) */}
                                {!showOrderInput && (
                                    <button
                                        type="button"
                                        onMouseDown={handleButtonDown}
                                        onMouseUp={handleButtonUp}
                                        onMouseLeave={handleButtonLeave}
                                        onTouchStart={handleButtonDown}
                                        onTouchEnd={handleButtonUp}
                                        className={`absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors hover:bg-white/10 text-white/50 hover:text-white`}
                                        title="Typ ändern"
                                    >
                                        <ArrowLeftRight size={16} />
                                    </button>
                                )}

                                {/* Order Number Toggle Trigger */}
                                {client.length > 0 && !showOrderInput && (
                                    <button
                                        type="button"
                                        onClick={() => setShowOrderInput(true)}
                                        className="absolute right-9 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-all animate-in fade-in slide-in-from-right-2"
                                        title="Auftrags-Nr"
                                    >
                                        <Hash size={16} />
                                    </button>
                                )}

                                {/* ORDER NUMBER SLIDING OVERLAY */}
                                <div
                                    className={`absolute top-0 right-0 h-full w-[85%] bg-slate-800/95 backdrop-blur-xl border-l border-white/20 shadow-xl transition-all duration-300 ease-out z-20 flex items-center px-2 md:rounded-r-xl rounded-r-xl ${showOrderInput ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'}`}
                                >
                                    <Hash size={14} className="text-teal-400 mr-2 shrink-0" />
                                    <input
                                        type="text"
                                        value={orderNumber}
                                        onChange={(e) => setOrderNumber(e.target.value)}
                                        placeholder="Auftrags-Nr..."
                                        className="bg-transparent border-none outline-none text-white h-full w-full placeholder-white/30 text-sm"
                                        autoFocus={showOrderInput}
                                    />
                                    {/* Close Order Overlay */}
                                    <button onClick={() => setShowOrderInput(false)} className="ml-2 p-1 text-white/50 hover:text-white"><X size={14} /></button>
                                </div>
                            </div>

                            {/* RIGHT: INSTALLER / TEAM MENU */}
                            <div className="relative flex gap-1">
                                {/* TEAM BUTTON (NEW) */}
                                <button
                                    type="button"
                                    onClick={() => setShowTeamMenu(!showTeamMenu)}
                                    className={`h-10 w-10 md:h-12 md:w-12 rounded-xl border flex items-center justify-center transition-all ${selectedTeamIds.length > 0
                                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50 hover:bg-indigo-500/30'
                                        : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'
                                        }`}
                                    title="Für Kollegen eintragen"
                                >
                                    <Users size={18} />
                                    {selectedTeamIds.length > 0 && (
                                        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[10px] text-white font-bold">
                                            {selectedTeamIds.length}
                                        </span>
                                    )}
                                </button>

                                {/* INSTALLER BUTTON */}
                                <button
                                    type="button"
                                    onClick={() => !isLateEntry && setShowInstallerMenu(!showInstallerMenu)}
                                    disabled={isLateEntry}
                                    className={`h-10 w-10 md:h-12 md:w-12 rounded-xl border flex items-center justify-center transition-all 
                                        ${isLateEntry
                                            ? 'bg-gray-800/50 text-gray-500 border-gray-700/50 cursor-not-allowed'
                                            : responsibleUserId
                                                ? 'bg-teal-500/20 text-teal-300 border-teal-500/50 hover:bg-teal-500/30'
                                                : (settings.role === 'azubi' && (entryType === 'work' || entryType === 'break'))
                                                    ? 'bg-red-500/10 text-red-400 border-red-500/50 animate-pulse'
                                                    : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'
                                        }`}
                                >
                                    {isLateEntry ? <Lock size={16} /> : (responsibleUserId ? <UserCheck size={18} /> : <UserPlus size={18} />)}
                                </button>

                                {/* TEAM MENU DROPDOWN */}
                                {showTeamMenu && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setShowTeamMenu(false)} />
                                        <div className="absolute top-full right-0 mt-2 z-50 w-64 bg-gray-900/95 backdrop-blur-xl border border-indigo-500/30 rounded-xl p-2 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                                            <div className="text-xs font-bold text-indigo-300 uppercase px-2 py-1 mb-1 flex justify-between">
                                                <span>Team wählen</span>
                                                {selectedTeamIds.length > 0 && <span className="text-white/50">{selectedTeamIds.length}</span>}
                                            </div>
                                            <div className="max-h-48 overflow-y-auto space-y-1">
                                                {installers.filter(i => i.user_id !== settings.user_id && i.is_visible_to_others !== false).map(inst => (
                                                    <button
                                                        key={inst.user_id}
                                                        type="button"
                                                        onClick={() => {
                                                            const id = inst.user_id!;
                                                            setSelectedTeamIds(prev =>
                                                                prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
                                                            );
                                                        }}
                                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between transition-colors ${selectedTeamIds.includes(inst.user_id!)
                                                            ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/30'
                                                            : 'text-white/70 hover:bg-white/5 border border-transparent'
                                                            }`}
                                                    >
                                                        <span>{inst.display_name}</span>
                                                        {selectedTeamIds.includes(inst.user_id!) && <Check size={14} className="text-indigo-400" />}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                )}

                                {showInstallerMenu && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setShowInstallerMenu(false)} />
                                        <div className="absolute top-full right-0 mt-2 z-50 w-64 bg-gray-900/95 backdrop-blur-xl border border-white/20 rounded-xl p-2 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                                            <div className="text-xs font-bold text-white/50 uppercase px-2 py-1 mb-1">Mitarbeiter bestätigen lassen</div>
                                            <div className="max-h-48 overflow-y-auto">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setResponsibleUserId('');
                                                        localStorage.removeItem('lastResponsibleUserId');
                                                        setShowInstallerMenu(false);
                                                    }}
                                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 ${!responsibleUserId ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5'}`}
                                                >
                                                    Keine Bestätigung (Standard)
                                                </button>
                                                {installers.filter(i => i.user_id !== settings.user_id && i.is_visible_to_others !== false).map(installer => (
                                                    <button
                                                        key={installer.user_id}
                                                        type="button"
                                                        onClick={() => {
                                                            setResponsibleUserId(installer.user_id!);
                                                            localStorage.setItem('lastResponsibleUserId', installer.user_id!);
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

                            {/* TYPE MENU MODAL (Long Press) */}
                            {showTypeMenu && (
                                <>
                                    <div className="fixed inset-0 z-40 bg-black/10" onClick={() => setShowTypeMenu(false)} />
                                    <div className="absolute top-full left-0 mt-2 z-50 w-64 bg-gray-900/95 backdrop-blur-xl border border-white/20 rounded-xl p-3 shadow-2xl animate-in slide-in-from-top-2 duration-200">
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
                                                        className={`flex items-center gap-2 p-2 rounded-lg text-left transition-colors ${entryType === t ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-white/60 hover:text-white'}`}
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

                        {/* ROW 2: TIME + HOURS (Unified) */}
                        <div className="flex gap-2 items-stretch">
                            <div className="flex-1 flex gap-1 bg-black/20 rounded-xl p-1 border border-white/5 items-center">
                                <div className="flex-1 relative">
                                    <span className="absolute top-1 left-0 w-full text-center text-[9px] text-white/30 uppercase font-bold tracking-wider">Von</span>
                                    <input
                                        type="text"
                                        placeholder="--"
                                        value={projectStartTime}
                                        onChange={(e) => handleStartTimeChange(e.target.value)}
                                        onBlur={handleStartTimeBlur}
                                        disabled={['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay', 'overtime_reduction'].includes(entryType)}
                                        className="w-full bg-transparent border-none text-center text-white font-mono text-base h-10 pt-3 focus:outline-none"
                                    />
                                </div>
                                <ArrowRight size={12} className="text-white/20" />
                                <div className="flex-1 relative">
                                    <span className="absolute top-1 left-0 w-full text-center text-[9px] text-white/30 uppercase font-bold tracking-wider">Bis</span>
                                    <input
                                        type="text"
                                        placeholder="--"
                                        value={projectEndTime}
                                        onChange={(e) => handleEndTimeChange(e.target.value)}
                                        onBlur={handleEndTimeBlur}
                                        disabled={['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay', 'overtime_reduction'].includes(entryType)}
                                        className="w-full bg-transparent border-none text-center text-white font-mono text-base h-10 pt-3 focus:outline-none"
                                    />
                                </div>
                            </div>

                            {/* HOURS INPUT */}
                            <div className="w-24 relative bg-black/20 rounded-xl border border-white/5 flex flex-col justify-center">
                                <span className="absolute top-1 left-0 w-full text-center text-[9px] text-cyan-400/70 uppercase font-bold tracking-wider">Std</span>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="0,00"
                                    value={hours}
                                    onChange={(e) => handleHoursChange(e.target.value)}
                                    required={!['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay', 'overtime_reduction'].includes(entryType)}
                                    disabled={['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay', 'overtime_reduction'].includes(entryType)}
                                    className="w-full bg-transparent border-none text-center text-cyan-300 font-bold font-mono text-xl h-10 pt-3 focus:outline-none"
                                />
                                {/* PREVIEW HELPER */}
                                {projectStartTime && projectEndTime && !hours && (
                                    /* Preview Removed as requested */
                                    null
                                )}
                            </div>
                        </div>

                        {/* ROW 3: NOTE */}
                        <div className="relative">
                            <input
                                type="text"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="Notiz (Optional)..."
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-teal-500/50"
                            />
                        </div>

                        {/* SUBMIT BUTTON */}
                        <div className="pt-2">
                            <GlassButton
                                type="submit"
                                disabled={isSubmitting}
                                className={`w-full h-12 text-base shadow-xl font-bold tracking-wide ${getButtonGradient()}`}
                            >
                                {isSubmitting ? 'Speichere...' :
                                    editingEntryId ? 'Änderung speichern' :
                                        (entryType === 'break' ? 'Pause buchen' :
                                            (responsibleUserId ? 'Zur Prüfung senden' : 'Zeit erfassen'))}
                            </GlassButton>
                        </div>
                    </GlassCard>

                    {/* SURCHARGE SELECTOR (Compact) */}
                    {entryType === 'emergency_service' && (
                        <GlassCard className="!p-3 flex items-center justify-between gap-3 animate-in slide-in-from-top-2">
                            <span className="font-bold text-rose-300 text-xs uppercase">Zuschlag:</span>
                            <div className="flex gap-2">
                                {[50, 100].map(val => (
                                    <button
                                        key={val}
                                        type="button"
                                        onClick={() => setSurcharge(val === surcharge ? 0 : val)}
                                        className={`px-3 py-1 rounded-lg border font-mono font-bold text-sm transition-all ${surcharge === val
                                            ? 'bg-rose-500 text-white border-rose-400'
                                            : 'bg-white/5 text-white/40 border-white/10'
                                            }`}
                                    >
                                        {val}%
                                    </button>
                                ))}
                            </div>
                        </GlassCard>
                    )}
                </form>
            </div>

            {/* RIGHT COLUMN (Time + History) */}
            <div className="md:col-span-5 lg:col-span-4 h-full overflow-y-auto p-4 md:p-6 space-y-6 glass-scrollbar">
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
                {/* HISTORY LIST */}
                <div className="space-y-4 pb-20">
                    <div className="flex items-center justify-between px-1">
                        <h3 className="font-bold text-white/50 text-xs uppercase tracking-wider flex items-center gap-2">
                            Verlauf
                        </h3>
                    </div>

                    <div className="space-y-3">
                        {historyEntries.length > 0 ? (
                            historyEntries.map(entry => {
                                const Icon = ENTRY_TYPES_CONFIG[entry.type as EntryType]?.icon;
                                return (
                                    <GlassCard key={entry.id} className="!p-3 group hover:bg-white/5 transition-colors border-white/5">
                                        <div className="flex justify-between items-start gap-3">
                                            <div className="mt-1 w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 border border-white/5">
                                                {Icon && <Icon size={16} className="text-white/70" />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-baseline mb-1">
                                                    <h4 className="font-bold text-white text-sm truncate">{entry.client_name}</h4>
                                                    <span className="font-mono font-bold text-teal-300 text-sm ml-2">
                                                        {formatDuration(entry.calc_duration_minutes ? entry.calc_duration_minutes / 60 : entry.hours)}h
                                                    </span>
                                                </div>
                                                <div className="text-xs text-white/40 flex flex-wrap gap-2 mb-1">
                                                    <span>{new Date(entry.date).toLocaleDateString()}</span>
                                                    {entry.start_time && <span>• {entry.start_time} - {entry.end_time}</span>}
                                                    {entry.order_number && <span className="text-white/30">• #{entry.order_number}</span>}
                                                </div>
                                                {entry.note && <p className="text-sm text-white/60 italic truncate">"{entry.note}"</p>}

                                                {/* Entry Actions */}
                                                <div className="mt-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleEditEntry(entry)}
                                                        className="px-2 py-1 rounded bg-blue-500/20 text-blue-300 text-[10px] font-bold hover:bg-blue-500/30"
                                                    >
                                                        EDIT
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteEntry(entry.id)}
                                                        className="px-2 py-1 rounded bg-red-500/20 text-red-300 text-[10px] font-bold hover:bg-red-500/30"
                                                    >
                                                        LÖSCHEN
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </GlassCard>
                                );
                            })
                        ) : (
                            <div className="text-center py-10 text-white/20 text-sm">Keine Einträge gefunden</div>
                        )}
                    </div>
                </div>
            </div>


            {/* TEAM CONFIRM MODAL */}
            {teamConfirmModal && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-300">
                    <GlassCard className="w-full max-w-md border-indigo-500/50 shadow-2xl shadow-indigo-900/20 relative bg-gray-900/95">
                        <div className="p-6 text-center space-y-6">
                            <div className="mx-auto w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center ring-1 ring-indigo-500/50 relative">
                                <Users size={32} className="text-indigo-300" />
                            </div>

                            <div>
                                <h2 className="text-xl font-bold text-white mb-2">Team-Eintrag erstellen?</h2>
                                <p className="text-white/60 mb-2">Du hast <span className="text-indigo-300 font-bold">{selectedTeamIds.length} Kollegen</span> ausgewählt.</p>
                                <div className="max-h-32 overflow-y-auto bg-white/5 rounded-lg p-2 text-sm text-left border border-white/10">
                                    {installers.filter(i => selectedTeamIds.includes(i.user_id!)).map(i => (
                                        <div key={i.user_id} className="py-1 px-2 border-b border-white/5 last:border-0 text-white/80">{i.display_name}</div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <button
                                    onClick={() => handleTeamConfirm(false)}
                                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-bold transition-all shadow-lg shadow-indigo-900/20 active:scale-95 flex items-center justify-center gap-2"
                                >
                                    <CheckCircle size={18} />
                                    Für ALLE ({selectedTeamIds.length + 1}) buchen
                                </button>

                                <button
                                    onClick={() => handleTeamConfirm(true)}
                                    className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl text-white font-bold transition-all flex items-center justify-center gap-2"
                                >
                                    <User size={18} />
                                    Nur für MICH buchen
                                </button>

                                <button
                                    onClick={() => setTeamConfirmModal(false)}
                                    className="w-full py-2 text-white/30 hover:text-white/50 text-sm"
                                >
                                    Abbrechen
                                </button>
                            </div>
                        </div>
                    </GlassCard>
                </div>
            )}

            {/* Overlap Warning Modal */}
            {overlapWarning.isOpen && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-300">
                    <GlassCard className="w-full max-w-lg border-orange-500/50 shadow-2xl shadow-orange-900/20 relative bg-gray-900/95">
                        <div className="p-6 text-center space-y-6">
                            <div className="mx-auto w-16 h-16 bg-orange-500/20 rounded-full flex items-center justify-center ring-1 ring-orange-500/50 relative">
                                <AlertTriangle size={32} className="text-orange-300" />
                            </div>

                            <div>
                                <h2 className="text-xl font-bold text-white mb-2">Überschneidung erkannt</h2>
                                <p className="text-white/60">
                                    Die eingetragene Pause überschneidet sich mit bestehenden Einträgen.
                                    Soll die Arbeitszeit der betroffenen Einträge automatisch reduziert werden?
                                </p>
                            </div>

                            <div className="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3 max-h-40 overflow-y-auto">
                                {overlapWarning.overlappedEntries.map((item, idx) => (
                                    <div key={idx} className="flex justify-between items-center text-sm">
                                        <div className="flex flex-col text-left">
                                            <span className="font-bold text-white">{item.entry.client_name}</span>
                                            <span className="text-white/40 text-xs">
                                                {item.entry.start_time} - {item.entry.end_time}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-orange-300 font-bold">-{item.overlapMinutes} min</span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => setOverlapWarning({ isOpen: false, overlappedEntries: [], newEntryData: null })}
                                    className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl text-white font-bold transition-all"
                                >
                                    Abbrechen
                                </button>
                                <button
                                    onClick={handleOverlapConfirm}
                                    className="w-full py-3 bg-orange-600 hover:bg-orange-500 rounded-xl text-white font-bold transition-all shadow-lg shadow-orange-900/20 active:scale-95"
                                >
                                    Bestätigen & Buchen
                                </button>
                            </div>
                        </div>
                    </GlassCard>
                </div>
            )}

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
