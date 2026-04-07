-- Aktiviert die pg_cron Extension, falls noch nicht geschehen
create extension if not exists pg_cron;

-- Funktion, die alte Einträge automatisch als abgegeben markiert
create or replace function public.auto_submit_old_entries()
returns void as $$
begin
  update public.time_entries
  set 
    submitted = true,
    updated_at = now()
  where 
    submitted = false 
    and is_deleted = false
    -- Logik: Markiere alles, was 2 Tage (48h) nach dem Beginn des Eintragungsdatums liegt.
    -- Ein Eintrag vom 07.04. (00:00 Uhr) wird am 09.04. um 00:00 Uhr markiert.
    and (date::date + interval '2 days') <= now();
end;
$$ language plpgsql;

-- Cronjob planen: Läuft JEDEN TAG um 00:00 Uhr
select cron.schedule('auto-submit-entries-daily', '0 0 * * *', 'select public.auto_submit_old_entries()');
