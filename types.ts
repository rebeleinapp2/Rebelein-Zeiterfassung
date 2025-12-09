

export interface TimeEntry {
  id: string;
  user_id: string; // Hinzugefügt für Office Dashboard Filterung
  date: string; // ISO YYYY-MM-DD
  client_name: string;
  hours: number;
  start_time?: string; // "HH:MM"
  end_time?: string;   // "HH:MM"
  note?: string;       // Projekt-Notiz
  type?: 'work' | 'break' | 'company' | 'office' | 'warehouse' | 'car' | 'vacation' | 'sick' | 'holiday' | 'unpaid' | 'overtime_reduction' | 'sick_child' | 'sick_pay'; // Erweitert um Abwesenheiten
  created_at: string;
  submitted?: boolean;
  confirmed_by?: string; // ID des Bestätigers
  confirmed_at?: string;
  responsible_user_id?: string; // NEU: Für Peer-Reviews (Kollege bestätigt)
  isAbsence?: boolean; // Frontend-Flag zur Unterscheidung
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
}

export type UserRole = 'admin' | 'office' | 'installer';

export interface UserSettings {
  user_id?: string; // Optional, da beim Laden oft implizit
  display_name: string;
  role: UserRole; // Neu
  target_hours: DailyTarget;
  work_config: WorkConfig;
  work_config_locked?: boolean; // Neu: Sperrt die Bearbeitung für den Benutzer
  preferences?: UserPreferences;
  vacation_days_yearly?: number; // Neu
  employment_start_date?: string; // Neu: Eintrittsdatum (ISO YYYY-MM-DD)
  initial_overtime_balance?: number; // Neu: Startsaldo / Übertrag
}

export interface UserAbsence {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  type: 'vacation' | 'sick' | 'holiday' | 'unpaid' | 'sick_child' | 'sick_pay';
  note?: string;
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
  initial_overtime_balance: 0
};