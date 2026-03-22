
import { useState, useEffect, useCallback } from 'react';
import { TimeEntry, UserSettings, DEFAULT_SETTINGS, DailyLog, LockedDay, UserAbsence, VacationRequest, DailyTarget, EntryChangeHistory, Department, OvertimeBalanceEntry, DailySummary } from '../types';
import { supabase } from './supabaseClient';
import { useToast } from '../components/Toast';
import { calculateWorkingDays, calculateWorkingDaysWithHolidays } from './utils/timeUtils';

// --- Helper Functions ---

/**
 * Returns the correct target hours for a specific date based on the user's settings.
 * Previously handled history, now simplified to just current settings.
 */
export const getDailyTargetForDate = (dateStr: string, fallbackTargets: DailyTarget): number => {
  const date = new Date(dateStr);
  const dow = date.getDay();
  let target = fallbackTargets[dow as keyof DailyTarget] || 0;

  // Sonderregelung 24.12. und 31.12.
  // Wenn diese Tage auf einen Wochentag (Mo-Fr, 1-5) fallen, halbiert sich die Arbeitszeit.
  const month = date.getMonth(); // 0-indexed (11 = Dezember)
  const day = date.getDate();

  if (month === 11 && (day === 24 || day === 31)) {
    // Prüfen ob Wochentag (Mo=1 ... Fr=5)
    if (dow >= 1 && dow <= 5) {
      return target / 2;
    }
  }

  return target;
};

/**
 * Erstellt einen ISO-String (YYYY-MM-DD) basierend auf der LOKALEN Zeit des Geräts,
 * nicht UTC. Verhindert Datumsfehler spät nachts.
 */
export const getLocalISOString = (dateObj: Date = new Date()): string => {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Fetches the vacation quota for a specific user and year.
 * Returns null if not found.
 */
export const getYearlyQuota = async (userId: string, year: number) => {
  const { data, error } = await supabase
    .from('yearly_vacation_quotas')
    .select('*')
    .eq('user_id', userId)
    .eq('year', year)
    .maybeSingle();

  if (error || !data) return null;
  return data;
};

/**
 * Fetches daily summaries from the server-side view.
 */
export const fetchDailySummaries = async (userId: string, month: number, year: number) => {
  // Construct date range for the month
  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;

  // Correctly calculate last day of the month
  const lastDay = new Date(year, month + 1, 0).getDate();
  const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;

  const { data, error } = await supabase
    .from('view_daily_summary')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate);

  if (error) {
    console.error('Error fetching daily summaries:', error);
    return [];
  }
  return data;
};

/**
 * Fetches lifetime stats via RPC.
 */
export const fetchLifetimeStats = async (userId: string) => {
  const { data, error } = await supabase.rpc('get_lifetime_stats', { p_user_id: userId });
  if (error) {
    console.error('Error fetching lifetime stats:', error);
    return null;
  }
  return data;
};

/**
 * Fetches monthly stats via RPC.
 * Month is 0-indexed (0=Jan) to match JS Date.
 */
export const fetchMonthlyStats = async (userId: string, year: number, month: number) => {
  // RPC expects 1-based month if we follow standard SQL, but let's check implementation.
  // SQL: MAKE_DATE(p_year, p_month, 1) -> input is used as Month.
  // If we pass 0, MAKE_DATE might fail or go to previous year?
  // Postgres MAKE_DATE(year, month, day): month is integer 1-12.
  // So we MUST pass month + 1.
  const { data, error } = await supabase.rpc('get_monthly_stats', {
    p_user_id: userId,
    p_year: year,
    p_month: month + 1
  });

  if (error) {
    console.error('Error fetching monthly stats:', error);
    return null;
  }
  return data;
};

// --- Hooks ---

export const useInstallers = () => {
  const [installers, setInstallers] = useState<UserSettings[]>([]);

  useEffect(() => {
    const fetchInstallers = async () => {
      const { data } = await supabase
        .from('user_settings')
        .select('*')
        .order('display_name');

      if (data) {
        setInstallers(data as UserSettings[]);
      }
    };
    fetchInstallers();
  }, []);

  return installers;
};

export const usePeerReviews = () => {
  const { showToast } = useToast();
  const [reviews, setReviews] = useState<TimeEntry[]>([]);

  const fetchReviews = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Einträge, bei denen ICH als responsible eingetragen bin, aber noch NICHT bestätigt habe
    const { data, error } = await supabase
      .from('time_entries')
      .select('*')
      .eq('responsible_user_id', user.id)
      .is('confirmed_at', null)
      .is('rejected_at', null) // Don't show entries I rejected until they are fixed
      .order('date', { ascending: false });

    if (error) console.error("Error fetching reviews", error);
    else setReviews(data as TimeEntry[]);
  }, []);

  useEffect(() => {
    fetchReviews();
    // Realtime
    const channel = supabase
      .channel('realtime_reviews')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries' }, () => {
        fetchReviews();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchReviews]);

  const processReview = async (entryId: string, action: 'confirm' | 'reject', reason?: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (action === 'confirm') {
      await supabase.from('time_entries').update({
        confirmed_by: user.id,
        confirmed_at: new Date().toISOString()
      }).eq('id', entryId);
    } else {
      // Ablehnen: Verantwortlichkeit entfernen (zurück an Ersteller) und Notiz ergänzen
      // Use RPC "reject_peer_review" to bypass RLS restrictions on setting responsible_user_id to null
      const { error } = await supabase.rpc('reject_peer_review', {
        entry_id: entryId,
        reason: reason || ''
      });

      if (error) {
        console.error("Error rejecting review:", error);
        showToast("Fehler beim Ablehnen: " + error.message, "error");
      }
    }
    await fetchReviews();
  };

  return { reviews, processReview, fetchReviews };
};

