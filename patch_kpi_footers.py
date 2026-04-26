import sys

def main():
    try:
        with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    # 1. Update Overtime Card
    overtime_marker = '<span className="text-emerald-500 font-black uppercase tracking-widest text-xs">Überstunden</span>'
    overtime_block_end = '</span>\n                            <span className="text-sm text-muted-foreground font-bold">Std</span>\n                        </div>\n                    </SpotlightCard>'
    
    # Let's find the closing of the SpotlightCard for overtime
    idx_ot_start = content.find(overtime_marker)
    idx_ot_end = content.find('</SpotlightCard>', idx_ot_start)
    
    if idx_ot_start != -1 and idx_ot_end != -1:
        footer = """
                        <div className="mt-6 pt-4 border-t border-white/5 space-y-1 relative z-10">
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                                <span>Gesamt Ist:</span>
                                <span className="text-foreground font-mono">{totalBalanceStats.actual.toFixed(2)} h</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                                <span>Gesamt Soll:</span>
                                <span className="text-foreground font-mono">{totalBalanceStats.target.toFixed(2)} h</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                                <span>Seit:</span>
                                <span className="text-foreground font-mono">{totalBalanceStats.startStr ? new Date(totalBalanceStats.startStr).toLocaleDateString('de-DE') : '-'}</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                                <span>Stand (Abgegeben / Abbau):</span>
                                <span className="text-foreground font-mono">{totalBalanceStats.cutoffStr ? new Date(totalBalanceStats.cutoffStr).toLocaleDateString('de-DE') : '-'}</span>
                            </div>
                        </div>"""
        content = content[:idx_ot_end] + footer + "\n                    " + content[idx_ot_end:]

    # 2. Update Monthly Balance Card
    balance_marker = '<span className="text-teal-500 font-black uppercase tracking-widest text-xs">Monatsbilanz (Laufend)</span>'
    idx_bal_start = content.find(balance_marker)
    idx_bal_end = content.find('</SpotlightCard>', idx_bal_start)
    
    if idx_bal_start != -1 and idx_bal_end != -1:
        footer = """
                        <div className="mt-6 pt-4 border-t border-white/5 space-y-1 relative z-10">
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                                <span>Soll (Monat):</span>
                                <span className="text-foreground font-mono">{monthlyStats.target.toFixed(2)} h</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-black tracking-widest">
                                <span>Ist (inkl. Urlaub/Krank):</span>
                                <span className="text-foreground font-mono">{monthlyStats.actual.toFixed(2)} h</span>
                            </div>
                        </div>"""
        content = content[:idx_bal_end] + footer + "\n                    " + content[idx_bal_end:]

    with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("KPI footers added successfully!")

if __name__ == '__main__':
    main()
