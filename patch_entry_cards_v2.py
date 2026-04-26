import re
import sys

def main():
    try:
        with open('pages/EntryPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    # The block we found in EntryPage.tsx (starts around line 2511):
    # return (
    #     <GlassCard key={entry.id} className="!p-3 group hover:bg-muted transition-colors border-border">
    #         <div className="flex justify-between items-start gap-3">
    #         ...
    #     </GlassCard>
    # );

    old_card_pattern = r'<GlassCard key=\{entry\.id\} className="!p-3 group hover:bg-muted transition-colors border-border">.*?</GlassCard>'
    
    # New single-layer glass card design matching HistoryPage
    # Note: EntryPage has slightly different variable names and types, so we adapt it.
    new_card = """<div
                                    key={entry.id}
                                    className="relative w-full overflow-hidden rounded-2xl p-4 bg-slate-900/30 backdrop-blur-xl border border-white/10 shadow-lg transition-all duration-500 hover:scale-[1.01] hover:shadow-2xl hover:border-white/20 group mb-3"
                                >
                                    <div className="flex gap-3">
                                        <div className="shrink-0">
                                            <div className={`h-10 w-10 rounded-full flex items-center justify-center border border-white/10 shadow-inner ${entry.type === 'break' ? 'bg-orange-500/20 text-orange-400' : (entry as any).isAbsence ? 'bg-purple-500/20 text-purple-300' : 'bg-primary/20 text-primary'}`}>
                                                {Icon && <Icon size={18} />}
                                            </div>
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex flex-col min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className={`font-black tracking-tight truncate ${(entry.type === 'break' || entry.type === 'break_manual') ? 'text-orange-300' : (entry as any).isAbsence ? 'text-purple-200' : 'text-white'}`}>
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
                                                        {entry.type ? ENTRY_TYPES_CONFIG[entry.type]?.label.split(' / ')[0] : 'Arbeit'}
                                                        {!(entry as any).isAbsence && entry.start_time && <span>• {entry.start_time} - {entry.end_time}</span>}
                                                    </span>
                                                </div>

                                                <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {!(entry as any).isAbsence && (
                                                        <button 
                                                            onClick={() => handleEditEntry(entry)} 
                                                            className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white transition-all"
                                                        >
                                                            <Edit2 size={14} />
                                                        </button>
                                                    )}
                                                    <button 
                                                        onClick={() => setDeleteConfirm({ isOpen: true, entryId: entry.id, entryName: entry.client_name || 'Eintrag', isAbsence: (entry as any).isAbsence })} 
                                                        className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg transition-all"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </div>

                                            {entry.note && (
                                                <div className="mt-2 text-sm text-white/70 italic bg-white/5 p-2 rounded-xl border border-white/5 relative group/note">
                                                    <StickyNote size={12} className="absolute -top-1 -left-1 text-white/20 rotate-12" />
                                                    {entry.note}
                                                </div>
                                            )}

                                            <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <SubmissionTimer entryDate={entry.date} submitted={!!entry.submitted} />
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
                                                    <span className="flex items-baseline gap-1">
                                                        {(entry as any).isAbsence ? (entry.hours || 0).toFixed(2) : formatDuration(entry.calc_duration_minutes ? entry.calc_duration_minutes / 60 : entry.hours)}
                                                        <span className="text-[10px] opacity-40 font-bold uppercase ml-0.5">h</span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>"""

    # Using direct string find/replace because regex with multiple lines can be tricky
    old_start = '<GlassCard key={entry.id} className="!p-3 group hover:bg-muted transition-colors border-border">'
    old_end = '</GlassCard>'
    
    # We find the specific instance within the currentEntries.map
    start_idx = content.find(old_start)
    if start_idx == -1:
        print("Start marker not found.")
        sys.exit(1)
        
    end_idx = content.find(old_end, start_idx) + len(old_end)
    
    new_content = content[:start_idx] + new_card + content[end_idx:]
    
    with open('pages/EntryPage.tsx', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Entry cards updated successfully!")

if __name__ == '__main__':
    main()
