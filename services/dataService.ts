
import { useState, useEffect, useCallback } from 'react';
import { TimeEntry, UserSettings, DEFAULT_SETTINGS, DailyLog, LockedDay, UserAbsence, VacationRequest, DailyTarget, EntryChangeHistory, Department, OvertimeBalanceEntry } from '../types';
import { supabase } from './supabaseClient';
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
        alert("Fehler beim Ablehnen: " + error.message);
      }
    }
    await fetchReviews();
  };

  return { reviews, processReview, fetchReviews };
};

export const useTimeEntries = (customUserId?: string) => {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lockedDays, setLockedDays] = useState<string[]>([]); // Array of date strings

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

    setLoading(false);
  }, [customUserId]);

  const addEntry = async (entry: Omit<TimeEntry, 'id' | 'created_at' | 'user_id'>) => {
    if (lockedDays.includes(entry.date)) {
      alert("Dieser Tag ist gesperrt und kann nicht bearbeitet werden.");
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const targetUserId = customUserId || user?.id;

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
        // Default: Draft (User must submit manually via 'Abgeben')
        autoConfirmData = {
          submitted: false
        };
      }

      // EXCEPTION: Late entries can ONLY be confirmed by 'admin' (Chef).
      // Update logic: If it was auto-confirmed above, but has late_reason, we might need to revoke if user is not admin.
      // However, if require_confirmation is FALSE, maybe late checks are also skipped?
      // User said "einzige Ausnahme", let's assume Late Check is still dominant for safety.
      // If current user is NOT admin, revoke confirmation.
      if (entry.late_reason && currentUserRole !== 'admin') {
        delete autoConfirmData.confirmed_by;
        delete autoConfirmData.confirmed_at;
        autoConfirmData.submitted = false; // Stay draft
      }
    }

    // --- LATE ENTRY LOGIC ---
    // Double check: If manual late reason provided and we haven't confirmed it yet
    // Strict Rule: Late entries start as UNCONFIRMED DRAFTS.
    if (entry.late_reason) {
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
      alert("Fehler beim Speichern: " + (error.message || JSON.stringify(error)));
    } else {
      await fetchEntries();
    }
  };

  // UPDATE LOGIC END

  const updateEntry = async (id: string, updates: Partial<TimeEntry>, reason?: string) => {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;

    if (lockedDays.includes(entry.date)) {
      alert("Dieser Tag ist gesperrt.");
      return;
    }
    if (updates.date && lockedDays.includes(updates.date)) {
      alert("Ziel-Datum ist gesperrt.");
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();

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
        change_confirmed_by_user: false,
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
      alert("Fehler beim Aktualisieren: " + (error.message || JSON.stringify(error)));
    } else {
      // --- HISTORY LOGGING ---
      const historyStatus = isOwner ? 'confirmed' : 'pending';
      // Cleanup old_values to reduce size: optional, but here we keep "entry" as snaphot.
      // Actually, let's keep it simple: "entry" is old state, "updates" is change.

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

    if (lockedDays.includes(entry.date)) {
      alert("Dieser Tag ist gesperrt.");
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();

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
        alert("Löschen fehlgeschlagen: " + (error.message || "Unbekannter Fehler"));
      } else {
        await fetchEntries();
      }
    } else {
      // SOFT DELETE
      if (!reason) {
        alert("Löschung erfordert eine Begründung."); // Should be caught by UI ideally
        return;
      }

      const { error } = await supabase.from('time_entries').update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id,
        deletion_reason: reason,
        deletion_confirmed_by_user: isOwner // If owner deletes it, they know it. If admin deletes, false.
      }).eq('id', id);

      if (error) {
        console.error("Soft Delete Error:", error.message || JSON.stringify(error));
        alert("Löschen fehlgeschlagen: " + (error.message || "Unbekannter Fehler"));
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
      alert("Fehler beim Ablehnen: " + error.message);
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
        require_confirmation: data.require_confirmation !== undefined ? data.require_confirmation : DEFAULT_SETTINGS.require_confirmation
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
    if (error) alert("Fehler beim Speichern der Abwesenheit: " + (error.message || JSON.stringify(error)));
  };

  const deleteAbsence = async (id: string) => {
    const { error } = await supabase.from('user_absences').delete().eq('id', id);
    if (error) alert("Fehler beim Löschen: " + (error.message || JSON.stringify(error)));
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
      alert("Fehler beim Anpassen der Abwesenheit: " + (err.message || JSON.stringify(err)));
    }
  };

  return { absences, addAbsence, deleteAbsence, deleteAbsenceDay, loading, fetchAbsences };
};

export const useVacationRequests = (customUserId?: string) => {
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

    if (error) alert("Fehler beim Erstellen des Antrags: " + (error.message || JSON.stringify(error)));
  };

  const deleteRequest = async (id: string) => {
    const { error } = await supabase.from('vacation_requests').delete().eq('id', id);
    if (error) alert("Löschen fehlgeschlagen: " + (error.message || JSON.stringify(error)));
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
      alert("Genehmigung fehlgeschlagen: " + (updateError.message || JSON.stringify(updateError)));
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
      alert("Warnung: Status aktualisiert, aber Kalendereintrag fehlgeschlagen: " + (insertError.message || JSON.stringify(insertError)));
    }
  };

  const rejectRequest = async (id: string) => {
    const { error } = await supabase
      .from('vacation_requests')
      .update({ status: 'rejected' })
      .eq('id', id);
    if (error) alert("Ablehnung fehlgeschlagen: " + (error.message || JSON.stringify(error)));
  }

  return { requests, createRequest, deleteRequest, approveRequest, rejectRequest, loading };
};

export const useDepartments = () => {
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
      alert("Fehler beim Aktualisieren der Abteilung: " + error.message);
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
      alert("Fehler beim Aktualisieren: " + error.message);
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
        alert("Fehler beim Erstellen des Vorschlags: " + error.message);
        console.error(error);
      } else {
        alert("Änderungsvorschlag gesendet! Der Mitarbeiter muss bestätigen.");
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
      alert("Fehler beim Speichern des Jahresanspruchs: " + error.message);
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
        alert("Fehler beim Anwenden der Quote: " + quotaError.message);
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
