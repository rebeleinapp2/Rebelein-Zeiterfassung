import sys

def main():
    try:
        with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    # 1. Extract the Day Details Modal Content
    modal_start_marker = '{/* DYNAMIC FLOATING DAY DETAILS MODAL */}'
    modal_end_marker = '{/* DYNAMIC MODAL: showVacationModal */}'

    idx_modal_start = content.find(modal_start_marker)
    idx_modal_end = content.find(modal_end_marker)

    if idx_modal_start == -1 or idx_modal_end == -1:
        print("Could not find Modal start or end.")
        sys.exit(1)

    modal_section = content[idx_modal_start:idx_modal_end]
    
    # Remove the modal section from its original place
    content = content[:idx_modal_start] + content[idx_modal_end:]
    
    # Strip the wrappers from the modal section
    # The original wrapper looks like:
    # {
    #     selectedDay && (
    #         <div className="fixed inset-0 ...">
    #             <div className="w-full max-w-5xl ...">
    #                 {/* Decorative background glow */}
    
    inner_start_marker = '{/* Decorative background glow */}'
    idx_inner_start = modal_section.find(inner_start_marker)
    
    # We strip the closing tags
    #                         </div>
    #                     </div>
    #                 )
    #             }
    
    idx_inner_end = modal_section.rfind('</div>\n                    </div>\n                )')
    
    if idx_inner_start == -1 or idx_inner_end == -1:
        print("Could not parse modal internals.")
        sys.exit(1)
        
    day_details_inner = modal_section[idx_inner_start:idx_inner_end]
    
    # The close button needs to be adjusted. It is currently:
    # <button onClick={() => setSelectedDay(null)} className="absolute top-6 right-6 p-2 bg-muted hover:bg-red-500/20 text-muted-foreground hover:text-red-400 rounded-xl transition-all z-10"><X size={24} /></button>
    # We will keep it, it's perfect.
    
    # 2. Extract the KPI GRID
    kpi_start_marker = '{/* KPI GRID (Left 2/3) */}'
    kpi_end_marker = '{/* CALENDAR (Right 1/3) */}'
    
    idx_kpi_start = content.find(kpi_start_marker)
    idx_kpi_end = content.find(kpi_end_marker)
    
    if idx_kpi_start == -1 or idx_kpi_end == -1:
        print("Could not find KPI Grid start or end.")
        sys.exit(1)
        
    kpi_section = content[idx_kpi_start:idx_kpi_end]
    
    # The kpi_section starts with:
    # {/* KPI GRID (Left 2/3) */}
    # <div className="col-span-1 xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
    # ...
    # </div>
    
    # We will replace the whole kpi_section with our conditional block
    
    # We need to strip the outer div of the KPI Grid so we can wrap it
    kpi_inner_start = kpi_section.find('<div className="col-span-1 xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">')
    if kpi_inner_start == -1:
         print("Could not find inner KPI div.")
         sys.exit(1)
         
    kpi_inner_end = kpi_section.rfind('</div>')
    
    kpi_cards = kpi_section[kpi_inner_start + len('<div className="col-span-1 xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">'):kpi_inner_end]
    
    new_kpi_section = """                {/* KPI GRID OR DAY DETAILS (Left 2/3) */}
                <div className="col-span-1 xl:col-span-2">
                    {!selectedDay ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-500">""" + kpi_cards + """
                        </div>
                    ) : (
                        <div className="bg-card border border-border rounded-3xl shadow-xl overflow-hidden animate-in slide-in-from-left-8 fade-in duration-500 h-[650px] xl:h-full max-h-[80vh] overflow-y-auto scrollbar-thin p-6 md:p-8 relative">
                            """ + day_details_inner + """
                        </div>
                    )}
                </div>
"""

    content = content[:idx_kpi_start] + new_kpi_section + '\n                ' + content[idx_kpi_end:]
    
    # Remove leftover INLINE DAY DETAILS PANEL comment if it exists
    content = content.replace('{/* INLINE DAY DETAILS PANEL */}\n', '')

    with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    
    print("Day Details successfully integrated inline over the KPI Grid.")

if __name__ == '__main__':
    main()