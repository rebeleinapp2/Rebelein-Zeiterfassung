

export interface TimeEntry {
  id: string;
  user_id: string; // Hinzugefügt für Office Dashboard Filterung
  date: string; // ISO YYYY-MM-DD
  client_name: string;
  hours: number;
  start_time?: string; // "HH:MM"
  end_time?: string;   // "HH:MM"
  note?: string;       // Projekt-Notiz
  type?: 'work' | 'break' | 'company' | 'office' | 'warehouse' | 'car' | 'vacation' | 'sick' | 'holiday' | 'unpaid' | 'overtime_reduction' | 'sick_child' | 'sick_pay' | 'special_holiday' | 'emergency_service'; // Erweitert um Abwesenheiten & Notdienst
  surcharge?: number; // Zuschlag in % (25, 50, 100)
  created_at: string;
  updated_at?: string; // Hinzugefügt
  submitted?: boolean;
  confirmed_by?: string; // ID des Bestätigers
  confirmed_at?: string;
  responsible_user_id?: string; // NEU: Für Peer-Reviews (Kollege bestätigt)
  isAbsence?: boolean; // Frontend-Flag zur Unterscheidung
  late_reason?: string; // Begründung für verspäteten Eintrag
  rejection_reason?: string; // Begründung für Ablehnung
  rejected_by?: string; // ID des Ablehners
  rejected_at?: string; // Zeitpunkt der Ablehnung
  // Soft Delete
  is_deleted?: boolean;
  deleted_at?: string;
  deleted_by?: string;
  deletion_reason?: string;
  deletion_confirmed_by_user?: boolean;
  // Deletion Request Fields
  deletion_requested_at?: string | null;
  deletion_requested_by?: string | null;
  deletion_request_reason?: string | null;
  // Modification Tracking
  last_changed_by?: string;
  change_reason?: string;
  change_confirmed_by_user?: boolean; // New: If false, user needs to confirm change
  has_history?: boolean; // New: If true, entry has history records
}

export interface TimeSegment {
  id: string;
  type: 'work' | 'break';
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
  note?: string;
}

export interface DailyLog {
  id?: string;
  user_id?: string;
  date: string;
  start_time: string;
  end_time: string;
  break_start: string;
  break_end: string;
  segments?: TimeSegment[];
}

export interface DailyTarget {
  1: number; // Montag
  2: number;
  3: number;
  4: number;
  5: number;
  6: number;
  0: number; // Sonntag
}

export interface WorkConfig {
  1: string; // Montag Startzeit "07:00"
  2: string;
  3: string;
  4: string;
  5: string;
  6: string;
  0: string;
}

export interface UserPreferences {
  timeCardCollapsed?: boolean;
  visible_dashboard_groups?: string[]; // IDs of open groups
}

export type UserRole = 'admin' | 'office' | 'installer' | 'azubi';

export interface UserSettings {
  user_id?: string; // Optional, da beim Laden oft implizit
  display_name: string;
  role: UserRole; // Neu
  target_hours: DailyTarget;
  work_config: WorkConfig;
  work_config_locked?: boolean; // Neu: Sperrt die Bearbeitung für den Benutzer
  preferences?: UserPreferences;
  vacation_days_yearly?: number; // Neu
  vacation_days_carryover?: number; // Neu: Übertrag aus Vorjahr
  last_carryover_calc_year?: number; // Neu: Letztes Jahr der Übertrag-Berechnung
  employment_start_date?: string; // Neu: Eintrittsdatum (ISO YYYY-MM-DD)
  initial_overtime_balance?: number; // Neu: Startsaldo / Übertrag
  require_confirmation?: boolean; // Neu: Bestätigungspflicht
  is_active?: boolean; // Neu: Konto aktiv/deaktiviert
  is_visible_to_others?: boolean; // Neu: Sichtbar für Azubi/Installer
  department_id?: string; // Neu: Zugehörige Abteilung
}

export interface UserAbsence {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  type: 'vacation' | 'sick' | 'holiday' | 'unpaid' | 'sick_child' | 'sick_pay';
  note?: string;
  submitted?: boolean;
}

export interface VacationRequest {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  note?: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  approved_by?: string;
  approved_by_name?: string;
}

export interface YearlyVacationQuota {
  id: string; // Added ID
  user_id: string;
  year: number;
  total_days: number;
  manual_carryover?: number; // New
  is_locked?: boolean;      // New
  updated_by?: string;      // New
  updated_at?: string;      // New
}

export interface VacationAuditLog {
  id: string;
  quota_id: string;
  changed_by: string;
  previous_value: { base: number; carryover: number };
  new_value: { base: number; carryover: number };
  created_at: string;
  changer_name?: string; // Virtual, joined
}

export interface Department {
  id: string; // 'office', 'service', 'site', 'apprentice', 'misc', 'archive'
  label: string;
  responsible_user_id?: string;
  substitute_user_id?: string;
  is_substitute_active?: boolean;
  is_retro_substitute_active?: boolean; // NEU: Separater Toggle für Rückwirkende Vertretung
  retro_responsible_user_id?: string; // NEU: Für rückwirkende Einträge
  retro_substitute_user_id?: string; // NEU: Vertretung für rückwirkende Einträge
  additional_responsible_ids?: string[]; // NEU: Weitere Zuständige (z.B. Stellvertreter)
}

export interface QuotaChangeNotification {
  id: string;
  user_id: string;
  changed_by: string;
  year: number;
  previous_value: { base: number; carryover: number; total: number };
  new_value: { base: number; carryover: number; total: number };
  status: 'pending' | 'confirmed' | 'rejected';
  rejection_reason?: string;
  created_at: string;
}

export interface OvertimeBalanceEntry {
  id: string;
  user_id: string;
  hours: number;
  reason: string;
  created_by?: string;
  created_at?: string;
}

export interface EntryChangeHistory {
  id: string;
  entry_id: string;
  changed_at: string;
  changed_by: string; // UUID
  old_values: Partial<TimeEntry>; // JSONB
  new_values: Partial<TimeEntry>; // JSONB
  reason?: string;
  status: 'pending' | 'confirmed' | 'rejected';
  user_response_at?: string;
  user_response_note?: string;
  changer_name?: string; // Virtual (joined)
}

export interface LockedDay {
  id: string;
  user_id: string;
  date: string;
  locked_by: string;
}

export const DEFAULT_SETTINGS: UserSettings = {
  display_name: "Benutzer",
  role: 'installer',
  target_hours: {
    1: 8.5,
    2: 8.5,
    3: 8.5,
    4: 8.5,
    5: 4.5,
    6: 0,
    0: 0
  },
  work_config: {
    1: "07:00",
    2: "07:00",
    3: "07:00",
    4: "07:00",
    5: "07:00",
    6: "07:00",
    0: "07:00"
  },
  work_config_locked: false,
  preferences: {
    timeCardCollapsed: false
  },
  vacation_days_yearly: 30,
  initial_overtime_balance: 0,
  require_confirmation: true,
  is_visible_to_others: true
};