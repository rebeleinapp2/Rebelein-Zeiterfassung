import re

with open('pages/OfficeUserListPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

start_marker = "            {/* Content Grid */}"
end_marker = "            {/* QUICK REVIEW MODAL */}"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print("Could not find markers")
    exit(1)

# we need to replace the section from start_idx to end_idx.
# But it's quite large, containing all the SpotlightCard logic.
# We will use python regex to replace just the layout classes.

# 1. The container `<div className="space-y-8 pb-12">` -> `<div className="flex gap-6 pb-12 overflow-x-auto min-h-[60vh] snap-x snap-mandatory scrollbar-thin scrollbar-thumb-teal-500/20 scrollbar-track-transparent">`
content = content.replace('<div className="space-y-8 pb-12">', '<div className="flex gap-6 pb-8 pt-4 overflow-x-auto min-h-[60vh] snap-x snap-mandatory items-start hide-scrollbar">')

# 2. The column `<div key={dept.id} className="animate-in fade-in slide-in-from-bottom-4">` -> 
content = content.replace(
    '<div key={dept.id} className="animate-in fade-in slide-in-from-bottom-4">',
    '<div key={dept.id} className={`animate-in fade-in slide-in-from-bottom-4 flex flex-col shrink-0 transition-all duration-300 snap-start ${isOpen ? \\'w-[380px]\\' : \\'w-[300px]\\'}`}>'
)

# 3. The Group Header
old_header = """                                {/* Group Header */}
                                <div
                                    onClick={() => toggleGroup(dept.id)}
                                    className="flex items-center justify-between pb-3 mb-4 border-b-2 border-teal-500/20 cursor-pointer group select-none"
                                >
                                    <h2 className="text-xl font-black flex items-center gap-2 text-foreground group-hover:text-teal-400 transition-colors">
                                        <div className={`transition-transform duration-200 ${isOpen ? 'rotate-90 text-teal-400' : 'text-muted-foreground'}`}>
                                            <ChevronRight size={24} />
                                        </div>
                                        {dept.id === 'unassigned' ? <AlertTriangle className="text-amber-500" size={24} /> : <Briefcase className="text-teal-500" size={24} />}
                                        {dept.label}
                                    </h2>
                                    <div className="bg-teal-500/10 text-teal-500 text-sm font-black px-3 py-1 rounded-xl border border-teal-500/20">
                                        {deptUsers.length}
                                    </div>
                                </div>"""

new_header = """                                {/* Group Header */}
                                <div
                                    onClick={() => toggleGroup(dept.id)}
                                    className={`flex items-center justify-between p-4 cursor-pointer group select-none rounded-2xl border transition-all ${isOpen ? 'bg-card border-teal-500/30 shadow-md mb-4' : 'bg-muted/50 border-border hover:bg-muted'}`}
                                >
                                    <h2 className={`text-lg font-black flex items-center gap-2 transition-colors ${isOpen ? 'text-teal-400' : 'text-foreground group-hover:text-teal-400'}`}>
                                        <div className={`transition-transform duration-200 ${isOpen ? 'rotate-90 text-teal-400' : 'text-muted-foreground'}`}>
                                            <ChevronRight size={20} />
                                        </div>
                                        {dept.id === 'unassigned' ? <AlertTriangle className="text-amber-500" size={20} /> : <Briefcase className={isOpen ? "text-teal-500" : "text-muted-foreground"} size={20} />}
                                        <span className="truncate">{dept.label}</span>
                                    </h2>
                                    <div className={`text-sm font-black px-3 py-1 rounded-xl border ${isOpen ? 'bg-teal-500/20 text-teal-400 border-teal-500/30' : 'bg-background text-muted-foreground border-border'}`}>
                                        {deptUsers.length}
                                    </div>
                                </div>"""

content = content.replace(old_header, new_header)

# 4. The Grid inside isOpen: `<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">` -> `<div className="flex flex-col gap-4">`
content = content.replace('<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">', '<div className="flex flex-col gap-4">')

with open('pages/OfficeUserListPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied successfully.")
