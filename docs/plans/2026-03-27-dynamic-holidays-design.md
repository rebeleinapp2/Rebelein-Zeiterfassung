# Design: Dynamische Feiertage

## Problem

Feiertage werden aktuell manuell per "Sync"-Button als `time_entries` bei allen Nutzern erstellt. Das verursacht mehrere Probleme:

1. **Startdatum-Verfälschung**: Feiertage vor dem tatsächlichen Nutzungsstart (z.B. Neujahr am 01.01., Nutzung ab Februar) verschieben den Berechnungsstart der Überstunden.
2. **Kein Auto-Update**: Neue Mitarbeiter bekommen keine Feiertage ohne manuellen Sync.
3. **Keine Rücknahme**: Deaktivierte Feiertage bleiben bei den Nutzern bestehen.
4. **Abgabe-Problem**: Gesyncte Feiertage sind `submitted: true`, was die Überstundenberechnung beeinflusst.

## Lösung

Feiertage werden über Datenbank-Trigger automatisch verwaltet. Die Anwendung lädt nur Daten aus der Datenbank.

### 1. Datenbank-Trigger: `on_holiday_config_change`

- Wird ausgelöst wenn `global_config` (id: `holiday_config`) per UPDATE/INSERT geändert wird
- Liest die aktive Feiertags-Konfiguration
- Für **alle aktiven Nutzer** (`is_active != false`):
  - **Aktivierte Feiertage**: Erstellt `time_entries` mit:
    - `type: 'holiday'`
    - `submitted: false`
    - `client_name: 'Feiertag: <Name>'`
    - `hours`: Soll-Stunden des Nutzers für den Wochentag
    - Überspringt existierende Einträge (gleicher Nutzer + Datum + type holiday)
    - Überspringt Feiertage **vor** dem `employment_start_date` des Nutzers
    - Überspringt Feiertage an Tagen mit 0 Soll-Stunden
  - **Deaktivierte Feiertage**: Löscht nicht-abgegebene (`submitted: false`) `time_entries` vom Typ `holiday`
    - Bereits abgegebene (`submitted: true`) Einträge bleiben unberührt

### 2. Datenbank-Trigger: `on_new_user`

- Erweitert den bestehenden `handle_new_user` Trigger
- Wenn ein neuer Nutzer angelegt wird (oder `employment_start_date` gesetzt wird):
  - Erstellt automatisch alle aktiven Feiertage ab dem `employment_start_date`
  - Einträge mit `submitted: false`

### 3. Frontend: Abgabe-Funktion (HistoryPage)

- "Alle Einträge abgeben" → "Einträge im Monat X abgeben"
- Standard-Monat = Monat des letzten Eintrags vom Typ **≠ holiday** (alle anderen Typen: work, break, company, office, warehouse, car, vacation, sick, unpaid, overtime_reduction, sick_child, sick_pay, special_holiday, emergency_service)
- Nutzer kann den Monat manuell ändern
- Beim Abgeben werden alle Einträge des gewählten Monats (inkl. Feiertage) als `submitted: true` markiert

### 4. Frontend: Verwaltungsseite (OfficeSettingsPage)

- **Sync-Button entfernen**
- Speichern-Button bleibt (speichert Config → löst DB-Trigger aus)
- Feiertage an/aus + Datums-Overrides bleiben wie bisher

### 5. Einmalige Bereinigung

- Bestehende Holiday-Einträge mit `submitted: true` die VOR dem `employment_start_date` des Nutzers liegen → Hard-Delete
- Bestehende Holiday-Einträge die zu deaktivierten Feiertagen gehören → Hard-Delete (wenn `submitted: false`)
- Danach: Trigger erstmalig ausführen um korrekte Einträge zu erzeugen

## Betroffene Dateien

### Datenbank (SQL)
- Neuer Trigger: `on_holiday_config_change` auf `global_config`
- Erweiterung: `handle_new_user` Trigger auf `auth.users` / `user_settings`
- Bereinigungsmigration (einmalig)

### Frontend
- `pages/OfficeSettingsPage.tsx` — Sync-Button und `handleGlobalSyncHolidays` entfernen
- `pages/HistoryPage.tsx` — Abgabe-Dialog auf Monats-basiert umstellen
- `pages/EntryPage.tsx` — Ggf. Anzeige von `submitted: false` Holiday-Einträgen anpassen

## Datenfluss

```
global_config UPDATE → DB-Trigger → time_entries INSERT/DELETE
                                          ↓
Nutzer öffnet App → Frontend lädt time_entries → Feiertage sichtbar
                                          ↓
Nutzer gibt Monat ab → time_entries UPDATE submitted=true
                                          ↓
DB-Berechnung → Feiertage fließen in Überstunden ein
```
