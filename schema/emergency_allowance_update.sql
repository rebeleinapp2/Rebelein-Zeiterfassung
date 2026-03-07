ALTER TABLE public.emergency_schedule
ADD COLUMN IF NOT EXISTS allowance_hours numeric;

CREATE OR REPLACE FUNCTION handle_emergency_allowance()
RETURNS trigger AS $$
DECLARE
    dow integer;
    effective_allowance numeric;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.allowance_hours IS NOT NULL THEN
            effective_allowance := NEW.allowance_hours;
        ELSE
            -- Tag der Woche (0 = Sonntag, 5 = Freitag, 6 = Samstag)
            dow := EXTRACT(DOW FROM NEW.date);
            IF dow = 5 THEN
                effective_allowance := 0.5;
            ELSIF dow = 6 OR dow = 0 THEN
                effective_allowance := 1.0;
            ELSE
                effective_allowance := 0;
            END IF;
        END IF;

        IF effective_allowance > 0 THEN
            INSERT INTO public.time_entries 
            (user_id, date, client_name, type, hours, note, submitted)
            VALUES 
            (NEW.user_id, NEW.date, 'Notdienstpauschale', 'emergency_service', effective_allowance, 'Automatische Gutschrift für Notdienst', false);
        END IF;
        
        RETURN NEW;
        
    ELSIF TG_OP = 'DELETE' THEN
        -- Entferne die Pauschale, falls sie noch existiert und ein Entwurf ist
        DELETE FROM public.time_entries
        WHERE user_id = OLD.user_id 
          AND date = OLD.date 
          AND client_name = 'Notdienstpauschale' 
          AND type = 'emergency_service'
          AND is_deleted = false;
          
        RETURN OLD;
        
    ELSIF TG_OP = 'UPDATE' THEN
        -- Falls sich User, Datum oder die Pauschale ändert, altes löschen und neues anlegen
        IF OLD.user_id != NEW.user_id OR OLD.date != NEW.date OR OLD.allowance_hours IS DISTINCT FROM NEW.allowance_hours THEN
            -- Altes löschen
            DELETE FROM public.time_entries
            WHERE user_id = OLD.user_id 
              AND date = OLD.date 
              AND client_name = 'Notdienstpauschale' 
              AND type = 'emergency_service'
              AND is_deleted = false;
              
            -- Neues anlegen
            IF NEW.allowance_hours IS NOT NULL THEN
                effective_allowance := NEW.allowance_hours;
            ELSE
                dow := EXTRACT(DOW FROM NEW.date);
                IF dow = 5 THEN
                    effective_allowance := 0.5;
                ELSIF dow = 6 OR dow = 0 THEN
                    effective_allowance := 1.0;
                ELSE
                    effective_allowance := 0;
                END IF;
            END IF;

            IF effective_allowance > 0 THEN
                INSERT INTO public.time_entries 
                (user_id, date, client_name, type, hours, note, submitted)
                VALUES 
                (NEW.user_id, NEW.date, 'Notdienstpauschale', 'emergency_service', effective_allowance, 'Automatische Gutschrift für Notdienst', false);
            END IF;
        END IF;
        
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