export const useProposals = () => {
  const { showToast } = useToast();
  const [proposals, setProposals] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProposals = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Fetch entries where I am the target, it is a proposal, and not yet accepted (is_proposal=true)
    const { data, error } = await supabase
      .from('time_entries')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_proposal', true)
      .order('date', { ascending: false });

    if (error) console.error("Error fetching proposals", error);
    else setProposals(data as TimeEntry[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProposals();
    const channel = supabase
      .channel('realtime_proposals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries' }, () => {
        fetchProposals();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchProposals]);

  const acceptProposal = async (entryId: string) => {
    const { error } = await supabase.from('time_entries').update({
      is_proposal: false,
      is_locked: true // Lock accepted proposals
    }).eq('id', entryId);

    if (error) {
      showToast("Fehler beim Übernehmen: " + error.message, "error");
    } else {
      await fetchProposals();
    }
  };

  const discardProposal = async (entryId: string) => {
    const { error } = await supabase.from('time_entries').delete().eq('id', entryId);
    if (error) {
      showToast("Fehler beim Verwerfen: " + error.message, "error");
    } else {
      await fetchProposals();
    }
  };

  return { proposals, loading, acceptProposal, discardProposal };
};

export const useTimeEntries = (customUserId?: string) => {
  const { showToast } = useToast();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lockedDays, setLockedDays] = useState<string[]>([]); // Array of date strings
  const [closedMonths, setClosedMonths] = useState<string[]>([]); // Array of 'YYYY-MM'

  const fetchEntries = useCallback(async () => {
    setLoading(true);

    // Get current user first to determine context
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || (!user && !customUserId)) {
      setLoading(false);
      return;
    }

    let query = supabase
      .from('time_entries')
      .select('*')
      // .eq('is_deleted', false) // reverted: fetch deletions to show them in history
      .order('date', { ascending: false })
      .order('start_time', { ascending: true });

    if (customUserId) {
      query = query.eq('user_id', customUserId);
    } else if (user) {
      query = query.eq('user_id', user.id);
    }

    const { data, error } = await query;

    // Fetch user settings for accurate target calculation
    let userTargetHours = DEFAULT_SETTINGS.target_hours;
    const targetUserId = customUserId || user?.id;
    if (targetUserId) {
      const { data: s } = await supabase.from('user_settings').select('target_hours').eq('user_id', targetUserId).single();
      if (s?.target_hours) userTargetHours = s.target_hours;
    }

    if (error) {
      console.error('Error fetching entries:', error.message || JSON.stringify(error));
    } else if (data) {
      let fetchedEntries = data as TimeEntry[];

      // Client-side safety filter REVERTED: We want to see deleted entries now.
      // fetchedEntries = fetchedEntries.filter(e => e.is_deleted !== true);

      // Fetch history existence
      if (fetchedEntries.length > 0) {
        const entryIds = fetchedEntries.map(e => e.id);
        const { data: historyData } = await supabase
          .from('entry_change_history')
          .select('entry_id')
          .in('entry_id', entryIds);

        if (historyData && historyData.length > 0) {
          const historySet = new Set(historyData.map(h => h.entry_id));
          fetchedEntries = fetchedEntries.map(e => ({
            ...e,
            has_history: historySet.has(e.id)
          }));
        }
      }

      setEntries(prev => {

        // --- SONDERURLAUB INJECTION (24.12. / 31.12.) ---
        const years = new Set(fetchedEntries.map(e => new Date(e.date).getFullYear()));
        const currentYear = new Date().getFullYear();
        years.add(currentYear);
        years.add(currentYear - 1);

        const virtualEntries: TimeEntry[] = [];

        years.forEach(year => {
          if (year > new Date().getFullYear()) return;

          [24, 31].forEach(day => {
            const dateStr = `${year}-12-${day}`;
            const d = new Date(dateStr);
            const dow = d.getDay();

            // Only if Mo-Fr (1-5)
            if (dow >= 1 && dow <= 5) {
              const exists = fetchedEntries.some(e => e.date === dateStr && e.type === 'special_holiday' as any);
              if (!exists) {
                virtualEntries.push({
                  id: `virtual-${dateStr}-special`,
                  user_id: user?.id || '',
                  date: dateStr,
                  client_name: 'Sonderurlaub',
                  type: 'special_holiday' as any,
                  hours: getDailyTargetForDate(dateStr, userTargetHours), // Calculated correctly based on halved target
                  note: 'Automatisch: ½ Tag Sonderurlaub',
                  created_at: new Date().toISOString(),
                  start_time: '',
                  end_time: ''
                });
              }
            }
          });
        });

        // Add virtuals
        return [...fetchedEntries, ...virtualEntries].sort((a, b) => b.date.localeCompare(a.date));
      });
    }

    let userToCheck = customUserId || user?.id;
    if (userToCheck) {
      const { data: locks } = await supabase.from('locked_days').select('date').eq('user_id', userToCheck);
      if (locks) setLockedDays(locks.map(l => l.date));
    }

    const { data: closed } = await supabase.from('closed_months').select('month');
    if (closed) setClosedMonths(closed.map(c => c.month));

    setLoading(false);
  }, [customUserId]);

  const addEntry = async (entry: Omit<TimeEntry, 'id' | 'created_at' | 'user_id'>, overrideTargetUserId?: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    let currentUserRole = 'installer';
    if (user?.id) {
      const { data: mySettings } = await supabase.from('user_settings').select('role').eq('user_id', user.id).single();
      if (mySettings) currentUserRole = mySettings.role;
    }
    const isAdminOrOffice = currentUserRole === 'admin' || currentUserRole === 'office' || currentUserRole === 'super_admin';

    const entryMonth = entry.date.substring(0, 7);
    if (closedMonths.includes(entryMonth) && !isAdminOrOffice) {
      showToast("Dieser Monat ist abgeschlossen und kann nicht bearbeitet werden.", "warning");
      return;
    }

    if (lockedDays.includes(entry.date) && !overrideTargetUserId) {
      showToast("Dieser Tag ist gesperrt und kann nicht bearbeitet werden.", "warning");
      return;
    }

    const targetUserId = overrideTargetUserId || customUserId || user?.id;

    if (!targetUserId) {
      console.error("No user ID found for addEntry");
      return;
    }

    // Auto-Confirm Check
    let autoConfirmData: Partial<TimeEntry> = {};

    // Check settings of the TARGET user (the one receiving the entry)
    if (targetUserId) {
      const { data: targetSettings } = await supabase
        .from('user_settings')
        .select('require_confirmation, role')
        .eq('user_id', targetUserId)
        .single();

      // Also get current user role for Late-Entry Exception (Chef/Admin check)
      // If I am the user, specificSettings covers it. If I am admin editing user, I need my role too.
      let currentUserRole = targetSettings?.role;
      if (user?.id && user.id !== targetUserId) {
        const { data: mySettings } = await supabase.from('user_settings').select('role').eq('user_id', user.id).single();
        currentUserRole = mySettings?.role;
      }

      const autoConfirmTypes = ['company', 'office', 'warehouse', 'car'];
      const isAutoConfirmType = entry.type && autoConfirmTypes.includes(entry.type);

      // LOGIC: 
      // 1. If require_confirmation is FALSE (Inactive) AND it is one of the special types -> Auto Confirm.
      // 2. Peer Review overrides this (if responsible_user_id is set -> NO Auto Confirm).

      const shouldAutoConfirm = targetSettings &&
        targetSettings.require_confirmation === false &&
        isAutoConfirmType &&
        !entry.responsible_user_id;

      if (shouldAutoConfirm) {
        autoConfirmData = {
          submitted: true,
          confirmed_by: user?.id || targetUserId, // If system/auto, usually actor. 
          confirmed_at: new Date().toISOString()
        };
      } else {
        // Default: Draft (User must submit manually via 'Abgeben'), UNLESS explicitly submitted (e.g. by Admin)
        autoConfirmData = {
          submitted: entry.submitted || false
        };
      }

      // EXCEPTION: Late entries can ONLY be confirmed by 'admin' (Chef).
      // Update logic: If it was auto-confirmed above, but has late_reason, we might need to revoke if user is not admin.
      // However, if require_confirmation is FALSE, maybe late checks are also skipped?
      // User said "einzige Ausnahme", let's assume Late Check is still dominant for safety.
      // If current user is NOT admin, revoke confirmation.
      if (entry.late_reason && currentUserRole !== 'admin' && currentUserRole !== 'super_admin') {
        delete autoConfirmData.confirmed_by;
        delete autoConfirmData.confirmed_at;
        autoConfirmData.submitted = false; // Stay draft
      }
    }

    // --- LATE ENTRY LOGIC ---
    // Double check: If manual late reason provided and we haven't confirmed it yet
    // Strict Rule: Late entries start as UNCONFIRMED DRAFTS, unless explicitly submitted (e.g. by Admin/Office)
    if (entry.late_reason && !entry.submitted) {
      autoConfirmData.submitted = false;
      delete autoConfirmData.confirmed_at;
      delete autoConfirmData.confirmed_by;
    }

    const { error } = await supabase.from('time_entries').insert([{
      ...entry,
      user_id: targetUserId,
      ...autoConfirmData
    }]);

    if (error) {
      console.error("Supabase Error:", error);
      showToast("Fehler beim Speichern: " + (error.message || JSON.stringify(error)), "error");
    } else {
      await fetchEntries();
    }
  };

  // UPDATE LOGIC END

  const updateEntry = async (id: string, updates: Partial<TimeEntry>, reason?: string) => {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;

    const { data: { user } } = await supabase.auth.getUser();

    // Fetch current user role to see if they are admin/office
    let currentUserRole = 'installer';
    if (user?.id) {
      const { data: mySettings } = await supabase.from('user_settings').select('role').eq('user_id', user.id).single();
      if (mySettings) currentUserRole = mySettings.role;
    }
    const isAdminOrOffice = currentUserRole === 'admin' || currentUserRole === 'office' || currentUserRole === 'super_admin';

    const entryMonth = entry.date.substring(0, 7);
    const updateMonth = updates.date ? updates.date.substring(0, 7) : null;
    if ((closedMonths.includes(entryMonth) || (updateMonth && closedMonths.includes(updateMonth))) && !isAdminOrOffice) {
      showToast("Dieser Monat ist abgeschlossen.", "warning");
      return;
    }

    if (lockedDays.includes(entry.date)) {
      showToast("Dieser Tag ist gesperrt.", "warning");
      return;
    }
    if (updates.date && lockedDays.includes(updates.date)) {
      showToast("Ziel-Datum ist gesperrt.", "warning");
      return;
    }

    // Modification Tracking
    let changeTrackingData: Partial<TimeEntry> = {};
    const isOwner = user?.id === entry.user_id;

    if (!isOwner) {
      // Modification by Admin/Office -> Require Reason & Track
      // If no reason provided, we might want to throw error or handled in UI. 
      // Assuming UI ensures reason is passed.
      changeTrackingData = {
        last_changed_by: user?.id,
        change_reason: reason || 'Kein Grund angegeben',
        change_confirmed_by_user: isAdminOrOffice, // Auto-confirm if admin/office
        updated_at: new Date().toISOString() // Assuming we want to track update time too
      };
    } else {
      // Modification by Owner -> Reset tracking flags?
      // Usually if owner edits again, they confirm their own change implicitly.
      changeTrackingData = {
        change_confirmed_by_user: true,
        change_reason: undefined
      };
    }

    // Auto-Confirm Check on Update
    let autoConfirmData = {};

    // Determine Target User ID (Entry Owner)
    // We might need to fetch the entry first if we don't know the owner, but usually we just update.
    // However, to check settings, we need the owner ID. 
    // The hook has 'entries' in state.
    const targetEntry = entries.find(e => e.id === id);
    const targetUserId = targetEntry?.user_id || user?.id; // Fallback

    if (targetUserId) {
      const { data: targetSettings } = await supabase
        .from('user_settings')
        .select('require_confirmation, role')
        .eq('user_id', targetUserId)
        .single();

      const currentType = updates.type || targetEntry?.type;
      const currentResponsible = updates.responsible_user_id !== undefined ? updates.responsible_user_id : targetEntry?.responsible_user_id;

      const autoConfirmTypes = ['company', 'office', 'warehouse', 'car'];
      const isAutoConfirmType = currentType && autoConfirmTypes.includes(currentType as any);

      const shouldAutoConfirm = targetSettings &&
        targetSettings.require_confirmation === false &&
        isAutoConfirmType &&
        !currentResponsible &&
        !targetEntry?.rejected_at; // CRITICAL: Never auto-confirm a rejection correction, it must be re-reviewed

      if (shouldAutoConfirm) {
        autoConfirmData = {
          submitted: true,
          confirmed_by: user?.id,
          confirmed_at: new Date().toISOString()
        };
      } else {
        // If we update, we don't necessarily want to UN-confirm if it was already confirmed?
        // But if we change type to something requiring confirmation, we might.
        // For now, let's Stick to the requested logic:
        // If inactive -> Auto Confirm. 
        // If Active -> Do nothing (retain status? or set submitted?)
        // Logic says: "bei inaktiv ... automatisch bestätigt"
        // Just setting data if satisfied.

        // If NOT satisfying condition, we typically leave it alone OR if it was a type change, we might need to reset?
        // Default: Draft (User must submit manually via 'Abgeben')
        autoConfirmData = {
          submitted: false
        };
      }
    }

    // NEW LOGIC: Admin/Office forces auto-confirm on updates
    if (isAdminOrOffice) {
      autoConfirmData = {
        submitted: true,
        confirmed_by: user?.id,
        confirmed_at: new Date().toISOString()
      };
    }

    // New: Auto-Confirm based on Content Owner Settings
    // REMOVED: Entries should NOT be auto-submitted on update.

    const { error } = await supabase
      .from('time_entries')
      .update({
        ...updates,
        ...autoConfirmData,
        ...changeTrackingData,
        // Reset rejection status on update (User is fixing it)
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        // Hybrid Fix: If responsible_user_id was kept (New RPC), this is no-op.
        // If it was lost (Old RPC), we restore it from rejected_by.
        ...(entry.rejected_by && !updates.responsible_user_id && !entry.responsible_user_id ? { responsible_user_id: entry.rejected_by } : {})
      })
      .eq('id', id);

    if (error) {
      console.error("Update Error:", error);
      showToast("Fehler beim Aktualisieren: " + (error.message || JSON.stringify(error)), "error");
    } else {
      // --- HISTORY LOGGING ---
      // Admin/Office changes are auto-confirmed (no user confirmation required)
      const historyStatus = (isOwner || isAdminOrOffice) ? 'confirmed' : 'pending';

      const { error: historyError } = await supabase.from('entry_change_history').insert([{
        entry_id: id,
        changed_by: user?.id,
        reason: reason || (isOwner ? 'Eigenbearbeitung' : 'Kein Grund angegeben'),
        old_values: entry,
        new_values: updates,
        status: historyStatus
      }]);
      if (historyError) console.error("History Log Error:", historyError);
      // --- HISTORY LOGGING END ---

      await fetchEntries();
    }
  };

  const deleteEntry = async (id: string, reason?: string) => {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;

    const { data: { user } } = await supabase.auth.getUser();

    // Fetch current user role to see if they are admin/office
    let currentUserRole = 'installer';
    if (user?.id) {
      const { data: mySettings } = await supabase.from('user_settings').select('role').eq('user_id', user.id).single();
      if (mySettings) currentUserRole = mySettings.role;
    }
    const isAdminOrOffice = currentUserRole === 'admin' || currentUserRole === 'office' || currentUserRole === 'super_admin';

    const entryMonth = entry.date.substring(0, 7);
    if (closedMonths.includes(entryMonth) && !isAdminOrOffice) {
      showToast("Dieser Monat ist abgeschlossen.", "warning");
      return;
    }

    if (lockedDays.includes(entry.date)) {
      showToast("Dieser Tag ist gesperrt.", "warning");
      return;
    }

    // Check Handling: Hard vs Soft Delete
    // Hard Delete allowed if: Entry is NOT submitted AND Current User is Owner
    const isDraft = !entry.submitted; // Assuming submitted is set to true on first save usually, wait. 
    // Actually submitted flag is explicit.
    const isOwner = user?.id === entry.user_id;

    if (isDraft && isOwner) {
      // HARD DELETE
      const { error } = await supabase.from('time_entries').delete().eq('id', id);
      if (error) {
        console.error("Delete Error:", error.message || JSON.stringify(error));
        showToast("Löschen fehlgeschlagen: " + (error.message || "Unbekannter Fehler"), "error");
      } else {
        await fetchEntries();
      }
    } else {
      // SOFT DELETE
      if (!reason) {
        showToast("Löschung erfordert eine Begründung.", "warning"); // Should be caught by UI ideally
        return;
      }

      // If Admin/Office deletes it, it is immediately confirmed to avoid showing up as deleted but unconfirmed to the user
      const isAutoConfirmed = isOwner || isAdminOrOffice;

      const { error } = await supabase.from('time_entries').update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id,
        deletion_reason: reason,
        deletion_confirmed_by_user: isAutoConfirmed // If owner deletes it, they know it. If admin/office deletes, auto-confirm it.
      }).eq('id', id);

      if (error) {
        console.error("Soft Delete Error:", error.message || JSON.stringify(error));
        showToast("Löschen fehlgeschlagen: " + (error.message || "Unbekannter Fehler"), "error");
      } else {
        await fetchEntries();
      }
    }
  }

  const markAsSubmitted = async (ids: string[]) => {
    if (ids.length === 0) return;

    // Validate UUIDs to prevent 400 errors
    // Validate UUIDs to prevent 400 errors AND Filter out Unconfirmed Late Entries
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validIds = ids.filter(id => {
      if (!uuidRegex.test(id)) return false;

      const entry = entries.find(e => e.id === id);
      if (!entry) return false;

      // Strict Rule: Unconfirmed Late Entries cannot be submitted manually.
      if (entry.late_reason && !entry.confirmed_at) return false;

      return true;
    });

    if (validIds.length === 0) {
      // Optional: Give feedback if all were filtered out?
      // Assuming caller handles empty list or UI disables button.
      // But if we silently fail, it's okay for now.
      return;
    }

    let autoConfirmUpdate = {};

    // Check settings for the user owning these entries (assuming consistent user for batch)
    // We use the first entry to identify the user.
    const sampleEntry = entries.find(e => e.id === validIds[0]);
    if (sampleEntry && sampleEntry.user_id) {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('require_confirmation')
        .eq('user_id', sampleEntry.user_id)
        .single();

      if (settings && settings.require_confirmation === false) {
        autoConfirmUpdate = {
          confirmed_at: new Date().toISOString()
        };
      }
    }

    const { error } = await supabase
      .from('time_entries')
      .update({ submitted: true, ...autoConfirmUpdate })
      .in('id', validIds);

    if (error) {
      console.error("Error marking as submitted:", error.message || JSON.stringify(error));
    } else {
      setEntries(current =>
        current.map(e => validIds.includes(e.id) ? { ...e, submitted: true, ...autoConfirmUpdate } : e)
      );
    }
  }

  const confirmEntry = async (entryId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Check if it's a Late Entry to apply Auto-Submit rule
    const entryToConfirm = entries.find(e => e.id === entryId);
    let extraUpdates = {};
    if (entryToConfirm?.late_reason) {
      extraUpdates = { submitted: true };
    }

    const { error } = await supabase.from('time_entries').update({
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
      ...extraUpdates,
      // Reset rejection fields if confirmed
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null
    }).eq('id', entryId);

    if (!error) await fetchEntries();
  };

  const rejectEntry = async (entryId: string, reason: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('time_entries').update({
      rejected_by: user.id,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
      // Ensure confirmation is cleared
      confirmed_by: null,
      confirmed_at: null,
      // Also clear any pending deletion requests (Deletion Rejected)
      deletion_requested_at: null,
      deletion_requested_by: null,
      deletion_request_reason: null
    }).eq('id', entryId);

    if (error) {
      console.error("Reject Error:", error);
      showToast("Fehler beim Ablehnen: " + error.message, "error");
    } else {
      await fetchEntries();
    }
  };

  useEffect(() => {
    fetchEntries();

    const channel = supabase
      .channel('realtime_entries')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries' }, () => {
        fetchEntries();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchEntries]);

  // --- HISTORY FETCHING ---
  const [entryHistory, setEntryHistory] = useState<EntryChangeHistory[]>([]);

  const fetchEntryHistory = useCallback(async (entryId: string) => {
    // 1. Fetch History Raw
    const { data, error } = await supabase
      .from('entry_change_history')
      .select('*')
      .eq('entry_id', entryId)
      .order('changed_at', { ascending: false });

    if (error) {
      console.error("Error fetching history:", error);
    } else if (data) {
      // 2. Fetch User Names Manually (to avoid FK issues with auth schema)
      const userIds = Array.from(new Set(data.map(h => h.changed_by).filter(Boolean)));

      let userMap = new Map<string, string>();

      if (userIds.length > 0) {
        const { data: usersData } = await supabase
          .from('user_settings')
          .select('user_id, display_name')
          .in('user_id', userIds);

        if (usersData) {
          usersData.forEach(u => userMap.set(u.user_id, u.display_name));
        }
      }

      // 3. Map to Result
      const mapped = data.map((h: any) => ({
        ...h,
        changer_name: h.changed_by ? (userMap.get(h.changed_by) || 'Unbekannt') : 'System'
      }));
      setEntryHistory(mapped);
    }
  }, []);

  return { entries, loading, addEntry, updateEntry, deleteEntry, markAsSubmitted, confirmEntry, rejectEntry, lockedDays, entryHistory, fetchEntryHistory };
};

