import re
import sys

def main():
    try:
        with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    # 1. Find the Calendar Day Detail Modal
    start_marker = '{/* MODAL: Calendar Day Detail (RESTORED) */}'
    end_marker = '{/* Date Pickers */}'

    idx_start = content.find(start_marker)
    idx_end = content.find(end_marker)

    if idx_start == -1 or idx_end == -1:
        print("Could not find Modal start or end.")
        sys.exit(1)

    modal_content = content[idx_start:idx_end]

    # We want to remove the modal_content from its current position
    content = content[:idx_start] + content[idx_end:]

    # Now we modify the modal_content to make it an inline panel instead of a fixed modal
    # Original: <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-input backdrop-blur-md animate-in fade-in duration-200">
    #           <GlassCard className="w-full max-w-7xl max-h-[90vh] overflow-y-auto relative shadow-2xl border-border">
    
    # We'll use regex to replace the wrapper.
    # It's a bit nested, so we can just replace the known outer string.
    
    wrapper_start = """                selectedDay && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-input backdrop-blur-md animate-in fade-in duration-200">
                        <GlassCard className="w-full max-w-7xl max-h-[90vh] overflow-y-auto relative shadow-2xl border-border">"""
    
    new_wrapper_start = """                selectedDay && (
                    <div className="mt-8 animate-in slide-in-from-top-8 duration-500 fade-in">
                        <div className="w-full relative shadow-xl border border-border rounded-3xl bg-card p-6 md:p-8 overflow-hidden">
                            {/* Decorative background glow */}
                            <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-blue-500/5 to-transparent pointer-events-none" />"""

    modal_content = modal_content.replace(wrapper_start, new_wrapper_start)
    
    # Replace the close button X
    close_btn = '<button onClick={() => setSelectedDay(null)} className="absolute top-4 right-4 p-2 bg-card hover:bg-accent rounded-full text-foreground transition-colors"><X size={20} /></button>'
    new_close_btn = '<button onClick={() => setSelectedDay(null)} className="absolute top-6 right-6 p-2 bg-muted hover:bg-red-500/20 text-muted-foreground hover:text-red-400 rounded-xl transition-all z-10"><X size={24} /></button>'
    modal_content = modal_content.replace(close_btn, new_close_btn)

    # Replace the ending tags
    # Original ends with:
    #                        </GlassCard>
    #                    </div >
    #                )
    wrapper_end = """                        </GlassCard>
                    </div >
                )"""
    new_wrapper_end = """                        </div>
                    </div>
                )"""
    # Just in case there are spacing differences:
    # Let's use a simpler replace from the end of the block.
    # The block ends right before '{/* Date Pickers */}', which has some `}` and `)` tags.
    # Actually, we can just replace the last `</GlassCard>\n                    </div >` with `</div>\n                    </div>`
    
    modal_content = modal_content.replace('</GlassCard>', '</div>')
    modal_content = modal_content.replace('</div >', '</div>') # Fix typo in original

    # 2. Insert the modified panel below the HERO SECTION
    # Find where KANBAN TASKS starts:
    kanban_start = '{/* KANBAN TASKS */}'
    idx_kanban = content.find(kanban_start)
    if idx_kanban == -1:
        print("Could not find KANBAN TASKS.")
        sys.exit(1)

    new_content = content[:idx_kanban] + '{/* INLINE DAY DETAILS PANEL */}\n' + modal_content + '\n' + content[idx_kanban:]

    with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
        f.write(new_content)

    print("Modal successfully integrated as an inline panel!")

if __name__ == '__main__':
    main()
