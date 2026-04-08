import React, { useEffect, useState, useMemo } from 'react';
import { useOfficeService, useDepartments } from '../services/dataService';
import { supabase } from '../services/supabaseClient';
import { GlassCard } from '../components/GlassCard';
import { useNavigate } from 'react-router-dom';
import {
    Activity, ArrowRight, CheckCircle, Clock, FileText,
    LayoutDashboard, UserCheck, Shield, ChevronRight, AlertTriangle,
    Palmtree, Briefcase, Truck, Home, Calculator, X, MessageCircle, Hash, ChevronDown, Search, Download, Settings
} from 'lucide-react';
import { generateSearchReport } from '../services/pdfExportService';
import { TimeEntry, UserSettings, UserAbsence, VacationRequest } from '../types';
import EmergencyCalendar from '../components/EmergencyCalendar';
import { useToast } from '../components/Toast';
import { SubmissionTimer } from '../components/SubmissionTimer';

const OfficeDashboard: React.FC = () => {
    const { showToast } = useToast();
    const { users, fetchAllUsers } = useOfficeService();
    const { departments } = useDepartments();
    const navigate = useNavigate();

    // Data State
    const [pendingConfirmations, setPendingConfirmations] = useState<TimeEntry[]>([]);
    const [pendingPeerReviews, setPendingPeerReviews] = useState<TimeEntry[]>([]);
    const [myPendingChanges, setMyPendingChanges] = useState<TimeEntry[]>([]);
    const [pendingVacationRequests, setPendingVacationRequests] = useState<VacationRequest[]>([]);
    const [pendingChangeRequests, setPendingChangeRequests] = useState<any[]>([]);
    const [pendingSwapRequests, setPendingSwapRequests] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const [currentUser, setCurrentUser] = useState<UserSettings | null>(null);
    const [closedMonths, setClosedMonths] = useState<string[]>([]);

    // Modal State
    const [reviewModal, setReviewModal] = useState<{ isOpen: boolean, userId: string | null }>({ isOpen: false, userId: null });
    const [rejectionState, setRejectionState] = useState<{ entryId: string | null; reason: string }>({ entryId: null, reason: '' });
    const [peerRejectionState, setPeerRejectionState] = useState<{ entryId: string | null; reason: string }>({ entryId: null, reason: '' });
    const [changeRequestRejection, setChangeRequestRejection] = useState<{ historyId: string | null; reason: string }>({ historyId: null, reason: '' });

    // Collapsible Sections State
    const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('dashboard_collapsed');
            return saved ? JSON.parse(saved) : {};
        }
        return {};
    });

    const toggleSection = (section: string) => {
        setCollapsedSections(prev => {
            const next = { ...prev, [section]: !prev[section] };
            localStorage.setItem('dashboard_collapsed', JSON.stringify(next));
            return next;
        });
    };

    // SEARCH STATE
    const [searchModalOpen, setSearchModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchUsers, setSearchUsers] = useState<string[]>([]);
    const [searchTypes, setSearchTypes] = useState<string[]>([]);
    const [searchStartDate, setSearchStartDate] = useState('');
    const [searchEndDate, setSearchEndDate] = useState('');
    const [searchResults, setSearchResults] = useState<TimeEntry[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);

    const handleSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        
        if (!searchQuery.trim() && searchUsers.length === 0 && searchTypes.length === 0 && !searchStartDate && !searchEndDate) return;

        setIsSearching(true);
        setHasSearched(false);
        try {
            // TIME ENTRIES QUERY
            let timeQuery = supabase.from('time_entries').select('*').is('deleted_at', null);

            // ABSENCES QUERY
            let absenceQuery = supabase.from('user_absences').select('*').eq('is_deleted', false);

            if (searchQuery.trim()) {
                const terms = searchQuery.trim().split(/\s+/);
                
                // For time entries: search client_name or order_number
                const timeConditions = terms.map(term => `client_name.ilike.%${term}%,order_number.ilike.%${term}%`).join(',');
                timeQuery = timeQuery.or(timeConditions);
                
                // For absences: search note
                const absenceConditions = terms.map(term => `note.ilike.%${term}%`).join(',');
                absenceQuery = absenceQuery.or(absenceConditions);
            }

            if (searchUsers.length > 0) {
                timeQuery = timeQuery.in('user_id', searchUsers);
                absenceQuery = absenceQuery.in('user_id', searchUsers);
            }

            // Determine if we should fetch TimeEntries or Absences based on types
            let fetchTime = true;
            let fetchAbsence = true;

            const absenceTypesList = ['vacation', 'sick', 'holiday', 'unpaid', 'sick_child', 'sick_pay', 'special_holiday'];
            
            if (searchTypes.length > 0) {
                const tTypes = searchTypes.filter(t => !absenceTypesList.includes(t));
                const aTypes = searchTypes.filter(t => absenceTypesList.includes(t));

                if (tTypes.length > 0) {
                    timeQuery = timeQuery.in('type', tTypes);
                } else {
                    fetchTime = false; // Only absence types selected
                }

                if (aTypes.length > 0) {
                    absenceQuery = absenceQuery.in('type', aTypes);
                } else {
                    fetchAbsence = false; // Only time entry types selected
                }
            }

            if (searchStartDate) {
                timeQuery = timeQuery.gte('date', searchStartDate);
                absenceQuery = absenceQuery.gte('start_date', searchStartDate);
            }

            if (searchEndDate) {
                timeQuery = timeQuery.lte('date', searchEndDate);
                absenceQuery = absenceQuery.lte('start_date', searchEndDate); 
            }

            let combinedResults: TimeEntry[] = [];

            if (fetchTime) {
                const { data: tData, error: tError } = await timeQuery.order('date', { ascending: false }).limit(1000);
                if (tError) throw tError;
                if (tData) combinedResults.push(...(tData as TimeEntry[]));
            }

            if (fetchAbsence) {
                const { data: aData, error: aError } = await absenceQuery.order('start_date', { ascending: false }).limit(1000);
                if (aError) throw aError;
                if (aData) {
                    const mappedAbsences = aData.map((abs: any) => {
                        const typeLabels: Record<string, string> = {
                            vacation: 'Urlaub', sick: 'Krank', holiday: 'Feiertag', unpaid: 'Unbezahlt',
                            sick_child: 'Kind krank', sick_pay: 'Krankengeld', special_holiday: 'Sonderurlaub'
                        };
                        return {
                            ...abs,
                            id: abs.id,
                            user_id: abs.user_id,
                            date: abs.start_date, // Map start_date to date for unified sorting and display
                            end_date: abs.end_date,
                            client_name: typeLabels[abs.type] || 'Abwesenheit',
                            hours: 0, // Placeholder, logic in UI handles absences
                            type: abs.type,
                            note: abs.note,
                            isAbsence: true
                        } as TimeEntry;
                    });
                    combinedResults.push(...mappedAbsences);
                }
            }

            // Sort descending by date
            combinedResults.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            setSearchResults(combinedResults);
        } catch (err) {
            console.error("Search error:", err);
            showToast("Fehler bei der Suche", "error");
        } finally {
            setIsSearching(false);
            setHasSearched(true);
        }
    };

    const groupedSearchResults = useMemo(() => {
        const groups: Record<string, TimeEntry[]> = {};
        searchResults.forEach(e => {
            if (!groups[e.user_id]) groups[e.user_id] = [];
            groups[e.user_id].push(e);
        });
        return groups;
    }, [searchResults]);

    const [expandedVacationUsers, setExpandedVacationUsers] = useState<string[]>([]);
    const toggleVacationUser = (userId: string) => {
        setExpandedVacationUsers(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
    };

    // Initial Load & Realtime Subscription
    useEffect(() => {
        let channel: ReturnType<typeof supabase.channel>;

        const init = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                // Ensure users are loaded
                if (users.length === 0) await fetchAllUsers();

                const found = users.find(u => u.user_id === user.id);
                if (found) setCurrentUser(found);

                const userId = user.id;
                const userRole = found?.role || 'installer';

                // Fetch Initial
                fetchDashboardData(userId, userRole, false);

                // Realtime Subscription
                channel = supabase
                    .channel('office_dashboard_realtime')
                    .on(
                        'postgres_changes',
                        { event: '*', schema: 'public', table: 'time_entries' },
                        () => {
                            console.log("Realtime Update (TimeEntries) triggering fetchDashboardData...");
                            fetchDashboardData(userId, userRole, true);
                        }
                    )
                    .on(
                        'postgres_changes',
                        { event: '*', schema: 'public', table: 'vacation_requests' },
                        () => {
                            console.log("Realtime Update (VacationRequests) triggering fetchDashboardData...");
                            fetchDashboardData(userId, userRole, true);
                        }
                    )
                    .subscribe();
            }
        };

        init();

        return () => {
            if (channel) supabase.removeChannel(channel);
        };
    }, [users.length]); // Dependency on users length to ensure we try again if users load late

    const fetchDashboardData = async (userId: string, role: string, isBackgroundUpdate = false) => {
        if (!isBackgroundUpdate) setLoading(true);
        console.log("Fetching dashboard data for:", userId, role, isBackgroundUpdate ? "(Background)" : "(Initial)");

        // 1. MY PENDING CHANGES (As Employee: entries changed by admin/office waiting for MY confirmation)
        // Fields: change_confirmed_by_user = false AND last_changed_by != me
        const { data: myChanges, error: myChangesError } = await supabase
            .from('time_entries')
            .select('*')
            .eq('user_id', userId)
            .eq('change_confirmed_by_user', false)
            .neq('last_changed_by', userId); // Only if I didn't change it myself (which shouldn't happen usually but strict check)

        if (myChangesError) console.error("Error fetching my changes:", myChangesError);
        else setMyPendingChanges(myChanges as TimeEntry[]);


        // 2. EMPLOYEE APPROVALS (As Manager/Office: entries needing confirmation)
        // Logic:
        // - Admin/Office sees ALL unconfirmed entries specific types (company, office, etc.)
        // - Future: Filter by Dept responsibility? For now, User said "Office/Admin see all"
        // - Azubi/Installer should NOT see this section ideally, but if they have sub-roles? 
        //   User said: "azubi/installer... darf nichts von azubi b sehen". So strict check.

        // 2 & 4. COMBINED FETCH: GET ALL UNCONFIRMED ENTRIES
        if (role === 'admin' || role === 'office') {
            const { data: allUnconfirmed, error: fetchError } = await supabase
                .from('time_entries')
                .select('*')
                .is('confirmed_at', null);

            if (fetchError) {
                console.error("Error fetching unconfirmed entries:", fetchError);
            } else {
                const entries = allUnconfirmed as TimeEntry[];
                const confirmationTypes = ['company', 'office', 'warehouse', 'car', 'overtime_reduction'];

                // A) PENDING APPROVALS ("Zur Freigabe (Mitarbeiter)")
                // Logic: 
                // 1. Standard Admin Review Types (Company, Office, etc.)
                // 2. OR Entries specifically assigned to ME (e.g. Late Entries assigned to Retro Manager)
                // 3. OR Late Entries (if Admin/Office and no specific responsible user - fallback check)
                const approvals = entries.filter(e =>
                    (
                        (confirmationTypes.includes(e.type || '') && !e.late_reason) ||
                        e.responsible_user_id === userId ||
                        (e.late_reason && !e.responsible_user_id) // Fallback for unassigned late entries (Admins see them)
                    ) &&
                    !e.rejected_at // Hide rejected entries
                );
                setPendingConfirmations(approvals);

                // B) PEER REVIEWS ("Ausstehende Mitarbeiter-Bestätigungen")
                // Logic: Has Responsible User OR Late Reason.
                // Filter out "Legacy/Unknown" entries (no responsible, no late reason).
                // Filter out entries that are ALREADY in "My Approvals" to avoid duplicates? 
                // The user said "appears in Peer Review but NOT in Approvals". Usually duplicates are acceptable or peer review is "Global View".
                // Let's keep it as "Global View of Pending Reviews" but filtered for specific logic.
                const reviews = entries.filter(e => {
                    // 1. Must have a reviewer assigned OR be a late entry
                    const hasReviewerOrLate = !!e.responsible_user_id || !!e.late_reason;
                    // 2. Hide "Legacy" entries (both missing)
                    if (!hasReviewerOrLate) return false;

                    return true;
                });
                setPendingPeerReviews(reviews);
            }

            // 3. VACATION REQUESTS (As Manager/Office)
            const { data: requests, error: requestsError } = await supabase
                .from('vacation_requests')
                .select('*')
                .eq('status', 'pending');

            if (requestsError) console.error("Error fetching requests:", requestsError);
            else setPendingVacationRequests(requests as VacationRequest[]);

            // 5. CHANGE REQUESTS (User-submitted edit requests on submitted entries)
            const { data: changeReqs, error: changeReqError } = await supabase
                .from('entry_change_history')
                .select('*, time_entries!inner(user_id, client_name, hours, date, start_time, end_time, note, order_number, type)')
                .eq('status', 'change_requested')
                .order('changed_at', { ascending: false });

            if (changeReqError) console.error("Error fetching change requests:", changeReqError);
            else setPendingChangeRequests(changeReqs || []);

            // 6. EMERGENCY SWAP REQUESTS
            const { data: swapReqs, error: swapReqError } = await supabase
                .from('emergency_schedule')
                .select('*')
                .eq('swap_status', 'pending');

            if (swapReqError) console.error("Error fetching swap requests:", swapReqError);
            else setPendingSwapRequests(swapReqs || []);

            // 7. CLOSED MONTHS
            const { data: closed, error: closedError } = await supabase.from('closed_months').select('month').order('month', { ascending: false });
            if (closedError) console.error("Error fetching closed months:", closedError);
            else if (closed) setClosedMonths(closed.map(c => c.month));
        }

        setLoading(false);
    };

    // --- Actions ---

    // Toggle Closed Month
    const handleToggleMonth = async (monthStr: string, isCurrentlyClosed: boolean) => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                showToast("Nicht authentifiziert.", "error");
                return;
            }

            if (isCurrentlyClosed) {
                const { error } = await supabase.from('closed_months').delete().eq('month', monthStr);
                if (error) {
                    showToast("Fehler beim Öffnen des Monats: " + error.message, "error");
                } else {
                    showToast(`Monat ${monthStr} wieder geöffnet`, "success");
                    setClosedMonths(prev => prev.filter(m => m !== monthStr));
                }
            } else {
                const { error } = await supabase.from('closed_months').insert({ 
                    month: monthStr, 
                    closed_by: user.id 
                });
                if (error) {
                    showToast("Fehler beim Abschließen des Monats: " + error.message, "error");
                } else {
                    showToast(`Monat ${monthStr} abgeschlossen`, "success");
                    setClosedMonths(prev => [...prev, monthStr]);
                }
            }
        } catch (err: any) {
            console.error("Month toggle error:", err);
            showToast("Systemfehler beim Monatsabschluss: " + err.message, "error");
        }
    };

    // Confirm Change (User accepts Admin edit)
    const handleConfirmChange = async (entry: TimeEntry) => {
        const { error } = await supabase.from('time_entries').update({
            change_confirmed_by_user: true
        }).eq('id', entry.id);

        if (!error) {
            setMyPendingChanges(prev => prev.filter(e => e.id !== entry.id));
        }
    };

    // Quick Grouping for Approvals
    const approvalsByUser = useMemo(() => {
        const groups: Record<string, TimeEntry[]> = {};
        pendingConfirmations.forEach(entry => {
            if (!groups[entry.user_id]) groups[entry.user_id] = [];
            groups[entry.user_id].push(entry);
        });
        return groups;
    }, [pendingConfirmations]);

    // Group Vacation Requests by User
    const vacationRequestsByUser = useMemo(() => {
        const groups: Record<string, VacationRequest[]> = {};
        pendingVacationRequests.forEach(req => {
            if (!groups[req.user_id]) groups[req.user_id] = [];
            groups[req.user_id].push(req);
        });
        return groups;
    }, [pendingVacationRequests]);


    const isOfficeOrAdmin = currentUser?.role === 'admin' || currentUser?.role === 'office';

    if (loading) {
        return (
            <div className="flex justify-center items-center h-full">
                <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    const handleConfirmEntry = async (entryId: string) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { error } = await supabase.from('time_entries').update({
            confirmed_by: user.id,
            confirmed_at: new Date().toISOString()
        }).eq('id', entryId);

        if (!error) {
            setPendingConfirmations(prev => prev.filter(e => e.id !== entryId));
            // Check if user list is empty for modal
            const remaining = pendingConfirmations.filter(e => e.id !== entryId && e.user_id === reviewModal.userId);
            if (remaining.length === 0) setReviewModal({ isOpen: false, userId: null });
        }
    };

    const handleRejectEntry = async () => {
        if (!rejectionState.entryId || !rejectionState.reason.trim()) return;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { error } = await supabase.from('time_entries').update({
            rejected_by: user.id,
            rejection_reason: rejectionState.reason,
            rejected_at: new Date().toISOString(),
            confirmed_at: null
        }).eq('id', rejectionState.entryId);

        if (!error) {
            setPendingConfirmations(prev => prev.filter(e => e.id !== rejectionState.entryId));

            const remaining = pendingConfirmations.filter(e => e.id !== rejectionState.entryId && e.user_id === reviewModal.userId);
            if (remaining.length === 0) setReviewModal({ isOpen: false, userId: null });
            setRejectionState({ entryId: null, reason: '' });
        }
    };

    // Confirm Peer Review (Admin/Office acts on behalf of absent peer reviewer)
    const handleConfirmPeerReview = async (entryId: string) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { error } = await supabase.from('time_entries').update({
            confirmed_by: user.id,
            confirmed_at: new Date().toISOString()
        }).eq('id', entryId);

        if (!error) {
            setPendingPeerReviews(prev => prev.filter(e => e.id !== entryId));
            // Also remove from pendingConfirmations if it appears there
            setPendingConfirmations(prev => prev.filter(e => e.id !== entryId));
        }
    };

    // Reject Peer Review (Admin/Office rejects on behalf of absent peer reviewer)
    const handleRejectPeerReview = async () => {
        if (!peerRejectionState.entryId || !peerRejectionState.reason.trim()) return;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { error } = await supabase.from('time_entries').update({
            rejected_by: user.id,
            rejection_reason: peerRejectionState.reason,
            rejected_at: new Date().toISOString(),
            confirmed_at: null
        }).eq('id', peerRejectionState.entryId);

        if (!error) {
            setPendingPeerReviews(prev => prev.filter(e => e.id !== peerRejectionState.entryId));
            setPendingConfirmations(prev => prev.filter(e => e.id !== peerRejectionState.entryId));
            setPeerRejectionState({ entryId: null, reason: '' });
        }
    };

    // Confirm ALL peer reviews at once
    const handleConfirmAllPeerReviews = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const ids = pendingPeerReviews.map(e => e.id);
        if (ids.length === 0) return;

        const { error } = await supabase.from('time_entries').update({
            confirmed_by: user.id,
            confirmed_at: new Date().toISOString()
        }).in('id', ids);

        if (!error) {
            setPendingPeerReviews([]);
            setPendingConfirmations(prev => prev.filter(e => !ids.includes(e.id)));
        }
    };

    // Approve Change Request (apply changes to entry)
    const handleApproveChangeRequest = async (historyId: string) => {
        const { error } = await supabase.rpc('handle_change_request', {
            p_history_id: historyId,
            p_action: 'approve'
        });

        if (error) {
            console.error('Error approving change request:', error);
            showToast('Fehler beim Genehmigen: ' + error.message, "error");
        } else {
            setPendingChangeRequests(prev => prev.filter(r => r.id !== historyId));
        }
    };

    // Reject Change Request
    const handleRejectChangeRequest = async () => {
        if (!changeRequestRejection.historyId || !changeRequestRejection.reason.trim()) return;

        const { error } = await supabase.rpc('handle_change_request', {
            p_history_id: changeRequestRejection.historyId,
            p_action: 'reject',
            p_note: changeRequestRejection.reason
        });

        if (error) {
            console.error('Error rejecting change request:', error);
            showToast('Fehler beim Ablehnen: ' + error.message, "error");
        } else {
            setPendingChangeRequests(prev => prev.filter(r => r.id !== changeRequestRejection.historyId));
            setChangeRequestRejection({ historyId: null, reason: '' });
        }
    };

    return (
        <div className="p-6 h-full overflow-y-auto md:max-w-7xl md:mx-auto w-full pb-24 space-y-8">

            {/* Header */}
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-200 to-emerald-400">
                        Dashboard
                    </h1>
                    <p className="text-white/50 text-sm mt-1">
                        {isOfficeOrAdmin ? 'Kommandozentrale & Übersicht' : 'Meine Aufgaben'}
                    </p>
                </div>
                {/* Search & Management Buttons */}
                <div className="flex gap-2">
                    {isOfficeOrAdmin && (
                        <button
                            onClick={() => navigate('/office/management')}
                            className="p-3 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 text-white/70 hover:text-white transition-all group"
                            title="System-Verwaltung"
                        >
                            <Settings size={22} className="group-hover:rotate-90 transition-transform duration-500" />
                        </button>
                    )}
                    <button
                        onClick={() => setSearchModalOpen(true)}
                        className="p-3 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 text-white/70 hover:text-white transition-all group"
                        title="Suche öffnen"
                    >
                        <Search size={22} className="group-hover:scale-110 transition-transform" />
                    </button>
                </div>
            </div>

            {/* SECTION 1: MY PENDING CONFIRMATIONS (Everyone) */}
            {myPendingChanges.length > 0 && (
                <div className="animate-in slide-in-from-bottom-4">
                    <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                        <UserCheck size={24} className="text-orange-400" />
                        <span className="text-orange-100">Änderungen bestätigen</span>
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {myPendingChanges.map(entry => (
                            <GlassCard key={entry.id} className="animate-in fade-in zoom-in-95 duration-500 border-orange-500/30 bg-orange-900/10 hover:border-orange-500/50 transition-colors">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-bold text-orange-300 uppercase tracking-wider">
                                        {new Date(entry.date).toLocaleDateString('de-DE')}
                                    </span>
                                    <span className="bg-orange-500/20 text-orange-200 text-[10px] px-2 py-0.5 rounded uppercase font-bold">
                                        Geändert
                                    </span>
                                </div>
                                <div className="text-sm text-white/80 mb-4">
                                    <p>Ihre Zeit wurde bearbeitet von <span className="text-orange-300 font-bold">{users.find(u => u.user_id === entry.last_changed_by)?.display_name || 'Büro'}</span>.</p>
                                    {entry.change_reason && (
                                        <div className="mt-2 text-xs italic text-white/50 bg-black/20 p-2 rounded border border-white/5">
                                            "{entry.change_reason}"
                                        </div>
                                    )}
                                    <div className="mt-2 pt-2 border-t border-white/5">
                                        <SubmissionTimer entryDate={entry.date} submitted={!!entry.submitted} />
                                    </div>
                                    </div>

                                <div className="flex justify-end gap-2">
                                    <button
                                        onClick={() => handleConfirmChange(entry)}
                                        className="bg-orange-500 hover:bg-orange-400 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-2 transition-colors"
                                    >
                                        <CheckCircle size={14} /> Akzeptieren
                                    </button>
                                </div>
                            </GlassCard>
                        ))}
                    </div>
                </div>
            )}


            {/* SECTION 2: OFFICE TASKS (Admin/Office Only) */}
            {isOfficeOrAdmin && (
                <>
                    {/* Vacation Requests */}
                    {/* Vacation Requests */}
                    {pendingVacationRequests.length > 0 && (
                        <div className="animate-in slide-in-from-bottom-5">
                            <button
                                onClick={() => toggleSection('vacation')}
                                className="w-full text-left mb-4 flex items-center gap-2 group focus:outline-none"
                            >
                                <div className={`p-1 rounded transition-colors ${collapsedSections['vacation'] ? 'text-white/30 group-hover:bg-white/10' : 'text-purple-400'}`}>
                                    {collapsedSections['vacation'] ? <ChevronRight size={24} /> : <ChevronDown size={24} />}
                                </div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Palmtree size={24} className="text-purple-400" />
                                    <span className="text-purple-100">Offene Urlaubsanträge</span>
                                    <span className="text-sm bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full ml-2">
                                        {pendingVacationRequests.length}
                                    </span>
                                </h2>
                            </button>

                            {!collapsedSections['vacation'] && (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pl-2 border-l-2 border-purple-500/10 mb-8">
                                    {Object.keys(vacationRequestsByUser).map(userId => {
                                        const userRequests = vacationRequestsByUser[userId];
                                        const requester = users.find(u => u.user_id === userId);
                                        const isExpanded = expandedVacationUsers.includes(userId);

                                        return (
                                            <div key={userId} className="contents">
                                                <GlassCard
                                                    className={`border-purple-500/30 bg-purple-900/10 cursor-pointer hover:bg-purple-900/20 transition-all group ${isExpanded ? 'lg:col-span-3 md:col-span-2' : ''}`}
                                                    onClick={() => toggleVacationUser(userId)}
                                                >
                                                    <div className="flex justify-between items-start">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center font-bold text-purple-300 text-lg border border-purple-500/30">
                                                                {requester?.display_name.charAt(0) || '?'}
                                                            </div>
                                                            <div>
                                                                <h3 className="font-bold text-white leading-tight">{requester?.display_name || 'Unbekannt'}</h3>
                                                                <p className="text-xs text-purple-300 font-medium">{userRequests.length} offene Anträge</p>
                                                            </div>
                                                        </div>
                                                        <div className={`text-white/30 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                                                            <ChevronRight size={20} />
                                                        </div>
                                                    </div>

                                                    {isExpanded && (
                                                        <div className="mt-4 pt-4 border-t border-white/5 space-y-3 animate-in slide-in-from-top-2">
                                                            {userRequests.map(req => (
                                                                <div key={req.id} className="bg-black/20 rounded-lg p-3 hover:bg-black/30 transition-colors cursor-default" onClick={(e) => e.stopPropagation()}>
                                                                    <div className="flex justify-between items-center mb-2">
                                                                        <span className="text-xs text-white/50">Antrag vom {new Date(req.created_at).toLocaleDateString('de-DE')}</span>
                                                                        <button
                                                                            onClick={() => navigate(`/office/user/${req.user_id}`)}
                                                                            className="text-xs text-purple-400 font-bold hover:underline flex items-center gap-1"
                                                                        >
                                                                            Bearbeiten <ChevronRight size={12} />
                                                                        </button>
                                                                    </div>
                                                                    <div className="flex justify-between items-center">
                                                                        <div>
                                                                            <span className="block text-[10px] text-white/40 uppercase font-bold">Start</span>
                                                                            <span className="text-sm font-bold text-white">{new Date(req.start_date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                                                                        </div>
                                                                        <ArrowRight size={14} className="text-white/20" />
                                                                        <div className="text-right">
                                                                            <span className="block text-[10px] text-white/40 uppercase font-bold">Ende</span>
                                                                            <span className="text-sm font-bold text-white">{new Date(req.end_date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                                                                        </div>
                                                                    </div>
                                                                    {req.note && (
                                                                        <div className="mt-2 text-xs text-white/50 italic border-l-2 border-white/10 pl-2">
                                                                            "{req.note}"
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </GlassCard>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* SECTION 3.5: NOTDIENST PLAN (Admin/Office Only) */}
                    {isOfficeOrAdmin && (
                        <div className="animate-in slide-in-from-bottom-5">
                            <button
                                onClick={() => toggleSection('emergency')}
                                className="w-full text-left mb-4 flex items-center gap-2 group focus:outline-none"
                            >
                                <div className={`p-1 rounded transition-colors ${collapsedSections['emergency'] ? 'text-white/30 group-hover:bg-white/10' : 'text-rose-400'}`}>
                                    {collapsedSections['emergency'] ? <ChevronRight size={24} /> : <ChevronDown size={24} />}
                                </div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Shield size={24} className="text-rose-400" />
                                    <span className="text-rose-100">Notdienst Plan</span>
                                </h2>
                                {pendingSwapRequests.length > 0 && (
                                    <span className="bg-orange-500/20 text-orange-400 text-xs font-bold px-2 py-1 rounded-full border border-orange-500/30">
                                        {pendingSwapRequests.length} offene Anfragen
                                    </span>
                                )}
                            </button>

                            {!collapsedSections['emergency'] && (
                                <EmergencyCalendar isAdmin={true} users={users} />
                            )}
                        </div>
                    )}

                    {/* SECTION 4: GLOBAL PEER REVIEWS (Admin/Office Only) */}
                    {isOfficeOrAdmin && pendingPeerReviews.length > 0 && (
                        <div className="animate-in slide-in-from-bottom-6">
                            <div
                                className="flex items-center justify-between cursor-pointer mb-4"
                                onClick={() => toggleSection('peerReviews')}
                            >
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <UserCheck size={24} className="text-teal-400" />
                                    <span className="text-teal-100">Ausstehende Mitarbeiter-Bestätigungen</span>
                                    <span className="bg-teal-500/20 text-teal-300 text-xs px-2 py-0.5 rounded-full border border-teal-500/30">
                                        {pendingPeerReviews.length}
                                    </span>
                                </h2>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleConfirmAllPeerReviews(); }}
                                        className="text-xs font-bold text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                                        title="Alle ausstehenden Peer-Reviews bestätigen"
                                    >
                                        <CheckCircle size={14} /> Alle bestätigen
                                    </button>
                                    <div className={`p-2 rounded-lg transition-colors ${collapsedSections['peerReviews'] ? 'bg-white/5' : 'bg-white/10'}`}>
                                        <ChevronRight size={20} className={`text-white/50 transition-transform ${!collapsedSections['peerReviews'] ? 'rotate-90' : ''}`} />
                                    </div>
                                </div>
                            </div>

                            {!collapsedSections['peerReviews'] && (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8 pl-2 border-l-2 border-teal-500/10">
                                    {pendingPeerReviews.map(entry => {
                                        const creator = users.find(u => u.user_id === entry.user_id);
                                        const reviewer = users.find(u => u.user_id === entry.responsible_user_id);
                                        const isRejectingThis = peerRejectionState.entryId === entry.id;

                                        return (
                                            <GlassCard key={entry.id} className="animate-in fade-in zoom-in-95 duration-500 !p-4 bg-teal-900/5 border-teal-500/20 hover:border-teal-500/40 relative overflow-hidden group/card">
                                                <div className="absolute top-0 right-0 p-2 opacity-50">
                                                    <Clock size={40} className="text-teal-500/10" />
                                                </div>

                                                <div className="relative z-10">
                                                    {/* Header: Date, Client, Hours & Note */}
                                                    <div className="mb-3 border-b border-white/5 pb-2">
                                                        <div className="flex justify-between items-center mb-1">
                                                            <div className="text-xs font-bold text-teal-400 uppercase tracking-wider">
                                                                {new Date(entry.date).toLocaleDateString('de-DE')}
                                                            </div>
                                                            <div className="text-xs font-bold text-white bg-white/10 px-1.5 py-0.5 rounded">
                                                                {entry.hours.toFixed(2)} Std.
                                                            </div>
                                                        </div>
                                                        <div className="font-bold text-white text-sm truncate mb-1 flex items-center gap-2" title={entry.client_name}>
                                                            {entry.client_name}
                                                            {entry.order_number && (
                                                                <span
                                                                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(entry.order_number || ''); }}
                                                                    className="inline-flex items-center gap-0.5 bg-white/10 px-1.5 py-0.5 rounded text-[10px] text-white/50 font-mono tracking-wide border border-white/5 shrink-0 cursor-pointer hover:bg-white/20 active:scale-95 transition-all"
                                                                    title="Klicken zum Kopieren"
                                                                >
                                                                    {entry.order_number}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {entry.note && (
                                                            <div className="text-xs text-white/50 italic truncate" title={entry.note}>
                                                                "{entry.note}"
                                                            </div>
                                                        )}
                                                        <div className="mt-2 pt-2 border-t border-white/5">
                                                            <SubmissionTimer entryDate={entry.date} submitted={!!entry.submitted} />
                                                        </div>
                                                    </div>

                                                    {/* Late reason if present */}
                                                    {entry.late_reason && (
                                                        <div className="mb-3 text-xs text-amber-300 italic bg-amber-500/10 p-1.5 rounded border border-amber-500/20 flex gap-2 items-start">
                                                            <Clock size={12} className="mt-0.5 shrink-0" />
                                                            <span>Rückwirkend: {entry.late_reason}</span>
                                                        </div>
                                                    )}

                                                    {/* Actors: Creator -> Reviewer */}
                                                    <div className="flex items-center gap-3 mb-3">
                                                        {/* Creator */}
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-[10px] uppercase text-white/40 font-bold mb-1">Ersteller</div>
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-6 h-6 rounded-full bg-teal-500/20 flex items-center justify-center text-[10px] font-bold text-teal-300 shrink-0">
                                                                    {creator?.display_name.charAt(0) || '?'}
                                                                </div>
                                                                <div className="truncate text-sm text-teal-100 font-medium">
                                                                    {creator?.display_name || 'Unbekannt'}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="text-white/20">
                                                            <ArrowRight size={16} />
                                                        </div>

                                                        {/* Reviewer */}
                                                        <div className="flex-1 min-w-0 text-right">
                                                            <div className="text-[10px] uppercase text-white/40 font-bold mb-1">Prüfer</div>
                                                            <div className="flex items-center justify-end gap-2">
                                                                {reviewer ? (
                                                                    <>
                                                                        <div className="truncate text-sm text-orange-200/80 font-medium">
                                                                            {reviewer.display_name}
                                                                        </div>
                                                                        <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center text-[10px] font-bold text-orange-300 shrink-0">
                                                                            {reviewer.display_name.charAt(0)}
                                                                        </div>
                                                                    </>
                                                                ) : entry.late_reason ? (
                                                                    <>
                                                                        <div className="truncate text-sm text-orange-200/80 font-medium">
                                                                            Admin-Prüfung
                                                                        </div>
                                                                        <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center text-[10px] font-bold text-red-300 shrink-0" title="Rückwirkende Erfassung">
                                                                            <Shield size={12} />
                                                                        </div>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <div className="truncate text-sm text-white/30 font-medium">
                                                                            Unbekannt
                                                                        </div>
                                                                        <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-white/30 shrink-0">
                                                                            ?
                                                                        </div>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Action Buttons */}
                                                    {!isRejectingThis && (
                                                        <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                                                            <button
                                                                onClick={() => handleConfirmPeerReview(entry.id)}
                                                                className="p-1.5 bg-emerald-500/20 hover:bg-emerald-500 text-emerald-400 hover:text-white rounded transition-colors flex items-center gap-1.5 text-xs font-bold px-3"
                                                                title="Eintrag bestätigen"
                                                            >
                                                                <CheckCircle size={14} /> Bestätigen
                                                            </button>
                                                            <button
                                                                onClick={() => setPeerRejectionState({ entryId: entry.id, reason: '' })}
                                                                className="p-1.5 bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white rounded transition-colors flex items-center gap-1.5 text-xs font-bold px-3"
                                                                title="Eintrag ablehnen"
                                                            >
                                                                <X size={14} /> Ablehnen
                                                            </button>
                                                        </div>
                                                    )}

                                                    {/* Rejection Input */}
                                                    {isRejectingThis && (
                                                        <div className="mt-2 animate-in fade-in slide-in-from-top-2 bg-red-900/20 p-2 rounded-lg border border-red-500/30">
                                                            <p className="text-[10px] uppercase font-bold text-red-300 mb-1">Ablehnungsgrund eingeben:</p>
                                                            <div className="flex gap-2">
                                                                <input
                                                                    type="text"
                                                                    value={peerRejectionState.reason}
                                                                    onChange={e => setPeerRejectionState({ ...peerRejectionState, reason: e.target.value })}
                                                                    className="flex-1 bg-black/30 border border-red-500/30 rounded px-2 py-1 text-xs text-white placeholder-red-300/30 focus:outline-none focus:border-red-400"
                                                                    placeholder="Warum wird abgelehnt?"
                                                                    autoFocus
                                                                    onKeyDown={(e) => { if (e.key === 'Enter' && peerRejectionState.reason.trim()) handleRejectPeerReview(); }}
                                                                />
                                                                <button
                                                                    onClick={handleRejectPeerReview}
                                                                    disabled={!peerRejectionState.reason.trim()}
                                                                    className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-bold px-3 rounded transition-colors"
                                                                >
                                                                    Ablehnen
                                                                </button>
                                                            </div>
                                                            <button onClick={() => setPeerRejectionState({ entryId: null, reason: '' })} className="text-[10px] text-red-300/50 hover:text-red-300 mt-1 underline">Abbrechen</button>
                                                        </div>
                                                    )}
                                                </div>
                                            </GlassCard>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                    {/* SECTION 5: CHANGE REQUESTS (User edit requests on submitted entries) */}
                    {isOfficeOrAdmin && pendingChangeRequests.length > 0 && (
                        <div className="animate-in slide-in-from-bottom-6">
                            <div
                                className="flex items-center justify-between cursor-pointer mb-4"
                                onClick={() => toggleSection('changeRequests')}
                            >
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <FileText size={24} className="text-blue-400" />
                                    <span className="text-blue-100">Änderungsanträge</span>
                                    <span className="bg-blue-500/20 text-blue-300 text-xs px-2 py-0.5 rounded-full border border-blue-500/30">
                                        {pendingChangeRequests.length}
                                    </span>
                                </h2>
                                <div className={`p-2 rounded-lg transition-colors ${collapsedSections['changeRequests'] ? 'bg-white/5' : 'bg-white/10'}`}>
                                    <ChevronRight size={20} className={`text-white/50 transition-transform ${!collapsedSections['changeRequests'] ? 'rotate-90' : ''}`} />
                                </div>
                            </div>

                            {!collapsedSections['changeRequests'] && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 pl-2 border-l-2 border-blue-500/10">
                                    {pendingChangeRequests.map(req => {
                                        const entry = req.time_entries;
                                        const creator = users.find(u => u.user_id === entry?.user_id);
                                        const newVals = req.new_values || {};
                                        const isRejectingThis = changeRequestRejection.historyId === req.id;

                                        return (
                                            <GlassCard key={req.id} className="animate-in fade-in zoom-in-95 duration-500 !p-4 bg-blue-900/5 border-blue-500/20 hover:border-blue-500/40 relative overflow-hidden">
                                                <div className="absolute top-0 right-0 p-2 opacity-30">
                                                    <FileText size={40} className="text-blue-500/10" />
                                                </div>

                                                <div className="relative z-10">
                                                    {/* Header */}
                                                    <div className="mb-3 border-b border-white/5 pb-2">
                                                        <div className="flex justify-between items-center mb-1">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-[10px] font-bold text-blue-300 shrink-0">
                                                                    {creator?.display_name.charAt(0) || '?'}
                                                                </div>
                                                                <span className="text-sm font-bold text-blue-100">{creator?.display_name || 'Unbekannt'}</span>
                                                            </div>
                                                            <span className="text-[10px] text-white/40">
                                                                {new Date(req.changed_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                        </div>
                                                        <div className="text-xs font-bold text-blue-400 uppercase tracking-wider">
                                                            {entry?.date ? new Date(entry.date).toLocaleDateString('de-DE') : ''}
                                                        </div>
                                                    </div>

                                                    {/* Reason */}
                                                    {req.reason && (
                                                        <div className="mb-3 text-xs text-blue-200 italic bg-blue-500/10 p-2 rounded border border-blue-500/20">
                                                            Grund: "{req.reason}"
                                                        </div>
                                                    )}

                                                    {/* Diff View: Old -> New */}
                                                    <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                                                        <div className="bg-red-900/10 p-2 rounded border border-red-500/10">
                                                            <div className="text-[10px] uppercase font-bold text-red-300/60 mb-1">Aktuell</div>
                                                            <div className="font-bold text-white/70 truncate">{entry?.client_name}</div>
                                                            <div className="text-white/40 font-mono">{entry?.hours?.toFixed?.(2) || entry?.hours} h</div>
                                                            {entry?.start_time && <div className="text-white/30">{entry.start_time} - {entry.end_time}</div>}
                                                            {entry?.note && <div className="text-white/30 italic truncate">"{entry.note}"</div>}
                                                        </div>
                                                        <div className="bg-emerald-900/10 p-2 rounded border border-emerald-500/10">
                                                            <div className="text-[10px] uppercase font-bold text-emerald-300/60 mb-1">Neu</div>
                                                            <div className={`font-bold truncate ${newVals.client_name !== entry?.client_name ? 'text-emerald-300' : 'text-white/70'}`}>
                                                                {newVals.client_name || entry?.client_name}
                                                            </div>
                                                            <div className={`font-mono ${parseFloat(newVals.hours) !== entry?.hours ? 'text-emerald-300' : 'text-white/40'}`}>
                                                                {parseFloat(newVals.hours)?.toFixed?.(2) || newVals.hours} h
                                                            </div>
                                                            {(newVals.start_time || entry?.start_time) && (
                                                                <div className={newVals.start_time !== entry?.start_time || newVals.end_time !== entry?.end_time ? 'text-emerald-300' : 'text-white/30'}>
                                                                    {newVals.start_time || entry?.start_time} - {newVals.end_time || entry?.end_time}
                                                                </div>
                                                            )}
                                                            {(newVals.note || entry?.note) && (
                                                                <div className={`italic truncate ${newVals.note !== entry?.note ? 'text-emerald-300' : 'text-white/30'}`}>
                                                                    "{newVals.note || entry?.note}"
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Action Buttons */}
                                                    {!isRejectingThis && (
                                                        <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                                                            <button
                                                                onClick={() => handleApproveChangeRequest(req.id)}
                                                                className="p-1.5 bg-emerald-500/20 hover:bg-emerald-500 text-emerald-400 hover:text-white rounded transition-colors flex items-center gap-1.5 text-xs font-bold px-3"
                                                            >
                                                                <CheckCircle size={14} /> Genehmigen
                                                            </button>
                                                            <button
                                                                onClick={() => setChangeRequestRejection({ historyId: req.id, reason: '' })}
                                                                className="p-1.5 bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white rounded transition-colors flex items-center gap-1.5 text-xs font-bold px-3"
                                                            >
                                                                <X size={14} /> Ablehnen
                                                            </button>
                                                        </div>
                                                    )}

                                                    {/* Rejection Input */}
                                                    {isRejectingThis && (
                                                        <div className="mt-2 animate-in fade-in slide-in-from-top-2 bg-red-900/20 p-2 rounded-lg border border-red-500/30">
                                                            <p className="text-[10px] uppercase font-bold text-red-300 mb-1">Ablehnungsgrund:</p>
                                                            <div className="flex gap-2">
                                                                <input
                                                                    type="text"
                                                                    value={changeRequestRejection.reason}
                                                                    onChange={e => setChangeRequestRejection({ ...changeRequestRejection, reason: e.target.value })}
                                                                    className="flex-1 bg-black/30 border border-red-500/30 rounded px-2 py-1 text-xs text-white placeholder-red-300/30 focus:outline-none focus:border-red-400"
                                                                    placeholder="Warum wird der Antrag abgelehnt?"
                                                                    autoFocus
                                                                    onKeyDown={(e) => { if (e.key === 'Enter' && changeRequestRejection.reason.trim()) handleRejectChangeRequest(); }}
                                                                />
                                                                <button
                                                                    onClick={handleRejectChangeRequest}
                                                                    disabled={!changeRequestRejection.reason.trim()}
                                                                    className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-bold px-3 rounded transition-colors"
                                                                >
                                                                    Ablehnen
                                                                </button>
                                                            </div>
                                                            <button onClick={() => setChangeRequestRejection({ historyId: null, reason: '' })} className="text-[10px] text-red-300/50 hover:text-red-300 mt-1 underline">Abbrechen</button>
                                                        </div>
                                                    )}
                                                </div>
                                            </GlassCard>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Pending Confirmations (Grouped by User) */}
                    <div className="animate-in slide-in-from-bottom-6">
                        <div
                            className="flex items-center justify-between cursor-pointer mb-4"
                            onClick={() => toggleSection('confirmations')}
                        >
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <Shield size={24} className="text-teal-400" />
                                <span className="text-teal-100">Zur Freigabe (Mitarbeiter)</span>
                            </h2>
                            <div className={`p-2 rounded-lg transition-colors ${collapsedSections['confirmations'] ? 'bg-white/5' : 'bg-white/10'}`}>
                                <ChevronRight size={20} className={`text-white/50 transition-transform ${!collapsedSections['confirmations'] ? 'rotate-90' : ''}`} />
                            </div>
                        </div>

                        {!collapsedSections['confirmations'] && (
                            <>
                                {Object.keys(approvalsByUser).length === 0 ? (
                                    <GlassCard className="flex flex-col items-center justify-center p-8 text-white/30 gap-2 border-dashed">
                                        <CheckCircle size={40} className="mb-2" />
                                        <p>Keine offenen Freigaben</p>
                                    </GlassCard>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {Object.keys(approvalsByUser).map(userId => {
                                            const userEntries = approvalsByUser[userId];
                                            const user = users.find(u => u.user_id === userId);
                                            if (!user) return null;

                                            return (
                                                <GlassCard
                                                    key={userId}
                                                    className="group cursor-pointer hover:border-teal-500/50 transition-all border-teal-500/20 bg-teal-900/5"
                                                    onClick={() => setReviewModal({ isOpen: true, userId })}
                                                >
                                                    <div className="flex justify-between items-start mb-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 border border-white/10 flex items-center justify-center font-bold text-white">
                                                                {user.display_name.charAt(0)}
                                                            </div>
                                                            <div>
                                                                <h3 className="font-bold text-white">{user.display_name}</h3>
                                                                <span className="text-[10px] bg-teal-500/10 text-teal-300 px-1.5 py-0.5 rounded border border-teal-500/20 uppercase font-bold tracking-wider">
                                                                    {userEntries.length} Einträge
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <button className="p-2 bg-white/5 rounded-full hover:bg-teal-500/20 text-white/50 hover:text-teal-300 transition-colors">
                                                            <ChevronRight size={20} />
                                                        </button>
                                                    </div>

                                                    {/* Preview of Types */}
                                                    <div className="flex gap-2 flex-wrap mb-2">
                                                        {userEntries.some(e => e.type === 'company') && (
                                                            <span className="text-[10px] flex items-center gap-1 text-white/50 bg-white/5 px-2 py-1 rounded">
                                                                <Briefcase size={10} /> Firma
                                                            </span>
                                                        )}
                                                        {userEntries.some(e => e.type === 'office') && (
                                                            <span className="text-[10px] flex items-center gap-1 text-white/50 bg-white/5 px-2 py-1 rounded">
                                                                <Home size={10} /> Büro
                                                            </span>
                                                        )}
                                                        {userEntries.some(e => e.type === 'car') && (
                                                            <span className="text-[10px] flex items-center gap-1 text-white/50 bg-white/5 px-2 py-1 rounded">
                                                                <Truck size={10} /> Auto
                                                            </span>
                                                        )}
                                                        {userEntries.some(e => e.type === 'overtime_reduction') && (
                                                            <span className="text-[10px] flex items-center gap-1 text-white/50 bg-white/5 px-2 py-1 rounded">
                                                                <Calculator size={10} /> Abbau
                                                            </span>
                                                        )}
                                                        {userEntries.some(e => e.late_reason) && (
                                                            <span className="text-[10px] flex items-center gap-1 text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded font-bold">
                                                                <Clock size={10} /> Rückwirkend
                                                            </span>
                                                        )}
                                                    </div>
                                                </GlassCard>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                </>
            )}

            {
                !isOfficeOrAdmin && myPendingChanges.length === 0 && (
                    <GlassCard className="flex flex-col items-center justify-center p-12 text-white/30 gap-4 mt-8">
                        <CheckCircle size={60} className="text-emerald-500/20" />
                        <div className="text-center">
                            <h3 className="text-lg font-bold text-white/50">Alles erledigt</h3>
                            <p className="text-sm">Aktuell gibt es keine offenen Aufgaben für dich.</p>
                        </div>
                    </GlassCard>
                )
            }

            {/* QUICK REVIEW MODAL */}
            {
                reviewModal.isOpen && reviewModal.userId && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-2xl max-h-[90vh] flex flex-col !p-0 overflow-hidden shadow-2xl border-white/20">
                            {/* Modal Header */}
                            <div className="p-4 bg-gradient-to-r from-gray-900 to-gray-800 border-b border-white/10 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center font-bold text-white shadow-lg">
                                        {users.find(u => u.user_id === reviewModal.userId)?.display_name.charAt(0)}
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-white text-lg">{users.find(u => u.user_id === reviewModal.userId)?.display_name}</h3>
                                        <p className="text-teal-300 text-xs font-bold uppercase tracking-wider">
                                            Freigabe erforderlich
                                        </p>
                                    </div>
                                </div>
                                <button onClick={() => setReviewModal({ isOpen: false, userId: null })} className="p-2 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors">
                                    <X size={24} />
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                                {pendingConfirmations.filter(e => e.user_id === reviewModal.userId).length === 0 && (
                                    <p className="text-white/30 text-center italic py-4">Keine offenen Einträge.</p>
                                )}
                                {pendingConfirmations.filter(e => e.user_id === reviewModal.userId).map(entry => (
                                    <div key={entry.id} className={`bg-white/5 border border-white/10 rounded-xl p-3 hover:bg-white/10 transition-colors ${entry.late_reason ? 'border-amber-500/30 bg-amber-900/10' : ''}`}>
                                        {/* Header Line */}
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-white/80 font-mono">{new Date(entry.date).toLocaleDateString('de-DE')}</span>
                                                <span className="text-white/20">|</span>
                                                {entry.late_reason ? (
                                                    <span className="text-[10px] font-bold uppercase text-amber-400">Rückwirkend</span>
                                                ) : (
                                                    <span className="text-[10px] font-bold uppercase text-teal-300">{entry.type}</span>
                                                )}
                                                <span className="text-white/20">|</span>
                                                <span className="text-sm font-bold font-mono text-white">{entry.hours}h</span>
                                            </div>
                                            {/* Quick Actions (Confirm / Reject) */}
                                            <div className="flex gap-2">
                                                {rejectionState.entryId !== entry.id && (
                                                    <>
                                                        <button onClick={() => handleConfirmEntry(entry.id)} className="p-1.5 bg-emerald-500/20 hover:bg-emerald-500 text-emerald-400 hover:text-white rounded transition-colors" title="Bestätigen">
                                                            <CheckCircle size={16} />
                                                        </button>
                                                        <button onClick={() => setRejectionState({ entryId: entry.id, reason: '' })} className="p-1.5 bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white rounded transition-colors" title="Ablehnen">
                                                            <X size={16} />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Change/Note Info */}
                                        {(entry.note || entry.late_reason) && (
                                            <div className="space-y-1 mb-2">
                                                {entry.late_reason && (
                                                    <div className="text-xs text-amber-300 italic bg-amber-500/10 p-1.5 rounded border border-amber-500/20 flex gap-2 items-start">
                                                        <Clock size={12} className="mt-0.5 shrink-0" />
                                                        <span>Grund: {entry.late_reason}</span>
                                                    </div>
                                                )}
                                                {entry.note && (
                                                    <div className="text-xs text-white/50 italic bg-black/20 p-1.5 rounded border border-white/5">
                                                        "{entry.note}"
                                                    </div>
                                                )}
                                                <div className="mt-2 pt-2 border-t border-white/5">
                                                    <SubmissionTimer entryDate={entry.date} submitted={!!entry.submitted} />
                                                </div>
                                            </div>
                                        )}

                                        {/* Rejection Input */}
                                        {rejectionState.entryId === entry.id && (
                                            <div className="mt-2 animate-in fade-in slide-in-from-top-2 bg-red-900/20 p-2 rounded-lg border border-red-500/30">
                                                <p className="text-[10px] uppercase font-bold text-red-300 mb-1">Ablehnungsgrund eingeben:</p>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={rejectionState.reason}
                                                        onChange={e => setRejectionState({ ...rejectionState, reason: e.target.value })}
                                                        className="flex-1 bg-black/30 border border-red-500/30 rounded px-2 py-1 text-xs text-white placeholder-red-300/30 focus:outline-none focus:border-red-400"
                                                        placeholder="Warum wird abgelehnt?"
                                                        autoFocus
                                                    />
                                                    <button
                                                        onClick={handleRejectEntry}
                                                        disabled={!rejectionState.reason.trim()}
                                                        className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-bold px-3 rounded transition-colors"
                                                    >
                                                        Ablehnen
                                                    </button>
                                                </div>
                                                <button onClick={() => setRejectionState({ entryId: null, reason: '' })} className="text-[10px] text-red-300/50 hover:text-red-300 mt-1 underline">Abbrechen</button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </GlassCard>
                    </div >
                )
            }

            {/* SEARCH MODAL */}
            {
                searchModalOpen && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-4xl max-h-[90vh] flex flex-col !p-0 overflow-hidden shadow-2xl border-white/20">
                            <div className="p-4 bg-gray-900 border-b border-white/10 flex gap-4 items-center">
                                <Search size={24} className="text-teal-400 shrink-0" />
                                <form onSubmit={handleSearch} className="flex-1 relative">
                                    <input
                                        autoFocus
                                        type="text"
                                        className="w-full bg-transparent border-none outline-none text-xl text-white placeholder-white/30"
                                        placeholder="Suche nach Kunde, Auftrag..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                </form>
                                <button
                                    onClick={handleSearch}
                                    className="bg-teal-600 hover:bg-teal-500 text-white px-4 py-2 rounded-lg font-bold text-sm disabled:opacity-50"
                                    disabled={isSearching}
                                >
                                    {isSearching ? '...' : 'Suchen'}
                                </button>
                                <div className="w-px h-8 bg-white/10 mx-2"></div>
                                <button onClick={() => setSearchModalOpen(false)} className="text-white/50 hover:text-white"><X size={24} /></button>
                            </div>
                            
                            {/* FILTER OPTIONS */}
                            <div className="bg-gray-900 border-b border-white/10 p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div>
                                    <label className="block text-[10px] text-white/50 uppercase font-bold mb-1">Mitarbeiter</label>
                                    <select
                                        value={searchUsers[0] || ''}
                                        onChange={e => setSearchUsers(e.target.value ? [e.target.value] : [])}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500/50"
                                    >
                                        <option value="" className="bg-gray-900">Alle Mitarbeiter</option>
                                        {users.map(u => (
                                            <option key={u.user_id} value={u.user_id} className="bg-gray-900">{u.display_name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] text-white/50 uppercase font-bold mb-1">Eintrags-Typ</label>
                                    <select
                                        value={searchTypes[0] || ''}
                                        onChange={e => setSearchTypes(e.target.value ? [e.target.value] : [])}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500/50"
                                    >
                                        <option value="" className="bg-gray-900">Alle Typen</option>
                                        <option value="work" className="bg-gray-900">Arbeit / Projekt</option>
                                        <option value="break" className="bg-gray-900">Pause</option>
                                        <option value="company" className="bg-gray-900">Firma</option>
                                        <option value="office" className="bg-gray-900">Büro</option>
                                        <option value="warehouse" className="bg-gray-900">Lager</option>
                                        <option value="car" className="bg-gray-900">Auto / Fahrt</option>
                                        <option value="vacation" className="bg-gray-900">Urlaub</option>
                                        <option value="sick" className="bg-gray-900">Krank</option>
                                        <option value="holiday" className="bg-gray-900">Feiertag</option>
                                        <option value="unpaid" className="bg-gray-900">Unbezahlt</option>
                                        <option value="sick_child" className="bg-gray-900">Kind krank</option>
                                        <option value="sick_pay" className="bg-gray-900">Krankengeld</option>
                                        <option value="overtime_reduction" className="bg-gray-900">Gutstunden</option>
                                        <option value="emergency_service" className="bg-gray-900">Notdienst</option>
                                        <option value="special_holiday" className="bg-gray-900">Sonderurlaub</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] text-white/50 uppercase font-bold mb-1">Von Datum</label>
                                    <input
                                        type="date"
                                        value={searchStartDate}
                                        onChange={e => setSearchStartDate(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500/50"
                                        style={{ colorScheme: 'dark' }}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-white/50 uppercase font-bold mb-1">Bis Datum</label>
                                    <input
                                        type="date"
                                        value={searchEndDate}
                                        onChange={e => setSearchEndDate(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500/50"
                                        style={{ colorScheme: 'dark' }}
                                    />
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 bg-gray-900/50">
                                {/* Results Header / Actions */}
                                {searchResults.length > 0 && (
                                    <div className="flex justify-between items-center mb-6">
                                        <div className="text-white/60 text-sm">
                                            <span className="text-white font-bold">{searchResults.length}</span> Treffer gefunden
                                        </div>
                                        <button
                                            onClick={() => generateSearchReport(searchResults, users, searchQuery, searchStartDate, searchEndDate)}
                                            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-teal-300 px-3 py-2 rounded-lg text-sm font-bold transition-colors"
                                        >
                                            <Download size={16} /> Suchbericht (PDF)
                                        </button>
                                    </div>
                                )}

                                {/* Results List Grouped */}
                                <div className="space-y-8">
                                    {Object.keys(groupedSearchResults).length === 0 && !isSearching && hasSearched && (
                                        <div className="text-center text-white/30 py-10">Keine Ergebnisse gefunden</div>
                                    )}

                                    {Object.keys(groupedSearchResults).map(userId => {
                                        const user = users.find(u => u.user_id === userId);
                                        const entries = groupedSearchResults[userId];

                                        // --- SUMMARY CALCULATION ---
                                        const summary: Record<string, { days: number; hours: number; isAbsence: boolean; label: string }> = {};
                                        
                                        const typeLabels: Record<string, string> = {
                                            vacation: 'Urlaub', sick: 'Krank', holiday: 'Feiertag', unpaid: 'Unbezahlt',
                                            sick_child: 'Kind krank', sick_pay: 'Krankengeld', special_holiday: 'Sonderurlaub',
                                            work: 'Arbeit', break: 'Pause', company: 'Firma', office: 'Büro',
                                            warehouse: 'Lager', car: 'Auto', overtime_reduction: 'Gutstunden',
                                            emergency_service: 'Notdienst'
                                        };

                                        entries.forEach(e => {
                                            const type = e.type || 'work';
                                            if (!summary[type]) {
                                                summary[type] = { days: 0, hours: 0, isAbsence: !!e.isAbsence, label: typeLabels[type] || type };
                                            }
                                            
                                            // Handle absences multi-day calculation
                                            if (e.isAbsence && (e as any).end_date) {
                                                let d1 = new Date(e.date);
                                                let d2 = new Date((e as any).end_date);
                                                
                                                if (searchStartDate) {
                                                    const s = new Date(searchStartDate);
                                                    if (d1 < s) d1 = s;
                                                }
                                                if (searchEndDate) {
                                                    const ed = new Date(searchEndDate);
                                                    if (d2 > ed) d2 = ed;
                                                }
                                                
                                                let days = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                                                if (days < 0) days = 0;
                                                summary[type].days += days;
                                            } else {
                                                summary[type].days += 1;
                                                summary[type].hours += (e.hours || 0);
                                            }
                                        });

                                        return (
                                            <div key={userId} className="animate-in slide-in-from-bottom-2">
                                                <div className="flex items-center gap-3 mb-2 border-b border-white/5 pb-2">
                                                    <div className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center font-bold text-teal-300 text-sm border border-teal-500/30">
                                                        {user?.display_name.charAt(0) || '?'}
                                                    </div>
                                                    <h3 className="font-bold text-white text-lg">{user?.display_name || 'Unbekannt'}</h3>
                                                    <span className="text-xs text-white/40 ml-auto">{entries.length} Einträge</span>
                                                </div>

                                                {Object.keys(summary).length > 0 && (
                                                    <div className="flex flex-wrap gap-2 mb-4">
                                                        {Object.keys(summary).map(type => {
                                                            const data = summary[type];
                                                            return (
                                                                <div key={type} className="bg-white/5 border border-white/10 px-2 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
                                                                    <span className="text-teal-200/70 font-bold uppercase tracking-wider">{data.label}:</span> 
                                                                    <span className="text-white font-mono font-bold bg-black/20 px-1.5 rounded">
                                                                        {data.isAbsence ? `${data.days} Tage` : `${data.days}x (${data.hours.toFixed(2)}h)`}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}

                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                    {entries.map(entry => (
                                                        <div key={entry.id} className="bg-white/5 hover:bg-white/10 border border-white/5 p-3 rounded-xl transition-colors">
                                                            <div className="flex justify-between items-start mb-2">
                                                                <span className="text-xs font-mono text-teal-200/70">{new Date(entry.date).toLocaleDateString()}</span>
                                                                <span className="text-sm font-bold text-white font-mono">{entry.hours.toLocaleString('de-DE')}h</span>
                                                            </div>
                                                            <div className="font-bold text-white text-sm mb-1 truncate">{entry.client_name}</div>
                                                            {entry.order_number && (
                                                                <div className="inline-block bg-white/5 px-1.5 py-0.5 rounded text-[10px] text-white/50 font-mono mb-2">
                                                                    #{entry.order_number}
                                                                </div>
                                                            )}
                                                            {entry.note && (
                                                                <div className="text-xs text-white/50 italic line-clamp-2">"{entry.note}"</div>
                                                            )}
                                                            <div className="mt-2 pt-2 border-t border-white/10">
                                                                <SubmissionTimer entryDate={entry.date} submitted={!!entry.submitted} />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </GlassCard>
                    </div>
                )
            }
        </div >
    );
};

export default OfficeDashboard;