-- ============================================================
-- ÄNDERUNGSANTRÄGE FÜR ABGEGEBENE EINTRÄGE
-- Nutzt die bestehende entry_change_history Tabelle
-- mit neuem Status 'change_requested'
-- ============================================================

-- 1. RPC-Funktion: Office/Admin kann Änderungsanträge genehmigen oder ablehnen
-- Bei Genehmigung: new_values werden auf den Eintrag angewendet
-- Bei Ablehnung: Status wird auf 'rejected' gesetzt

CREATE OR REPLACE FUNCTION public.handle_change_request(
    p_history_id uuid,
    p_action text,  -- 'approve' oder 'reject'
    p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_entry_id uuid;
    v_new_values jsonb;
    v_user_role text;
BEGIN
    -- Prüfe ob der aufrufende User Office oder Admin ist
    SELECT role INTO v_user_role
    FROM user_settings
    WHERE user_id = auth.uid();
    
    IF v_user_role NOT IN ('admin', 'office') THEN
        RAISE EXCEPTION 'Nur Office/Admin-Benutzer können Änderungsanträge bearbeiten';
    END IF;

    -- Hole den Änderungsantrag
    SELECT entry_id, new_values INTO v_entry_id, v_new_values
    FROM entry_change_history
    WHERE id = p_history_id AND status = 'change_requested';
    
    IF v_entry_id IS NULL THEN
        RAISE EXCEPTION 'Änderungsantrag nicht gefunden oder bereits bearbeitet';
    END IF;

    IF p_action = 'approve' THEN
        -- 1. Wende die Änderungen auf den Eintrag an
        UPDATE time_entries
        SET 
            client_name = COALESCE(v_new_values->>'client_name', client_name),
            hours = COALESCE((v_new_values->>'hours')::numeric, hours),
            start_time = COALESCE(v_new_values->>'start_time', start_time),
            end_time = COALESCE(v_new_values->>'end_time', end_time),
            note = COALESCE(v_new_values->>'note', note),
            order_number = COALESCE(v_new_values->>'order_number', order_number),
            last_changed_by = auth.uid(),
            change_confirmed_by_user = true
        WHERE id = v_entry_id;
        
        -- 2. Aktualisiere den History-Status
        UPDATE entry_change_history
        SET status = 'confirmed',
            user_response_at = NOW(),
            user_response_note = p_note
        WHERE id = p_history_id;
        
    ELSIF p_action = 'reject' THEN
        -- Nur den History-Status aktualisieren (Eintrag bleibt unverändert)
        UPDATE entry_change_history
        SET status = 'rejected',
            user_response_at = NOW(),
            user_response_note = p_note
        WHERE id = p_history_id;
    END IF;
END;
$$;

ALTER FUNCTION public.handle_change_request(uuid, text, text) OWNER TO postgres;
GRANT ALL ON FUNCTION public.handle_change_request(uuid, text, text) TO anon;
GRANT ALL ON FUNCTION public.handle_change_request(uuid, text, text) TO authenticated;
GRANT ALL ON FUNCTION public.handle_change_request(uuid, text, text) TO service_role;

-- 2. RLS Policy: Office/Admin darf entry_change_history updaten
-- (Für das Genehmigen/Ablehnen von Änderungsanträgen)
-- Prüfe ob bereits eine generelle Update-Policy besteht — falls nicht, erstelle eine:

CREATE POLICY "Office/Admin can update all history items"
ON public.entry_change_history
FOR UPDATE
USING (
    auth.uid() IN (
        SELECT user_id FROM user_settings WHERE role IN ('admin', 'office')
    )
);