export const useDailyLogs = (customUserId?: string) => {
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDailyLogs = useCallback(async () => {
    setLoading(true);
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || (!user && !customUserId)) {
      setLoading(false);
      return;
    }

    let query = supabase.from('daily_logs').select('*');

    if (customUserId) {
      query = query.eq('user_id', customUserId);
    } else if (user) {
      query = query.eq('user_id', user.id);
    }

    const { data, error } = await query;

    if (error) {
      console.warn('Error fetching daily logs:', error.message || JSON.stringify(error));
    } else if (data) {
      const sanitized = data.map((item: any) => ({
        ...item,
        start_time: item.start_time || '',
        end_time: item.end_time || '',
        break_start: item.break_start || '',
        break_end: item.break_end || '',
        segments: item.segments || []
      }));
      setDailyLogs(sanitized as DailyLog[]);
    }
    setLoading(false);
  }, [customUserId]);

  const saveDailyLog = useCallback(async (log: DailyLog) => {
    let targetUserId = customUserId;
    if (!targetUserId) {
      const { data: { user } } = await supabase.auth.getUser();
      targetUserId = user?.id;
    }

    if (!targetUserId) return;

    const toDb = (val: string | undefined | null) => (!val || val === '') ? null : val;

    setDailyLogs(prev => {
      const existingIndex = prev.findIndex(l => l.date === log.date);
      if (existingIndex >= 0) {
        const current = prev[existingIndex];
        if (JSON.stringify(current) === JSON.stringify({ ...current, ...log })) {
          return prev;
        }
        const newLogs = [...prev];
        newLogs[existingIndex] = { ...newLogs[existingIndex], ...log };
        return newLogs;
      }
      return [...prev, { ...log, user_id: targetUserId }];
    });

    const { error } = await supabase
      .from('daily_logs')
      .upsert({
        user_id: targetUserId,
        date: log.date,
        start_time: toDb(log.start_time),
        end_time: toDb(log.end_time),
        break_start: toDb(log.break_start),
        break_end: toDb(log.break_end),
        segments: log.segments
      }, { onConflict: 'user_id, date' });

    if (error) console.error("Error saving daily log:", error.message || error);
  }, [customUserId]);

  const getLogForDate = useCallback((date: string) => {
    return dailyLogs.find(l => l.date === date) || {
      date,
      start_time: '',
      end_time: '',
      break_start: '',
      break_end: '',
      segments: []
    };
  }, [dailyLogs]);

  useEffect(() => {
    fetchDailyLogs();
    const channel = supabase
      .channel('realtime_daily_logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_logs' }, () => {
        fetchDailyLogs();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchDailyLogs]);

  return { dailyLogs, saveDailyLog, getLogForDate, loading, fetchDailyLogs };
};

