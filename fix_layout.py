with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Zuerst passen wir den Haupt-Container an
content = content.replace('<div className="flex flex-col xl:flex-row gap-8 w-full items-start">', '<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8 w-full items-start">')
content = content.replace('<div className="w-full xl:w-2/3 2xl:w-3/4">', '<div className="col-span-1 lg:col-span-2 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">')
content = content.replace('<div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8 w-full items-start">', '<div className="flex flex-col gap-6 w-full">')

# Finde den Start von Work Model und setze den Split für die zweite Spalte
work_start = '{/* WORK MODEL CONFIG (SIMPLE) */}'
split_idx = content.find(work_start)

if split_idx != -1:
    content = content[:split_idx] + '</div><div className="flex flex-col gap-6 w-full">\n' + content[split_idx:]
else:
    print("Work model not found")

# Fix Kalender Spalte
content = content.replace('<div className="w-full xl:w-1/3 2xl:w-1/4 sticky top-6">', '<div className="col-span-1 sticky top-6 z-10">')

# Clean up CSS classes in SpotlightCards
content = content.replace('md:col-span-2 md:row-span-2 order-1 relative', 'relative')
content = content.replace('md:col-span-1 order-5 bg-card', 'bg-card')
content = content.replace('md:col-span-2 order-3 bg-card', 'bg-card')
content = content.replace('md:col-span-2 order-2 bg-card', 'bg-card')
content = content.replace('md:col-span-1 order-4 bg-card', 'bg-card')

# Es gibt 2 überschüssige Div-Closings nach der rechten Info-Spalte
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

print("Grid layout updated!")
