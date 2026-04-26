import sys
import re

with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# We want to find the section between {/* PENDING REQUESTS SECTION */} and {/* LEFT SIDE: INFO CARDS */}
start_marker = "{/* PENDING REQUESTS SECTION */}"
end_marker = '<div className="flex flex-col xl:flex-row gap-8 w-full items-start">'

if start_marker in content and end_marker in content:
    start_idx = content.find(start_marker)
    end_idx = content.find(end_marker)
    
    old_section = content[start_idx:end_idx]
    
    # We will build a new Kanban section
    # We extract the content of pendingRequests.length > 0
    # and pendingEntries.length > 0
    
    new_section = """{/* KANBAN BOARD FOR TASKS */}
            {(pendingRequests.length > 0 || pendingEntries.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8 animate-in slide-in-from-bottom-4 duration-500">
                    
                    {/* COLUMN 1: URLAUBSANTRÄGE */}
                    <div className="bg-card/50 border border-border rounded-3xl p-6 flex flex-col gap-4 shadow-lg">
                        <div className="flex items-center justify-between pb-3 border-b-2 border-purple-500/20 mb-2">
                            <h2 className="text-xl font-black flex items-center gap-2 text-foreground">
                                <CalendarHeart className="text-purple-500" size={24} /> Urlaubsanträge
                            </h2>
                            <div className="bg-purple-500/10 text-purple-500 text-sm font-black px-3 py-1 rounded-xl border border-purple-500/20">
                                {pendingRequests.length}
                            </div>
                        </div>
                        <div className="flex flex-col gap-4 overflow-y-auto max-h-[500px] scrollbar-thin pr-2">
                            {pendingRequests.length === 0 && <p className="text-muted-foreground text-sm italic py-4 text-center">Keine offenen Urlaubsanträge</p>}
                            {pendingRequests.map(req => (
                                <SpotlightCard key={req.id} className="bg-background border border-border p-4 rounded-xl shadow-sm hover:shadow-md hover:border-purple-500/50 transition-all flex flex-col gap-3 group">
                                    <div>
                                        <div className="font-black text-foreground text-lg mb-1">
                                            {new Date(req.start_date).toLocaleDateString('de-DE')} - {new Date(req.end_date).toLocaleDateString('de-DE')}
                                        </div>
                                        {req.note && <div className="text-muted-foreground text-sm italic">"{req.note}"</div>}
                                    </div>
                                    <div className="flex flex-wrap gap-2 mt-auto">
                                        {canManage ? (
                                            <>
                                                <button onClick={() => handleApproveRequest(req)} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 font-bold text-xs transition-colors">
                                                    <CheckCircle size={14} /> Genehmigen
                                                </button>
                                                <button onClick={() => rejectRequest(req.id)} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 font-bold text-xs transition-colors">
                                                    <XCircle size={14} /> Ablehnen
                                                </button>
                                            </>
                                        ) : (
                                            <span className="text-muted-foreground text-xs italic flex items-center">Keine Berechtigung</span>
                                        )}
                                    </div>
                                </SpotlightCard>
                            ))}
                        </div>
                    </div>

                    {/* COLUMN 2: BESTÄTIGUNGEN */}
                    <div className="bg-card/50 border border-border rounded-3xl p-6 flex flex-col gap-4 shadow-lg">
                        <div className="flex items-center justify-between pb-3 border-b-2 border-orange-500/20 mb-2">
                            <h2 className="text-xl font-black flex items-center gap-2 text-foreground">
                                <AlertTriangle className="text-orange-500" size={24} /> Zeiten bestätigen
                            </h2>
                            <div className="bg-orange-500/10 text-orange-500 text-sm font-black px-3 py-1 rounded-xl border border-orange-500/20">
                                {pendingEntries.length}
                            </div>
                        </div>
                        <div className="flex flex-col gap-4 overflow-y-auto max-h-[500px] scrollbar-thin pr-2">
                            {pendingEntries.length === 0 && <p className="text-muted-foreground text-sm italic py-4 text-center">Keine offenen Bestätigungen</p>}
                            {pendingEntries.map(entry => (
                                <SpotlightCard key={entry.id} className="bg-background border border-border p-4 rounded-xl shadow-sm hover:shadow-md hover:border-orange-500/50 transition-all flex flex-col gap-3 group">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2 text-foreground mb-2">
                                            <span className="font-black text-lg font-mono">
                                                {new Date(entry.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                                            </span>
                                            <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold tracking-wider ${entry.type === 'office' ? 'bg-blue-500/20 text-blue-300' : entry.type === 'company' ? 'bg-purple-500/20 text-purple-300' : entry.type === 'warehouse' ? 'bg-amber-500/20 text-amber-300' : 'bg-gray-500/20 text-muted-foreground'}`}>
                                                {entry.type === 'company' ? 'Firma' : entry.type === 'office' ? 'Büro' : entry.type === 'warehouse' ? 'Lager' : entry.type}
                                            </span>
                                            <span className="font-black text-emerald-400 font-mono text-lg ml-auto">
                                                {entry.hours} h
                                            </span>
                                        </div>
                                        {entry.start_time && entry.end_time && (
                                            <div className="text-xs text-muted-foreground font-mono bg-input px-2 py-1 rounded inline-block mb-2">
                                                {entry.start_time} - {entry.end_time}
                                            </div>
                                        )}
                                        {entry.note && (
                                            <div className="text-muted-foreground text-xs italic flex items-start gap-1.5 mt-1 bg-muted p-2 rounded-lg">
                                                <StickyNote size={12} className="mt-0.5 shrink-0 opacity-50" />
                                                <span>{entry.note}</span>
                                            </div>
                                        )}
                                    </div>
                                    {canManage && (
                                        <button onClick={() => confirmEntry(entry.id)} className="w-full mt-auto flex items-center justify-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 font-bold text-xs transition-colors">
                                            <CheckCircle size={14} /> Bestätigen
                                        </button>
                                    )}
                                </SpotlightCard>
                            ))}
                        </div>
                    </div>

                </div>
            )}

            """
    
    content = content[:start_idx] + new_section + content[end_idx:]
    
    with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Replaced section in OfficeUserPage.tsx successfully.")
else:
    print("Markers not found.")

