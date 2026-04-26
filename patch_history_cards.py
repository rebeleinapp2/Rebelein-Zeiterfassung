import re
import sys

def main():
    try:
        with open('pages/HistoryPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    # 1. Define the new card block
    # We will target the `dayEntries.map` section.
    
    # We need to find the start of the map: `{dayEntries.map(entry => (`
    # and its end.
    
    old_card_start = '<GlassCard key={entry.id} className={`!p-3 flex flex-col justify-between group ${getEntryStyle(entry)}`}>'
    
    # The new card design (based on TweetCard from MVPBlocks)
    new_card = """<div
        key={entry.id}
        className="relative isolate w-full overflow-hidden rounded-2xl p-0.5 bg-white/5 dark:bg-black/20 backdrop-blur-xl border border-white/10 shadow-lg transition-all duration-500 hover:scale-[1.01] hover:shadow-2xl hover:border-white/20 group"
    >
        <div className="relative w-full rounded-xl p-4 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-md border border-white/5 text-white shadow-sm transition-all duration-500 hover:bg-white/[0.08]">
            {editingEntry?.id === entry.id && !entry.isAbsence ? (
                /* EDIT MODE (Kept similar but styled for the card) */
                <div className="w-full space-y-3">
                    <div className="flex gap-3">
                        <div className="flex-1 relative bg-black/40 rounded-xl border border-white/10 shadow-inner p-1">
                            <span className="absolute top-0.5 left-2 text-[8px] text-muted-foreground uppercase font-black tracking-widest opacity-60">Kunde</span>
                            <input type="text" value={editForm.client_name} onChange={e => setEditForm({ ...editForm, client_name: e.target.value })} className="w-full bg-transparent border-none text-foreground text-sm h-10 pt-3 px-2 focus:outline-none" />
                        </div>
                        <div className="w-24 relative bg-black/40 rounded-xl border border-white/10 shadow-inner p-1">
                            <span className="absolute top-0.5 left-2 text-[8px] text-muted-foreground uppercase font-black tracking-widest opacity-60">Nr.</span>
                            <input type="text" value={editForm.order_number} onChange={e => setEditForm({ ...editForm, order_number: e.target.value })} className="w-full bg-transparent border-none text-foreground font-mono text-sm h-10 pt-3 px-2 focus:outline-none" />
                        </div>
                    </div>
                    <div className="flex gap-2 items-center">
                        <div className="flex-1 flex gap-2 items-center bg-black/40 rounded-xl border border-white/10 p-1">
                             <input type="time" value={editForm.start_time} onChange={e => setEditForm({ ...editForm, start_time: e.target.value })} className="bg-transparent border-none text-center text-foreground font-mono text-sm h-8 flex-1 focus:outline-none" />
                             <span className="text-white/20">-</span>
                             <input type="time" value={editForm.end_time} onChange={e => setEditForm({ ...editForm, end_time: e.target.value })} className="bg-transparent border-none text-center text-foreground font-mono text-sm h-8 flex-1 focus:outline-none" />
                        </div>
                        <div className="w-20 relative bg-black/40 rounded-xl border border-white/10 p-1">
                             <span className="absolute top-0.5 left-0 w-full text-center text-[8px] text-cyan-400 font-black tracking-widest">Std</span>
                             <input type="text" value={editForm.hours} onChange={e => handleHoursChange(e.target.value)} className="w-full bg-transparent border-none text-center text-cyan-300 font-bold h-8 pt-2 focus:outline-none" />
                        </div>
                    </div>
                    <div className="flex gap-2 justify-end pt-2">
                        <button onClick={() => setEditingEntry(null)} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white transition-colors"><X size={16} /></button>
                        <button onClick={handleSaveEdit} className="p-2 bg-emerald-500/20 hover:bg-emerald-500/40 border border-emerald-500/30 rounded-lg text-emerald-400 transition-colors"><Save size={16} /></button>
                    </div>
                </div>
            ) : (
                /* VIEW MODE - TWEET STYLE */
                <>
                    <div className="flex gap-3">
                        <div className="shrink-0">
                            <div className={`h-10 w-10 rounded-full flex items-center justify-center border border-white/10 shadow-inner ${entry.type === 'break' ? 'bg-orange-500/20 text-orange-400' : entry.isAbsence ? 'bg-purple-500/20 text-purple-300' : 'bg-primary/20 text-primary'}`}>
                                {getEntryIcon(entry.type)}
                            </div>
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex flex-col min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className={`font-black tracking-tight truncate ${entry.type === 'break' ? 'text-orange-300' : entry.isAbsence ? 'text-purple-200' : 'text-white'}`}>
                                            {entry.client_name}
                                        </span>
                                        {entry.submitted && (
                                            <div className="bg-emerald-500/20 p-0.5 rounded-full border border-emerald-500/30">
                                                <CheckCircle size={10} className="text-emerald-400" />
                                            </div>
                                        )}
                                        {entry.order_number && (
                                            <span className="text-[10px] font-mono text-white/40 bg-white/5 px-1.5 py-0.5 rounded border border-white/5 uppercase tracking-widest">
                                                #{entry.order_number}
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-[11px] font-bold text-white/40 uppercase tracking-widest flex items-center gap-2 mt-0.5">
                                        {ENTRY_TYPES_CONFIG[entry.type]?.label.split(' / ')[0]}
                                        {entry.start_time && <span>• {entry.start_time} - {entry.end_time}</span>}
                                    </span>
                                </div>

                                <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {isLocked ? (
                                         entry.submitted && !entry.isAbsence && (
                                            <button onClick={() => handleEditClick(entry)} className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/20 rounded-lg transition-all" title="Änderungsantrag">
                                                <RefreshCw size={14} />
                                            </button>
                                         )
                                    ) : (
                                        <>
                                            <button onClick={() => handleEditClick(entry)} className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white transition-all">
                                                <Edit2 size={14} />
                                            </button>
                                            <button onClick={() => handleDeleteClick(entry)} className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg transition-all">
                                                <Trash2 size={14} />
                                            </button>
                                        </>
                                    )}
                                    <button onClick={() => { setHistoryModal({ isOpen: true, entryId: entry.id }); fetchEntryHistory(entry.id); }} className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/60 transition-all">
                                        <HistoryIcon size={14} />
                                    </button>
                                </div>
                            </div>

                            {entry.note && (
                                <div className="mt-2 text-sm text-white/70 italic bg-white/5 p-2 rounded-xl border border-white/5 relative group/note">
                                    <StickyNote size={12} className="absolute -top-1 -left-1 text-white/20 rotate-12" />
                                    {entry.note}
                                </div>
                            )}

                            {entry.late_reason && (
                                <div className="mt-2 text-xs text-orange-200/80 bg-orange-500/10 p-2 rounded-xl border border-orange-500/20 flex items-start gap-2">
                                    <ShieldAlert size={14} className="shrink-0 text-orange-400" />
                                    <span>"{entry.late_reason}"</span>
                                </div>
                            )}

                            <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <SubmissionTimer entryDate={entry.date} submitted={!!entry.submitted} isAbsence={!!entry.isAbsence} />
                                    {entry.confirmed_at ? (
                                        <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-emerald-400/70">
                                            <CheckCircle size={10} /> Bestätigt
                                        </div>
                                    ) : (entry.responsible_user_id || entry.late_reason) && (
                                        <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-orange-400/70 animate-pulse">
                                            <Hourglass size={10} /> Prüfung
                                        </div>
                                    )}
                                </div>
                                <div className="text-lg font-black tracking-tighter text-white">
                                    {entry.type === 'emergency_service' && entry.surcharge ? (
                                        <span className="flex items-baseline gap-1">
                                            {(entry.hours * (1 + entry.surcharge / 100)).toFixed(2)}
                                            <span className="text-[10px] opacity-40 font-bold uppercase">h (+{entry.surcharge}%)</span>
                                        </span>
                                    ) : (
                                        <span className="flex items-baseline gap-1">
                                            {entry.hours.toFixed(2)}
                                            <span className="text-[10px] opacity-40 font-bold uppercase">h</span>
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    </div>"""

    # We use a greedy approach to find the whole dayEntries.map block.
    # It starts with `{dayEntries.map(entry => (`
    # and ends with `))}` followed by some closing divs.
    
    start_tag = '{dayEntries.map(entry => ('
    idx_map_start = content.find(start_tag)
    
    if idx_map_start == -1:
        print("Could not find dayEntries.map")
        sys.exit(1)
        
    # Find the end of the map. It's roughly 200-300 lines further.
    # Let's search for the closing of the GlassCard and the map.
    # We know the GlassCard starts with the `!p-3` className.
    
    # We replace the whole block from old_card_start to where the map ends.
    # Actually, we can just replace the specific GlassCard component.
    
    # Let's find the closing tag of that GlassCard.
    # It's better to replace the whole block inside the map.
    
    inner_start = content.find(old_card_start, idx_map_start)
    # The map ends with `))}`
    # We find the matching closing parens/braces for `{dayEntries.map(entry => (`
    
    # Simplified: Find the closing `</GlassCard>` of the one starting with `old_card_start`
    # and then the `);` or `)` that follows.
    
    # But wait, there are multiple layers. Let's just find the closing part of the map.
    # The map is inside `<div className="space-y-2 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-4 md:space-y-0">`
    
    container_tag = '<div className="space-y-2 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-4 md:space-y-0">'
    idx_container = content.find(container_tag)
    
    # Find the closing </div> for this container
    # Since we know the structure, we can find the end of the map.
    
    # Let's just use a string replacement for the GlassCard block.
    # The old GlassCard ends with `</GlassCard>` and then there's a `)` of the map.
    
    # Looking at my previous `read_file`, the GlassCard ends with:
    # </div>\n</GlassCard>\n))}\n</div>
    
    # Let's use a very specific end search.
    end_tag = ')}' # This is the end of the map
    
    # Actually, let's just replace the GlassCard block directly.
    # The old card content is huge, let's be careful.
    
    # We will identify the start of the card and the end.
    idx_card_start = content.find(old_card_start)
    # The card ends with `</GlassCard>`
    idx_card_end = content.find('</GlassCard>', idx_card_start) + len('</GlassCard>')
    
    if idx_card_start != -1 and idx_card_end != -1:
        new_content = content[:idx_card_start] + new_card + content[idx_card_end:]
        with open('pages/HistoryPage.tsx', 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("History cards updated successfully!")
    else:
        print("Card markers not found.")

if __name__ == '__main__':
    main()
