-- ============================================================
-- EINMALIGE BEREINIGUNG: Bestehende Holiday-Einträge korrigieren
-- ACHTUNG: Dieses Skript nur EINMAL ausführen!
-- ============================================================

-- 1. Lösche Holiday-Einträge die VOR dem employment_start_date des Nutzers liegen
DELETE FROM time_entries te
USING user_settings us
WHERE te.user_id = us.user_id
  AND te.type = 'holiday'
  AND us.employment_start_date IS NOT NULL
  AND te.date < us.employment_start_date
  AND COALESCE(te.is_deleted, FALSE) = FALSE;

-- 2. Setze alle verbleibenden Holiday-Einträge auf submitted = false
-- (damit der Trigger sie korrekt verwalten kann)
UPDATE time_entries
SET submitted = FALSE
WHERE type = 'holiday'
  AND submitted = TRUE
  AND COALESCE(is_deleted, FALSE) = FALSE;

-- 3. Triggere den Holiday-Sync für alle Nutzer
-- (damit fehlende Einträge automatisch erstellt werden)
UPDATE global_config
SET updated_at = NOW()
WHERE id = 'holiday_config';
