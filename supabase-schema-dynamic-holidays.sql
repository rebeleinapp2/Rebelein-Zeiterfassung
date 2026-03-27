-- ============================================================
-- DYNAMISCHE FEIERTAGE: Datenbank-Trigger
-- Erstellt/entfernt Holiday time_entries automatisch basierend
-- auf global_config (holiday_config)
-- ============================================================

-- 1. HILFSFUNKTION: Ostersonntag berechnen (Gauss-Algorithmus)
CREATE OR REPLACE FUNCTION public.calc_easter_sunday(p_year INTEGER)
RETURNS DATE AS $$
DECLARE
    a INTEGER; b INTEGER; c INTEGER;
    k INTEGER; p INTEGER; q INTEGER;
    big_m INTEGER; big_n INTEGER;
    d INTEGER; e INTEGER;
    day_val INTEGER;
    result_date DATE;
BEGIN
    a := p_year % 19;
    b := p_year % 4;
    c := p_year % 7;
    k := p_year / 100;
    p := (8 * k + 13) / 25;
    q := k / 4;
    big_m := (15 + k - p - q) % 30;
    big_n := (4 + k - q) % 7;
    d := (19 * a + big_m) % 30;
    e := (2 * b + 4 * c + 6 * d + big_n) % 7;
    day_val := 22 + d + e;

    IF day_val <= 31 THEN
        result_date := make_date(p_year, 3, day_val); -- März
    ELSE
        day_val := day_val - 31;
        IF day_val = 26 THEN day_val := 19; END IF;
        IF day_val = 25 AND d = 28 AND e = 6 AND a > 10 THEN day_val := 18; END IF;
        result_date := make_date(p_year, 4, day_val); -- April
    END IF;

    RETURN result_date;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. HILFSFUNKTION: Bayerische Feiertage für ein Jahr generieren
-- Gibt eine Tabelle zurück mit (id, name, holiday_date)
CREATE OR REPLACE FUNCTION public.get_bavarian_holidays(p_year INTEGER)
RETURNS TABLE(holiday_id TEXT, holiday_name TEXT, holiday_date DATE) AS $$
DECLARE
    easter DATE;
BEGIN
    easter := calc_easter_sunday(p_year);

    RETURN QUERY
    SELECT 'neujahr'::TEXT, 'Neujahr'::TEXT, make_date(p_year, 1, 1)
    UNION ALL SELECT 'h3k', 'Heilige Drei Könige', make_date(p_year, 1, 6)
    UNION ALL SELECT 'karfreitag', 'Karfreitag', (easter - INTERVAL '2 days')::DATE
    UNION ALL SELECT 'ostermontag', 'Ostermontag', (easter + INTERVAL '1 day')::DATE
    UNION ALL SELECT 'tag_der_arbeit', 'Tag der Arbeit', make_date(p_year, 5, 1)
    UNION ALL SELECT 'christi_himmelfahrt', 'Christi Himmelfahrt', (easter + INTERVAL '39 days')::DATE
    UNION ALL SELECT 'pfingstmontag', 'Pfingstmontag', (easter + INTERVAL '50 days')::DATE
    UNION ALL SELECT 'fronleichnam', 'Fronleichnam', (easter + INTERVAL '60 days')::DATE
    UNION ALL SELECT 'friedensfest', 'Augsburger Friedensfest', make_date(p_year, 8, 8)
    UNION ALL SELECT 'mariae_himmelfahrt', 'Mariä Himmelfahrt', make_date(p_year, 8, 15)
    UNION ALL SELECT 'tag_der_deutschen_einheit', 'Tag der Deutschen Einheit', make_date(p_year, 10, 3)
    UNION ALL SELECT 'allerheiligen', 'Allerheiligen', make_date(p_year, 11, 1)
    UNION ALL SELECT 'weihnachten_1', '1. Weihnachtstag', make_date(p_year, 12, 25)
    UNION ALL SELECT 'weihnachten_2', '2. Weihnachtstag', make_date(p_year, 12, 26);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. HAUPTFUNKTION: Feiertage für EINEN Nutzer synchronisieren