export const useSettings = () => {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (data) {
      setSettings({
        user_id: data.user_id,
        display_name: data.display_name || DEFAULT_SETTINGS.display_name,
        role: data.role || DEFAULT_SETTINGS.role,
        target_hours: data.target_hours || DEFAULT_SETTINGS.target_hours,
        work_config: data.work_config || DEFAULT_SETTINGS.work_config,
        work_config_locked: data.work_config_locked || false,
        preferences: data.preferences || DEFAULT_SETTINGS.preferences,
        vacation_days_yearly: data.vacation_days_yearly || DEFAULT_SETTINGS.vacation_days_yearly,
        employment_start_date: data.employment_start_date || undefined,
        initial_overtime_balance: data.initial_overtime_balance || 0,
        // Added required_confirmation handling
        require_confirmation: data.require_confirmation !== undefined ? data.require_confirmation : DEFAULT_SETTINGS.require_confirmation,
        invoice_keyword: data.invoice_keyword
      });
    } else if (error && error.code === 'PGRST116') {
      const { error: insertError } = await supabase.from('user_settings').insert({
        user_id: user.id,
        display_name: DEFAULT_SETTINGS.display_name,
        target_hours: DEFAULT_SETTINGS.target_hours,
        work_config: DEFAULT_SETTINGS.work_config,
        preferences: DEFAULT_SETTINGS.preferences
      });
      if (!insertError) setSettings(DEFAULT_SETTINGS);
    } else if (error) {
      console.error("Error fetching settings:", error.message || JSON.stringify(error));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSettings();
    const channel = supabase
      .channel('realtime_settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_settings' }, () => {
        fetchSettings();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchSettings]);

  const updateSettings = async (newSettings: UserSettings) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: { message: 'Kein Benutzer angemeldet' } };

    if (settings.work_config_locked) {
      newSettings.target_hours = settings.target_hours;
      newSettings.work_config = settings.work_config;
    }

    setSettings(newSettings);

    const { error } = await supabase
      .from('user_settings')
      .upsert({
        user_id: user.id,
        display_name: newSettings.display_name,
        role: newSettings.role,
        target_hours: newSettings.target_hours,
        work_config: newSettings.work_config,
        preferences: newSettings.preferences,
        vacation_days_yearly: newSettings.vacation_days_yearly,
        employment_start_date: newSettings.employment_start_date,
        initial_overtime_balance: newSettings.initial_overtime_balance,
        // Added required_confirmation to update
        require_confirmation: newSettings.require_confirmation,
        invoice_keyword: newSettings.invoice_keyword,
        updated_at: new Date().toISOString()
      });

    if (error) {
      console.error("Settings update failed:", error.message || JSON.stringify(error));
      return { error };
    }
    return { error: null };
  };

  const logout = async () => {
    await supabase.auth.signOut();
  }

  return { settings, updateSettings, loading, logout };
};

