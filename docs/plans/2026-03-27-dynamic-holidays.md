# Dynamische Feiertage — Implementierungsplan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agent/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Feiertage automatisch über DB-Trigger verwalten statt manueller Sync. Abgabe-Funktion auf Monats-basiert umstellen.

**Architecture:** Datenbank-Trigger auf `global_config` erstellt/entfernt automatisch `time_entries` (type: holiday, submitted: false) für alle aktiven Nutzer. HistoryPage-Abgabe wird von "Alle/Datumsbereich" auf "Monat X" umgestellt. Sync-Button wird entfernt.

**Tech Stack:** PostgreSQL (Supabase), React/TypeScript

---

### Task 1: SQL-Migration — Datenbank-Trigger für automatische Feiertags-Erstellung

**Files:**
- Create: `supabase-schema-dynamic-holidays.sql`

**Step 1: SQL-Migrationsdatei erstellen**

Die Datei enthält:
1. Hilfsfunktion `sync_holidays_for_user(p_user_id UUID)` — erstellt/entfernt Holiday-Einträge für einen einzelnen Nutzer
2. Trigger-Funktion `on_holiday_config_change()` — wird bei UPDATE/INSERT auf `global_config` ausgelöst, ruft sync für alle aktiven Nutzer auf
3. Trigger-Funktion `on_user_settings_change()` — wird bei INSERT/UPDATE auf `user_settings` (employment_start_date) ausgelöst, ruft sync für den betroffenen Nutzer auf
4. Trigger-Registrierung auf `global_config` und `user_settings`

Die Feiertags-Berechnung (Ostern, etc.) muss in SQL nachgebaut werden, da `holidayUtils.ts` nur im Frontend existiert.

**Step 2: SQL in Supabase SQL-Editor ausführen**

Der Nutzer muss diese Migration manuell in Supabase ausführen.

**Step 3: Commit**

```bash
git add supabase-schema-dynamic-holidays.sql
git commit -m "feat: SQL-Migration für dynamische Feiertags-Trigger"
```

---

### Task 2: Einmalige Bereinigung — Bestehende falsche Holiday-Einträge entfernen

**Files:**
- Create: `supabase-cleanup-holidays.sql`

**Step 1: Bereinigungsskript erstellen**

1. Lösche alle Holiday-Einträge (`type = 'holiday'`) die:
   - `submitted = true` UND das Datum VOR dem `employment_start_date` des Nutzers liegt
   - ODER: zu einem deaktivierten Feiertag gehören und `submitted = false`
2. Setze alle verbleibenden Holiday-Einträge auf `submitted = false` (damit der Trigger sie korrekt verwalten kann)

**Step 2: SQL in Supabase SQL-Editor ausführen**

Der Nutzer muss diese Bereinigung einmalig manuell ausführen.

**Step 3: Commit**

```bash
git add supabase-cleanup-holidays.sql
git commit -m "feat: Einmalige Bereinigung bestehender Holiday-Einträge"
```

---

### Task 3: Frontend — Sync-Button und handleGlobalSyncHolidays entfernen

**Files:**
- Modify: `pages/OfficeSettingsPage.tsx`

**Step 1: handleGlobalSyncHolidays komplett entfernen**

Entferne die gesamte Funktion `handleGlobalSyncHolidays` (Zeilen ~135-205).

**Step 2: Sync-Button in renderHolidays() entfernen**

In der `renderHolidays()` Funktion den "Sync {viewYear}" Button entfernen. Nur der "Speichern" Button bleibt bestehen.

Vorher (Zeile ~316-323):
```tsx
<div className="flex flex-wrap gap-3 w-full md:w-auto shrink-0">
    <GlassButton onClick={handleGlobalSyncHolidays} ...>
        <LayoutDashboard size={18} /> Sync {viewYear}
    </GlassButton>
    <GlassButton onClick={handleSaveHolidays} ...>
        {saving ? ... : <Save size={18} />} Speichern
    </GlassButton>
</div>
```

