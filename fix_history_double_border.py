with open('pages/HistoryPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Target the nested structure I just created
old_structure_start = """<div
        key={entry.id}
        className="relative isolate w-full overflow-hidden rounded-2xl p-0.5 bg-white/5 dark:bg-black/20 backdrop-blur-xl border border-white/10 shadow-lg transition-all duration-500 hover:scale-[1.01] hover:shadow-2xl hover:border-white/20 group"
    >
        <div className="relative w-full rounded-xl p-4 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-md border border-white/5 text-white shadow-sm transition-all duration-500 hover:bg-white/[0.08]">"""

# Single layer clean glass card
new_structure = """<div
        key={entry.id}
        className="relative w-full overflow-hidden rounded-2xl p-4 bg-slate-900/30 backdrop-blur-xl border border-white/10 shadow-lg transition-all duration-500 hover:scale-[1.01] hover:shadow-2xl hover:border-white/20 group"
    >"""

content = content.replace(old_structure_start, new_structure)

# Since we removed one div level, we need to remove one closing </div> at the end of the map
# The end of the block was:
#         </div>
#     </div>

# Let's find the closing tags of the view mode block and the map.
# In my previous patch it was:
#                 </>
#             )}
#         </div>
#     </div>

old_end = """                </>
            )}
        </div>
    </div>"""

new_end = """                </>
            )}
    </div>"""

content = content.replace(old_end, new_end)

with open('pages/HistoryPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Double border removed from history cards.")
