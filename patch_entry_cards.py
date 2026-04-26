import re
import sys

def main():
    try:
        with open('pages/EntryPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    # 1. Add ENTRY_TYPES_CONFIG to EntryPage if not already used in a way that matches HistoryPage
    # (Actually it's already there but let's make sure our card matches)
    
    # 2. Find the entry map section
    # <div className="space-y-4">
    # {dailyEntries.map((entry) => (
    #     <GlassCard key={entry.id} className="relative overflow-hidden transition-all duration-300">
    
    old_card_start = '<GlassCard key={entry.id} className="relative overflow-hidden transition-all duration-300">'
    
    # New single-layer glass card design matching HistoryPage
    new_card = """<div
                                    key={entry.id}
                                    className="relative w-full overflow-hidden rounded-2xl p-4 bg-slate-900/30 backdrop-blur-xl border border-white/10 shadow-lg transition-all duration-500 hover:scale-[1.01] hover:shadow-2xl hover:border-white/20 group"
                                >
                                    <div className="flex gap-3">
                                        <div className="shrink-0">
                                            <div className={`h-10 w-10 rounded-full flex items-center justify-center border border-white/10 shadow-inner ${entry.type === 'break' ? 'bg-orange-500/20 text-orange-400' : entry.type === 'vacation' || entry.type === 'sick' || entry.type === 'holiday' ? 'bg-purple-500/20 text-purple-300' : 'bg-primary/20 text-primary'}`}>
                                                {getEntryIcon(entry.type)}
                                            </div>
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex flex-col min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className={`font-black tracking-tight truncate ${entry.type === 'break' ? 'text-orange-300' : entry.type === 'vacation' || entry.type === 'sick' || entry.type === 'holiday' ? 'text-purple-200' : 'text-white'}`}>
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
                                                    <button 
                                                        onClick={() => {
                                                            setEditingEntryId(entry.id);
                                                            setClient(entry.client_name);
                                                            setOrderNumber(entry.order_number || '');
                                                            setProjectStartTime(entry.start_time || '');
                                                            setProjectEndTime(entry.end_time || '');
                                                            setHours(entry.hours.toString().replace('.', ','));
                                                            setNote(entry.note || '');
                                                            setEntryType(entry.type);
                                                            window.scrollTo({ top: 0, behavior: 'smooth' });
                                                        }} 
                                                        className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white transition-all"
                                                    >
                                                        <Edit2 size={14} />
                                                    </button>
                                                    <button onClick={() => handleDeleteEntry(entry.id)} className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg transition-all">
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
                                                    <SubmissionTimer entryDate={entry.date} submitted={!!entry.submitted} isAbsence={entry.type === 'vacation' || entry.type === 'sick' || entry.type === 'holiday'} />
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
                                                        {entry.hours.toFixed(2)}
                                                        <span className="text-[10px] opacity-40 font-bold uppercase">h</span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>"""

    # We replace the whole card block inside the map
    # Find start of map
    idx_map_start = content.find('{dailyEntries.map((entry) => (')
    if idx_map_start == -1:
        print("Could not find dailyEntries.map")
        sys.exit(1)
        
    idx_card_start = content.find(old_card_start, idx_map_start)
    # The card ends with `</GlassCard>`
    idx_card_end = content.find('</GlassCard>', idx_card_start) + len('</GlassCard>')
    
    if idx_card_start != -1 and idx_card_end != -1:
        new_content = content[:idx_card_start] + new_card + content[idx_card_end:]
        with open('pages/EntryPage.tsx', 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("Entry cards updated successfully!")
    else:
        print("Card markers not found.")

if __name__ == '__main__':
    main()