Nachher:
```tsx
<div className="flex flex-wrap gap-3 w-full md:w-auto shrink-0">
    <GlassButton onClick={handleSaveHolidays} disabled={saving} className="flex-1 md:flex-none !w-auto flex items-center gap-2 !bg-emerald-500/20 hover:!bg-emerald-500/30 !border-emerald-500/30 text-emerald-300">
        {saving ? <RotateCcw size={18} className="animate-spin" /> : <Save size={18} />} Speichern
    </GlassButton>
</div>
```

**Step 3: Nicht mehr benötigte Imports entfernen**

`LayoutDashboard` Import entfernen (falls nur für Sync-Button genutzt).

**Step 4: Bestätigungsdialog des Speichern-Buttons anpassen**

Der Speichern-Button (`handleSaveHolidays`) speichert die Config in `global_config`. Der DB-Trigger erledigt dann das Erstellen/Entfernen der Einträge automatisch. Ggf. einen Hinweis-Toast hinzufügen: "Feiertage werden automatisch für alle Mitarbeiter aktualisiert."

**Step 5: Commit**

```bash
git add pages/OfficeSettingsPage.tsx
git commit -m "feat: Sync-Button entfernt, Feiertage werden jetzt automatisch über DB-Trigger verwaltet"
```

---

### Task 4: Frontend — Abgabe-Dialog auf Monats-basiert umstellen

**Files:**
- Modify: `pages/HistoryPage.tsx`

**Step 1: "Alle Einträge abgeben" Toggle durch Monats-Selektor ersetzen**

Ersetze den `submitAll` Toggle und den Datumsbereich-Picker durch einen Monats-Selektor:

1. Neuer State: `submitMonth` (Date) — Standard = Monat des letzten Nicht-Holiday-Eintrags
2. Berechne den Standard-Monat: Finde den letzten Eintrag mit `type !== 'holiday'` und nehme dessen Monat
3. UI: Monats-Picker mit Vor/Zurück-Pfeilen (wie bei der viewDate-Navigation)

Vorher (Zeile ~1216-1242):
```
Toggle: "Alle Einträge abgeben"
Datumsbereich: Von/Bis
```

Nachher:
```
Monats-Selektor: < März 2026 >
Info-Text: "Markiert alle Einträge im gewählten Monat als abgegeben"
```

**Step 2: handleMarkSubmittedOnly auf Monats-Logik umstellen**

Statt `submitAll` oder Datumsbereich → filtere Einträge nach `submitMonth`:

```typescript
const monthStart = new Date(submitMonth.getFullYear(), submitMonth.getMonth(), 1);
const monthEnd = new Date(submitMonth.getFullYear(), submitMonth.getMonth() + 1, 0);

entriesToProcess = entries.filter(e => {
    const d = new Date(e.date);
    return d >= monthStart && d <= monthEnd && !e.submitted;
});
```

**Step 3: Standard-Monat berechnen**

Finde den Standard-Monat anhand des letzten Eintrags mit Typ ≠ holiday:

```typescript
const lastNonHolidayEntry = [...entries]
    .filter(e => e.type !== 'holiday' && !e.is_deleted)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

const defaultSubmitMonth = lastNonHolidayEntry 
    ? new Date(lastNonHolidayEntry.date) 
    : new Date();
```

**Step 4: Commit**

```bash
git add pages/HistoryPage.tsx
git commit -m "feat: Abgabe-Dialog auf Monats-basiert umgestellt"
```

---

### Task 5: Verifikation und Abschluss

**Step 1: Testen**

- Auf der Verwaltungsseite (#/office/management):
  - Feiertag deaktivieren → Speichern → Prüfen ob Einträge bei Nutzern entfernt wurden
  - Feiertag aktivieren → Speichern → Prüfen ob Einträge erstellt wurden
  - Prüfen ob Nutzer mit `employment_start_date` nach dem Feiertag keinen Eintrag bekommen

- Auf der Verlaufsseite (#/history):
  - Abgabe-Dialog öffnen → Monats-Selektor prüfen
  - Standard-Monat korrekt? (basierend auf letztem Nicht-Holiday-Eintrag)
  - Monat abgeben → Prüfen ob nur Einträge des gewählten Monats markiert wurden

**Step 2: Commit und Push**

```bash
git add -A
git commit -m "feat: Dynamische Feiertage implementiert - DB-Trigger, Bereinigung, Monats-Abgabe (v1.1.36)"
git push
```
