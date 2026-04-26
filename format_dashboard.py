import re

with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Wir definieren den genauen Start und Endpunkt für das neue 2-spaltige Layout (Grid).
# Start bei {/* LEFT SIDE: INFO CARDS */} und End bei dem letzten div der "w-full xl:w-1/3 2xl:w-1/4 sticky top-6"

start_marker = "{/* LEFT SIDE: INFO CARDS */}"
end_marker = "            {/* MODALS BELOW */}"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print("Markers not found.")
    exit(1)

# Der alte Bereich wird extrahiert (nur um sicher zu gehen)
old_section = content[start_idx:end_idx]

# --- ERSÄTZUNGSSTRATEGIE ---
# In der neuen Vision (wie auf dem Screenshot "Florian Göttfert") haben wir:
# Links: 
# - Überstunden (ganze Breite)
# - Anwesenheit (Halb) und Startsaldo/Übertrag (Halb)
# Rechts (aber links von Kalender):
# - Urlaubsverwaltung
# - Arbeitszeit-Modell
# - Monatsbilanz
# Ganz Rechts:
# - Kalender
# 
# Das bedeutet, wir brauchen ein 3-Spalten-Grid auf großen Bildschirmen (`grid-cols-1 xl:grid-cols-3 gap-8`).
# Spalte 1: Überstunden, Anwesenheit, Startsaldo
# Spalte 2: Urlaubsverwaltung, Arbeitszeit-Modell, Monatsbilanz
# Spalte 3: Kalender

# Um die bestehenden React-Tags nicht zu zerstören, belassen wir die Render-Methoden und ändern nur die äußeren Grid-Klassen.

# A) Zuerst suchen wir nach der Definition des Container-Grids:
# `<div className="flex flex-col xl:flex-row gap-8 w-full items-start">` -> `<div className="grid grid-cols-1 xl:grid-cols-3 gap-8 w-full items-start">`
content = content.replace('<div className="flex flex-col xl:flex-row gap-8 w-full items-start">', '<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8 w-full items-start">')

# B) Linke Spalte (Info Cards Container):
# `<div className="w-full xl:w-2/3 2xl:w-3/4">` -> `<div className="flex flex-col gap-6 col-span-1">`
# and `<div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8 w-full items-start">` -> remove this and its closing tag, we just use flex col.
content = content.replace('<div className="w-full xl:w-2/3 2xl:w-3/4">', '<!-- col 1 & 2 wrapper --><div className="col-span-1 lg:col-span-2 grid grid-cols-1 lg:grid-cols-2 gap-8 w-full"><div className="flex flex-col gap-6">')
content = content.replace('<div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8 w-full items-start">', '')

# Jetzt suchen wir nach dem Ende der ersten Spalte (nach Startsaldo). "SpotlightCard" von Startsaldo
startsaldo_end = """                        </div>
                    )}
                </SpotlightCard>"""

# Arbeitszeit Modell start
work_model_start = """                {/* WORK MODEL CONFIG (SIMPLE) */}"""

# Wir müssen den Code dazwischen splitten.
split_idx = content.find(work_model_start)
content = content[:split_idx] + "</div><div className=\"flex flex-col gap-6\">\n" + content[split_idx:]


# C) Rechte Spalte (Kalender):
# `<div className="w-full xl:w-1/3 2xl:w-1/4 sticky top-6">` -> `<div className="col-span-1 sticky top-6">`
content = content.replace('<div className="w-full xl:w-1/3 2xl:w-1/4 sticky top-6">', '<div className="col-span-1 sticky top-6 z-10">')

# D) Überstunden SpotlightCard anpassen (war md:col-span-2 md:row-span-2)
content = content.replace('md:col-span-2 md:row-span-2 order-1 relative', 'relative')
# Startsaldo anpassen
content = content.replace('md:col-span-1 order-5 bg-card', 'bg-card')
# Work Model anpassen
content = content.replace('md:col-span-2 order-3 bg-card', 'bg-card')
# Vacation anpassen
content = content.replace('md:col-span-2 order-2 bg-card', 'bg-card')
# Monatsbilanz (Attendance) anpassen
content = content.replace('md:col-span-1 order-4 bg-card', 'bg-card')

# E) Fix missing closing div for the new 2-col wrapper
# Suchen nach "                </SpotlightCard>\n            </div >\n                </div>\n\n                {/* RIGHT SIDE: CALENDAR */}"
content = content.replace(
"""                </SpotlightCard>
            </div >
                </div>

                {/* RIGHT SIDE: CALENDAR */}""",
"""                </SpotlightCard>
                </div>
            </div>

                {/* RIGHT SIDE: CALENDAR */}""")


with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Layout updated!")
