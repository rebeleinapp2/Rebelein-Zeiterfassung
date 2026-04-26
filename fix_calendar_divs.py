with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the extra div and cleanup calendar section
old_block = """                {/* CALENDAR (Right 2/5) */}
                <div className="col-span-1 xl:col-span-2">

                <div className="sticky top-6 z-10">
                                    <SpotlightCard className="bg-card border border-border p-4 rounded-2xl shadow-lg relative overflow-hidden transition-all duration-500 hover:shadow-xl hover:border-muted-foreground/30">"""

new_block = """                {/* CALENDAR (Right 2/5) */}
                <div className="col-span-1 xl:col-span-2 sticky top-6 z-10">
                    <SpotlightCard className="bg-card border border-border p-5 rounded-3xl shadow-xl relative overflow-hidden transition-all duration-500 hover:shadow-2xl hover:border-white/20 h-full">"""

content = content.replace(old_block, new_block)

# Since I combined the col-span and sticky divs, I need to remove one closing div at the end of the calendar.
old_end = """            </div>
            </SpotlightCard>
        </div>
    </div>

            
            </div>"""

new_end = """                </div>
            </SpotlightCard>
        </div>"""

content = content.replace(old_end, new_end)

with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Calendar container cleaned up and spacing improved.")
