import sys

def main():
    try:
        with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    # 1. Overtime status line
    ot_end = '<span className="text-sm text-muted-foreground font-bold">Std</span>\n                        </div>'
    ot_status = """
                        <div className="flex items-center gap-1.5 mt-1 relative z-10">
                            <TrendingDown size={14} className={totalBalanceStats.diff >= 0 ? 'rotate-180 text-emerald-400' : 'text-red-400'} />
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${totalBalanceStats.diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {totalBalanceStats.diff >= 0 ? 'Guthaben' : 'Minusstunden'}
                            </span>
                        </div>"""
    
    # We find the one for overtime (first occurrence usually, but let's be safe)
    idx = content.find('Überstundenkonto')
    idx_insert = content.find('</div>', idx) + 1 # finding the end of the flex items-baseline div
    # Wait, the read_file output shows:
    # <div className="flex items-baseline gap-2 relative z-10">
    # ...
    # </div>
    
    # Let's use a more robust search
    pattern_ot = r'(<span class="text-emerald-500 font-black uppercase tracking-widest text-xs">Überstundenkonto</span>.*?<span class="text-sm text-muted-foreground font-bold">Std</span>\s*</div>)'
    # Actually I used double quotes in my code
    
    idx_ot_val = content.find('{totalBalanceStats.diff.toFixed(2)}')
    if idx_ot_val != -1:
         idx_insert = content.find('</div>', idx_ot_val) + 6
         content = content[:idx_insert] + ot_status + content[idx_insert:]

    # 2. Balance status line
    idx_bal_val = content.find('{monthlyStats.diff.toFixed(2)}')
    if idx_bal_val != -1:
        bal_status = """
                        <div className="flex items-center gap-1.5 mt-1 relative z-10">
                            <Scale size={14} className={monthlyStats.diff >= 0 ? 'text-teal-400' : 'text-red-400'} />
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${monthlyStats.diff >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
                                Differenz (Soll/Ist)
                            </span>
                        </div>"""
        idx_insert = content.find('</div>', idx_bal_val) + 6
        content = content[:idx_insert] + bal_status + content[idx_insert:]

    with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Status lines added.")

if __name__ == '__main__':
    main()
