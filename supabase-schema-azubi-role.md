-- 1. Prüfen, ob ein Constraint existiert (führe das im SQL Editor aus, um Constraints zu sehen)
-- SELECT * FROM information_schema.check_constraints WHERE constraint_name LIKE '%role%';

-- 2. Falls ein Constraint existiert (z.B. user_settings_role_check), muss er gelöscht und neu angelegt werden:
-- ALTER TABLE user_settings DROP CONSTRAINT IF EXISTS user_settings_role_check;

-- 3. Neuen Constraint mit 'azubi' anlegen:
ALTER TABLE user_settings
ADD CONSTRAINT user_settings_role_check
CHECK (role IN ('admin', 'office', 'installer', 'azubi'));

-- HINWEIS: Wenn kein Constraint existierte, führt der DROP Befehl zu keinem Fehler (IF EXISTS),
-- und der ADD Befehl fügt einfach den neuen Constraint hinzu.
