CREATE TABLE IF NOT EXISTS public.emergency_schedule (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    date date NOT NULL,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now(),
    UNIQUE(date, user_id)
);

ALTER TABLE public.emergency_schedule ENABLE ROW LEVEL SECURITY;

-- Everyone can read
CREATE POLICY "Jeder kann den Notdienstplan lesen" ON public.emergency_schedule
    FOR SELECT USING (true);

-- Authenticated users can modify (Office creates, Users swap)
CREATE POLICY "Nutzer können Notdienst ändern" ON public.emergency_schedule
    FOR ALL USING (auth.uid() IS NOT NULL);

-- Funktion zur automatischen Buchung der Notdienstpauschale
CREATE OR REPLACE FUNCTION handle_emergency_allowance()
RETURNS trigger AS $$
DECLARE
    dow integer;
    allowance_hours numeric;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Tag der Woche (0 = Sonntag, 5 = Freitag, 6 = Samstag)
        dow := EXTRACT(DOW FROM NEW.date);
        
        IF dow = 5 THEN
            allowance_hours := 0.5;
        ELSIF dow = 6 OR dow = 0 THEN
            allowance_hours := 1.0;
        ELSE
            allowance_hours := 0;
        END IF;

        IF allowance_hours > 0 THEN
            INSERT INTO public.time_entries 
            (user_id, date, client_name, type, hours, note, submitted)
            VALUES 
            (NEW.user_id, NEW.date, 'Notdienstpauschale', 'emergency_service', allowance_hours, 'Automatische Gutschrift für Notdienst', false);
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
        -- Falls sich User oder Datum ändert, altes löschen und neues anlegen
        IF OLD.user_id != NEW.user_id OR OLD.date != NEW.date THEN
            -- Altes löschen
            DELETE FROM public.time_entries
            WHERE user_id = OLD.user_id 
              AND date = OLD.date 
              AND client_name = 'Notdienstpauschale' 
              AND type = 'emergency_service'
              AND is_deleted = false;
              
            -- Neues anlegen
            dow := EXTRACT(DOW FROM NEW.date);
            IF dow = 5 THEN
                allowance_hours := 0.5;
            ELSIF dow = 6 OR dow = 0 THEN
                allowance_hours := 1.0;
            ELSE
                allowance_hours := 0;
            END IF;

            IF allowance_hours > 0 THEN
                INSERT INTO public.time_entries 
                (user_id, date, client_name, type, hours, note, submitted)
                VALUES 
                (NEW.user_id, NEW.date, 'Notdienstpauschale', 'emergency_service', allowance_hours, 'Automatische Gutschrift für Notdienst', false);
            END IF;
        END IF;
        
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger erstellen
DROP TRIGGER IF EXISTS trg_emergency_allowance ON public.emergency_schedule;
CREATE TRIGGER trg_emergency_allowance
    AFTER INSERT OR UPDATE OR DELETE ON public.emergency_schedule
    FOR EACH ROW
    EXECUTE FUNCTION handle_emergency_allowance();