CREATE OR REPLACE FUNCTION public.sync_holidays_for_user(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
    v_config JSONB;
    v_active_config JSONB;
    v_overrides JSONB;
    v_year INTEGER;
    v_employment_start DATE;
    v_target_hours JSONB;
    v_holiday RECORD;
    v_final_date DATE;
    v_override_date TEXT;
    v_dow INTEGER;
    v_hours NUMERIC;
    v_exists BOOLEAN;
BEGIN
    -- Hole globale Feiertags-Konfiguration
    SELECT config INTO v_config
    FROM global_config
    WHERE id = 'holiday_config';

    IF v_config IS NULL THEN RETURN; END IF;

    -- Config-Struktur: { active: { neujahr: true, ... }, overrides: { ... } }
    -- ACHTUNG: Frontend-Bug konnte doppelte Verschachtelung erzeugen:
    -- { active: { active: { neujahr: false, ... }, neujahr: true, ... } }
    -- Lösung: Tiefste 'active' Ebene verwenden die boolean-Werte enthält
    v_active_config := COALESCE(v_config->'active', v_config);
    -- Wenn active nochmal ein active-Objekt enthält, dieses verwenden
    WHILE v_active_config->'active' IS NOT NULL 
          AND jsonb_typeof(v_active_config->'active') = 'object' 
    LOOP
        v_active_config := v_active_config->'active';
    END LOOP;
    v_overrides := COALESCE(v_config->'overrides', '{}'::JSONB);

    -- Hole Nutzer-Einstellungen
    SELECT employment_start_date, target_hours
    INTO v_employment_start, v_target_hours
    FROM user_settings
    WHERE user_id = p_user_id;

    IF v_target_hours IS NULL THEN RETURN; END IF;

    -- Synchronisiere für das aktuelle Jahr UND das nächste Jahr
    FOR v_year IN (SELECT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER)
    LOOP
        FOR v_holiday IN SELECT * FROM get_bavarian_holidays(v_year)
        LOOP
            -- Prüfe ob Feiertag aktiv ist
            IF COALESCE((v_active_config->>v_holiday.holiday_id)::BOOLEAN, TRUE) THEN
                -- Feiertag ist AKTIV → Eintrag erstellen falls nicht vorhanden

                -- Prüfe auf Datums-Override
                v_override_date := v_overrides->v_year::TEXT->>v_holiday.holiday_id;
                IF v_override_date IS NOT NULL THEN
                    v_final_date := v_override_date::DATE;
                ELSE
                    v_final_date := v_holiday.holiday_date;
                END IF;

                -- Prüfe employment_start_date
                IF v_employment_start IS NOT NULL AND v_final_date < v_employment_start THEN
                    CONTINUE; -- Überspringe Feiertage vor dem Eintrittsdatum
                END IF;

                -- Berechne Soll-Stunden für den Wochentag
                -- PostgreSQL: 0=Sonntag, 1=Montag, ..., 6=Samstag
                v_dow := EXTRACT(DOW FROM v_final_date)::INTEGER;
                v_hours := COALESCE((v_target_hours->>v_dow::TEXT)::NUMERIC, 0);

                -- Überspringe Tage mit 0 Soll-Stunden
                IF v_hours <= 0 THEN CONTINUE; END IF;

                -- Prüfe ob bereits ein Eintrag existiert (gleicher Nutzer + Datum + type holiday)
                SELECT EXISTS(
                    SELECT 1 FROM time_entries
                    WHERE user_id = p_user_id
                      AND date = v_final_date
                      AND type = 'holiday'
                      AND COALESCE(is_deleted, FALSE) = FALSE
                ) INTO v_exists;

                IF NOT v_exists THEN
                    INSERT INTO time_entries (user_id, date, client_name, hours, type, submitted, created_at)
                    VALUES (
                        p_user_id,
                        v_final_date,
                        'Feiertag: ' || v_holiday.holiday_name,
                        v_hours,
                        'holiday',
                        FALSE,
                        NOW()
                    );
                END IF;

            ELSE
                -- Feiertag ist DEAKTIVIERT → nicht-abgegebene Einträge entfernen

                -- Berechne finales Datum (inkl. Override)
                v_override_date := v_overrides->v_year::TEXT->>v_holiday.holiday_id;
                IF v_override_date IS NOT NULL THEN
                    v_final_date := v_override_date::DATE;
                ELSE
                    v_final_date := v_holiday.holiday_date;
                END IF;

                -- Lösche nicht-abgegebene Feiertags-Einträge (Hard-Delete)
                DELETE FROM time_entries
                WHERE user_id = p_user_id
                  AND type = 'holiday'
                  AND submitted = FALSE
                  AND COALESCE(is_deleted, FALSE) = FALSE
                  AND (date = v_final_date OR client_name = 'Feiertag: ' || v_holiday.holiday_name);
            END IF;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. TRIGGER-FUNKTION: Bei Änderung der global_config → alle Nutzer synchronisieren
CREATE OR REPLACE FUNCTION public.on_holiday_config_change()
RETURNS TRIGGER AS $$
DECLARE
    v_user RECORD;
BEGIN
    -- Nur reagieren wenn holiday_config geändert wurde
    IF NEW.id != 'holiday_config' THEN RETURN NEW; END IF;

    -- Alle aktiven Nutzer synchronisieren
    FOR v_user IN
        SELECT user_id FROM user_settings
        WHERE COALESCE(is_active, TRUE) = TRUE
          AND user_id IS NOT NULL
    LOOP
        PERFORM sync_holidays_for_user(v_user.user_id);
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. TRIGGER-FUNKTION: Bei neuem Nutzer oder Änderung employment_start_date
CREATE OR REPLACE FUNCTION public.on_user_employment_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Bei INSERT oder wenn sich employment_start_date geändert hat
    IF TG_OP = 'INSERT' OR 
       (TG_OP = 'UPDATE' AND (
           OLD.employment_start_date IS DISTINCT FROM NEW.employment_start_date OR
           OLD.target_hours IS DISTINCT FROM NEW.target_hours OR
           OLD.is_active IS DISTINCT FROM NEW.is_active
       )) THEN
        -- Nur synchronisieren wenn der Nutzer aktiv ist
        IF COALESCE(NEW.is_active, TRUE) = TRUE THEN
            PERFORM sync_holidays_for_user(NEW.user_id);
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. TRIGGER REGISTRIEREN

-- Trigger auf global_config (für Feiertags-Konfigurationsänderungen)
DROP TRIGGER IF EXISTS trg_holiday_config_change ON global_config;
CREATE TRIGGER trg_holiday_config_change
    AFTER INSERT OR UPDATE ON global_config
    FOR EACH ROW
    EXECUTE FUNCTION on_holiday_config_change();

-- Trigger auf user_settings (für neue Nutzer / employment_start_date Änderungen)
DROP TRIGGER IF EXISTS trg_user_employment_change ON user_settings;
CREATE TRIGGER trg_user_employment_change
    AFTER INSERT OR UPDATE ON user_settings
    FOR EACH ROW
    EXECUTE FUNCTION on_user_employment_change();