export const useAbsences = (customUserId?: string) => {
  const { showToast } = useToast();
  const [absences, setAbsences] = useState<UserAbsence[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAbsences = useCallback(async () => {
    setLoading(true);
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || (!user && !customUserId)) {
      setLoading(false);
      return;
    }

    let query = supabase.from('user_absences').select('*').order('start_date');

    // Filter out deleted items (soft delete)
    // We want items where is_deleted is false or null. 
    // Supabase .is('is_deleted', null) or .eq('is_deleted', false) combined?
    // Easiest is .not('is_deleted', 'is', true) if boolean, but 'is' usually used for null.
    // Let's use logic: (is_deleted IS NULL OR is_deleted = false)
    // Supabase modifier for OR filter on same column is tricky in chain.
    // But since default is false, we can ensure column has default false in DB?
    // Migration added default false. So we can just check eq false.
    query = query.eq('is_deleted', false);

    if (customUserId) {
      query = query.eq('user_id', customUserId);
    } else if (user) {
      query = query.eq('user_id', user.id);
    }

    const { data, error } = await query;
    if (error) console.error("Fetch Absences Error:", error.message || JSON.stringify(error));
    else setAbsences(data as UserAbsence[]);
    setLoading(false);
  }, [customUserId]);

  useEffect(() => {
    fetchAbsences();
    const channel = supabase
      .channel('realtime_absences')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_absences' }, () => {
        fetchAbsences();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchAbsences]);

  const addAbsence = async (absence: Omit<UserAbsence, 'id' | 'user_id'> & { user_id?: string }) => {
    const { data: { user } } = await supabase.auth.getUser();
    const targetUserId = customUserId || user?.id || absence.user_id;

    if (!targetUserId) {
      console.error("No user ID for absence");
      return;
    }

    const { error } = await supabase.from('user_absences').insert([{
      ...absence,
      user_id: targetUserId
    }]);
    if (error) showToast("Fehler beim Speichern der Abwesenheit: " + (error.message || JSON.stringify(error)), "error");
  };

  const deleteAbsence = async (id: string, reason?: string): Promise<{ success: boolean; message?: string }> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, message: "Nicht eingeloggt" };

    // Fetch existing checks
    const absence = absences.find(a => a.id === id);
    if (!absence) return { success: false, message: "Eintrag nicht gefunden" };

    const isOwner = absence.user_id === user.id;

    if (isOwner) {
      // Owner Deletion
      const { error } = await supabase.from('user_absences').delete().eq('id', id);
      if (error) {
        return { success: false, message: "Fehler beim Löschen: " + (error.message || JSON.stringify(error)) };
      }
      return { success: true };
    } else {
      // Admin/Office deleting User's Absence
      if (!reason) {
        return { success: false, message: "Bitte geben Sie einen Grund für die Löschung an." };
      }
      const { error } = await supabase.from('user_absences').update({
        deletion_requested_at: new Date().toISOString(),
        deletion_requested_by: user.id,
        deletion_request_reason: reason
      }).eq('id', id);

      if (error) {
        return { success: false, message: "Fehler beim Beantragen der Löschung: " + (error.message || JSON.stringify(error)) };
      } else {
        return { success: true, message: "Löschantrag gesendet. Der Mitarbeiter muss zustimmen." };
      }
    }
  };

  const confirmAbsenceDeletion = async (id: string): Promise<{ success: boolean; message?: string }> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, message: "Nicht eingeloggt" };

    const { error } = await supabase.from('user_absences').update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: user.id, // Confirmed by user
      deletion_confirmed_by_user: true
    }).eq('id', id);

    if (error) return { success: false, message: "Fehler beim Bestätigen: " + error.message };

    await fetchAbsences();
    return { success: true };
  };

  const rejectAbsenceDeletion = async (id: string): Promise<{ success: boolean; message?: string }> => {
    // Clear request flags
    const { error } = await supabase.from('user_absences').update({
      deletion_requested_at: null,
      deletion_requested_by: null,
      deletion_request_reason: null
    }).eq('id', id);

    if (error) return { success: false, message: "Fehler beim Ablehnen: " + error.message };

    await fetchAbsences();
    return { success: true };
  };

  const deleteAbsenceDay = async (dateStr: string, type: string) => {
    const target = absences.find(a =>
      a.type === type &&
      a.start_date <= dateStr &&
      a.end_date >= dateStr
    );

    if (!target) return;

    const addDays = (d: string, days: number) => {
      const date = new Date(d);
      date.setDate(date.getDate() + days);
      return getLocalISOString(date);
    };

    try {
      if (target.start_date === target.end_date) {
        await deleteAbsence(target.id);
      } else if (target.start_date === dateStr) {
        const { error } = await supabase.from('user_absences').update({
          start_date: addDays(dateStr, 1)
        }).eq('id', target.id);
        if (error) throw error;
        await fetchAbsences();
      } else if (target.end_date === dateStr) {
        const { error } = await supabase.from('user_absences').update({
          end_date: addDays(dateStr, -1)
        }).eq('id', target.id);
        if (error) throw error;
        await fetchAbsences();
      } else {
        const originalEnd = target.end_date;
        const { error: updateError } = await supabase.from('user_absences').update({
          end_date: addDays(dateStr, -1)
        }).eq('id', target.id);
        if (updateError) throw updateError;

        await addAbsence({
          user_id: target.user_id,
          type: target.type,
          start_date: addDays(dateStr, 1),
          end_date: originalEnd,
          note: target.note
        });
      }
    } catch (err: any) {
      showToast("Fehler beim Anpassen der Abwesenheit: " + (err.message || JSON.stringify(err)), "error");
    }
  };

  return { absences, addAbsence, deleteAbsence, deleteAbsenceDay, confirmAbsenceDeletion, rejectAbsenceDeletion, loading, fetchAbsences };
};

export const useVacationRequests = (customUserId?: string) => {
  const { showToast } = useToast();
  const [requests, setRequests] = useState<VacationRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || (!user && !customUserId)) {
      setLoading(false);
      return;
    }

    let query = supabase.from('vacation_requests').select('*').order('created_at', { ascending: false });

    if (customUserId) {
      query = query.eq('user_id', customUserId);
    } else if (user) {
      query = query.eq('user_id', user.id);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Fetch Requests Error:", error.message || JSON.stringify(error));
    } else {
      setRequests(data as VacationRequest[]);
    }
    setLoading(false);
  }, [customUserId]);

  useEffect(() => {
    fetchRequests();
    const channel = supabase
      .channel('realtime_requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vacation_requests' }, () => {
        fetchRequests();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchRequests]);

  const createRequest = async (start: string, end: string, note?: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('vacation_requests').insert({
      user_id: user.id,
      start_date: start,
      end_date: end,
      note,
      status: 'pending'
    });

    if (error) showToast("Fehler beim Erstellen des Antrags: " + (error.message || JSON.stringify(error)), "error");
  };

  const deleteRequest = async (id: string) => {
    const { error } = await supabase.from('vacation_requests').delete().eq('id', id);
    if (error) showToast("Löschen fehlgeschlagen: " + (error.message || JSON.stringify(error)), "error");
  }

  const approveRequest = async (request: VacationRequest) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: adminSettings } = await supabase
      .from('user_settings')
      .select('display_name')
      .eq('user_id', user.id)
      .single();

    const adminName = adminSettings?.display_name || 'Admin';

    const { error: updateError } = await supabase
      .from('vacation_requests')
      .update({
        status: 'approved',
        approved_by: user.id,
        approved_by_name: adminName
      })
      .eq('id', request.id);

    if (updateError) {
      showToast("Genehmigung fehlgeschlagen: " + (updateError.message || JSON.stringify(updateError)), "error");
      return;
    }

    const { error: insertError } = await supabase.from('user_absences').insert({
      user_id: request.user_id,
      start_date: request.start_date,
      end_date: request.end_date,
      type: 'vacation',
      note: request.note || 'Urlaubsantrag genehmigt'
    });

    if (insertError) {
      showToast("Warnung: Status aktualisiert, aber Kalendereintrag fehlgeschlagen: " + (insertError.message || JSON.stringify(insertError)), "warning");
    }
  };

  const rejectRequest = async (id: string) => {
    const { error } = await supabase
      .from('vacation_requests')
      .update({ status: 'rejected' })
      .eq('id', id);
    if (error) showToast("Ablehnung fehlgeschlagen: " + (error.message || JSON.stringify(error)), "error");
  }

  return { requests, createRequest, deleteRequest, approveRequest, rejectRequest, loading };
};

export const useDepartments = () => {
  const { showToast } = useToast();
  const [departments, setDepartments] = useState<Department[]>([]);

  const fetchDepartments = useCallback(async () => {
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      // Custom sort order: Office, Service, Site, Apprentice, Misc, Archive
      .order('id');

    if (data) {
      // Manually sort to ensure correct order if ID sort isn't enough (ids are alpha: apprentice, archive, misc, office, service, site)
      // Wanted: Office, Service, Site, Apprentice, Misc, Archive
      const order = ['office', 'service', 'site', 'apprentice', 'misc', 'archive'];
      const sorted = (data as Department[]).sort((a, b) => {
        return order.indexOf(a.id) - order.indexOf(b.id);
      });
      setDepartments(sorted);
    }
  }, []);

  const updateDepartment = async (id: string, updates: Partial<Department>) => {
    const { error } = await supabase
      .from('departments')
      .update(updates)
      .eq('id', id);

    if (error) {
      showToast("Fehler beim Aktualisieren der Abteilung: " + error.message, "error");
    } else {
      await fetchDepartments();
    }
  };

  useEffect(() => {
    fetchDepartments();
    const channel = supabase
      .channel('realtime_departments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => {
        fetchDepartments();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchDepartments]);

  return { departments, fetchDepartments, updateDepartment };
};

export const useOfficeService = () => {
  const { showToast } = useToast();
  const [users, setUsers] = useState<UserSettings[]>([]);

  const fetchAllUsers = useCallback(async () => {
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .order('display_name');

    if (data) {
      setUsers(data as UserSettings[]);
    }
  }, []);

  useEffect(() => {
    fetchAllUsers();
    // Realtime not strictly needed for list, but good for updates
    const channel = supabase
      .channel('realtime_office_users')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_settings' }, () => {
        fetchAllUsers();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchAllUsers]);

  const updateOfficeUserSettings = async (userId: string, updates: Partial<UserSettings>) => {
    const { error } = await supabase
      .from('user_settings')
      .update(updates)
      .eq('user_id', userId);

    if (error) {
      showToast("Fehler beim Aktualisieren: " + error.message, "error");
    } else {
      await fetchAllUsers();
    }
  };

  const checkAndApplyVacationCarryover = async (userId: string, currentSettings: UserSettings) => {
    const currentYear = new Date().getFullYear();
    const lastCalcYear = currentSettings.last_carryover_calc_year;

    // If already updated for this year, skip
    if (lastCalcYear === currentYear) return;

    // Target is PREVIOUS year
    const targetYear = currentYear - 1;
    const startOfTarget = `${targetYear}-01-01`;
    const endOfTarget = `${targetYear}-12-31`;

    console.log(`Checking Vacation Carryover for ${userId} (Target: ${targetYear})...`);

    // Fetch requests for target year
    const { data: requests, error } = await supabase
      .from('vacation_requests')
      .select('*')
      .eq('user_id', userId)
      .neq('status', 'rejected')
      .gte('start_date', startOfTarget)
      .lte('start_date', endOfTarget);

    if (error || !requests) return;

    // Calculate Used
    let usedDays = 0;
    requests.forEach(r => {
      usedDays += calculateWorkingDaysWithHolidays(r.start_date, r.end_date);
    });

    // Calculate Remaining
    let quota = currentSettings.vacation_days_yearly || 30;

    // Fetch specific year quota (async)
    const { data: qData } = await supabase.from('yearly_vacation_quotas').select('total_days').eq('user_id', userId).eq('year', targetYear).maybeSingle();
    if (qData) quota = qData.total_days;

    const oldCarryover = currentSettings.vacation_days_carryover || 0;

    // Formula: (Quota + OldCarryover) - Used
    const remaining = Math.max(0, (quota + oldCarryover) - usedDays);

    console.log(`Used in ${targetYear}: ${usedDays}. Remaining: ${remaining}. Updating...`);

    // Update
    await updateOfficeUserSettings(userId, {
      vacation_days_carryover: remaining,
      last_carryover_calc_year: currentYear
    });
  };

  const fetchYearlyQuota = useCallback(async (userId: string, year: number) => {
    const { data, error } = await supabase
      .from('yearly_vacation_quotas')
      .select('*')
      .eq('user_id', userId)
      .eq('year', year)
      .maybeSingle();

    if (error || !data) return null;
    return data; // Returns full YearlyVacationQuota object
  }, []);

  const updateYearlyQuota = async (
    userId: string,
    year: number,
    data: { total_days: number, manual_carryover: number, is_locked: boolean }
  ) => {
    const { data: { user } } = await supabase.auth.getUser();
    const changerId = user?.id;

    // 1. Get previous value for Comparison
    const { data: prev } = await supabase.from('yearly_vacation_quotas').select('*').eq('user_id', userId).eq('year', year).maybeSingle();
    const prevVal = prev ? { base: prev.total_days, carryover: prev.manual_carryover || 0 } : { base: 0, carryover: 0 };
    const newVal = { base: data.total_days, carryover: data.manual_carryover };

    // 2. Check if locked & changing for someone else -> Create NOTIFICATION (Proposal)
    if (data.is_locked && userId !== changerId) {
      const prevTotal = (prevVal.base || 0) + (prevVal.carryover || 0);
      const newTotal = (newVal.base || 0) + (newVal.carryover || 0);

      const { error } = await supabase.from('quota_change_notifications').insert({
        user_id: userId,
        changed_by: changerId,
        year: year,
        previous_value: { ...prevVal, total: prevTotal },
        new_value: { ...newVal, total: newTotal },
        status: 'pending' // Force Pending
      });

      if (error) {
        showToast("Fehler beim Erstellen des Vorschlags: " + error.message, "error");
        console.error(error);
      } else {
        showToast("Änderungsvorschlag gesendet! Der Mitarbeiter muss bestätigen.", "info");
      }
      return; // STOP HERE - Do not write to quota table yet
    }

    // 3. Direct Update (Only if self-update or unlocked - unlikely case for admin workflow, but fallback)
    const { data: updatedQuota, error } = await supabase
      .from('yearly_vacation_quotas')
      .upsert({
        user_id: userId,
        year: year,
        total_days: data.total_days,
        manual_carryover: data.manual_carryover,
        is_locked: data.is_locked,
        updated_by: changerId,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id, year' })
      .select()
      .single();

    if (error) {
      console.error("Quota update error:", error);
      showToast("Fehler beim Speichern des Jahresanspruchs: " + error.message, "error");
      return;
    }

    // 4. Create Audit Log if changed (Direct Update)
    if (JSON.stringify(prevVal) !== JSON.stringify(newVal) && updatedQuota) {
      await supabase.from('vacation_audit_log').insert({
        quota_id: updatedQuota.id,
        changed_by: changerId,
        previous_value: prevVal,
        new_value: newVal,
        change_reason: 'Direkte Änderung (nicht gesperrt oder eigene)'
      });
    }
  };

  const fetchVacationAuditLog = useCallback(async (quotaId: string) => {
    const { data, error } = await supabase
      .from('vacation_audit_log')
      .select('*')
      .eq('quota_id', quotaId)
      .order('created_at', { ascending: false });

    if (error) return [];
    // Return raw data, name resolution happens in frontend
    return data;
  }, []);

  const fetchQuotaNotifications = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('quota_change_notifications')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['pending', 'rejected']) // Fetch rejected too for admin view
      .order('created_at', { ascending: false });

    if (error) return [];
    return data;
  }, []);

  const respondToQuotaNotification = async (notificationId: string, status: 'confirmed' | 'rejected', reason?: string) => {
    // 1. Fetch Notification details FIRST
    const { data: notification, error: fetchError } = await supabase
      .from('quota_change_notifications')
      .select('*')
      .eq('id', notificationId)
      .single();

    if (fetchError || !notification) throw new Error("Benachrichtigung nicht gefunden");

    // 2. Update Status
    const { error: updateError } = await supabase
      .from('quota_change_notifications')
      .update({ status, rejection_reason: reason })
      .eq('id', notificationId);

    if (updateError) throw updateError;

    // 3. IF CONFIRMED: Apply to Yearly Quota Table
    if (status === 'confirmed') {
      const { new_value, user_id, year, changed_by } = notification;

      const { data: updatedQuota, error: quotaError } = await supabase
        .from('yearly_vacation_quotas')
        .upsert({
          user_id: user_id,
          year: year,
          total_days: new_value.base,
          manual_carryover: new_value.carryover,
          is_locked: true, // Auto-lock
          updated_by: changed_by,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id, year' })
        .select()
        .single();

      if (quotaError) {
        showToast("Fehler beim Anwenden der Quote: " + quotaError.message, "error");
        return;
      }

      // 4. Audit Log
      await supabase.from('vacation_audit_log').insert({
        quota_id: updatedQuota.id,
        changed_by: changed_by, // The original admin who proposed it
        previous_value: notification.previous_value,
        new_value: notification.new_value,
        change_reason: 'Bestätigt durch Benutzer'
      });
    } else {
      // REJECTED
      // We do typically NOT update the quota table, so it remains old value.
      // But we might want to log this? Maybe not strictly necessary in audit log if no data changed.
    }
  };

  return { users, fetchAllUsers, updateOfficeUserSettings, checkAndApplyVacationCarryover, fetchYearlyQuota, updateYearlyQuota, fetchVacationAuditLog, fetchQuotaNotifications, respondToQuotaNotification };
};
// --- OVERTIME BALANCE HOOK ---
export const useOvertimeBalance = (userId: string) => {
  const [entries, setEntries] = useState<OvertimeBalanceEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('overtime_balance_entries')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setEntries(data as OvertimeBalanceEntry[]);
    }
    setLoading(false);
  }, [userId]);

  const addEntry = async (hours: number, reason: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Not authenticated' };

    const { error } = await supabase
      .from('overtime_balance_entries')
      .insert({
        user_id: userId,
        hours,
        reason,
        created_by: user.id
      });

    if (!error) {
      await fetchEntries();
    }
    return { error };
  };

  useEffect(() => {
    if (userId) fetchEntries();
  }, [userId, fetchEntries]);

  return { entries, loading, addEntry, refresh: fetchEntries };
};

export const useDashboardStats = (userId?: string, role?: string) => {
  const [stats, setStats] = useState<{ totalCount: number, loading: boolean }>({ totalCount: 0, loading: true });

  const fetchStats = useCallback(async () => {
    // If no user/role provided, try to fetch (fallback)
    let currentUserId = userId;
    let currentUserRole = role;

    if (!currentUserId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      currentUserId = user.id;
    }

    if (!currentUserRole && currentUserId) {
      const { data: userSettings } = await supabase.from('user_settings').select('role').eq('user_id', currentUserId).single();
      currentUserRole = userSettings?.role || 'installer';
    }

    const isOfficeOrAdmin = currentUserRole === 'admin' || currentUserRole === 'office';
    if (!currentUserId) return;

    // console.log("Fetching Dashboard Stats for", currentUserId, currentUserRole);

    let total = 0;

    // 1. My Pending Changes (Everyone)
    const { count: myChangesCount } = await supabase
      .from('time_entries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', currentUserId)
      .eq('change_confirmed_by_user', false)
      .neq('last_changed_by', currentUserId);

    total += (myChangesCount || 0);

    if (isOfficeOrAdmin) {
      // 2. Unconfirmed Entries
      const { data: unconfirmed } = await supabase
        .from('time_entries')
        .select('type, late_reason, responsible_user_id')
        .is('confirmed_at', null)
        .is('rejected_at', null);

      if (unconfirmed) {
        const confirmationTypes = ['company', 'office', 'warehouse', 'car', 'overtime_reduction'];
        const actionable = unconfirmed.filter(e => {
          const isApprovalType = (confirmationTypes.includes(e.type || '') && !e.late_reason);
          const isAssigned = !!e.responsible_user_id; // Check if assigned to ANYONE (Logic might need refinement if assigned to SPECIFIC user)
          // Refined Logic based on OfficeDashboard:
          // We count ALL unassigned actionable items + items assigned to ME?
          // For simplistic Badge Count: Count ALL actionable items visible to Admin/Office.
          const isLate = !!e.late_reason;
          return isApprovalType || isAssigned || isLate;
        });
        total += actionable.length;
      }

      // 3. Vacation Requests
      const { count: vacationCount } = await supabase
        .from('vacation_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      total += (vacationCount || 0);
    }

    setStats({ totalCount: total, loading: false });
  }, [userId, role]);

  useEffect(() => {
    fetchStats();

    // Use a unique channel name to prevent collisions/zombie channels
    const channelName = `dashboard_stats_${Math.random()}`;
    const channel = supabase.channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries' }, (payload) => {
        // console.log("Realtime Stats Update (TimeEntry):", payload);
        fetchStats();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vacation_requests' }, (payload) => {
        // console.log("Realtime Stats Update (Vacation):", payload);
        fetchStats();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchStats]);

  return stats;
};
