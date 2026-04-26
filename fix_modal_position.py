import sys

def main():
    try:
        with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    start_marker = '{/* INLINE DAY DETAILS PANEL */}'
    end_marker = '{/* KANBAN TASKS */}'

    idx_start = content.find(start_marker)
    idx_end = content.find(end_marker)

    if idx_start == -1 or idx_end == -1:
        print("Markers not found.")
        sys.exit(1)

    panel_content = content[idx_start:idx_end]
    content = content[:idx_start] + content[idx_end:]

    # Modify the wrapper of the panel to be a top-floating modal
    old_wrapper_start = """{/* MODAL: Calendar Day Detail (RESTORED) */}
            {
                selectedDay && (
                    <div className="mt-8 animate-in slide-in-from-top-8 duration-500 fade-in">
                        <div className="w-full relative shadow-xl border border-border rounded-3xl bg-card p-6 md:p-8 overflow-hidden">"""
    
    new_wrapper_start = """{/* DYNAMIC FLOATING DAY DETAILS MODAL */}
            {
                selectedDay && (
                    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-8 md:pt-16 px-4 bg-background/80 backdrop-blur-md animate-in fade-in duration-300" onClick={(e) => { if (e.target === e.currentTarget) setSelectedDay(null); }}>
                        <div className="w-full max-w-5xl max-h-[85vh] overflow-y-auto relative shadow-2xl border border-border rounded-3xl bg-card p-6 md:p-8 scrollbar-thin scrollbar-thumb-teal-500/20 scrollbar-track-transparent animate-in slide-in-from-top-12 duration-500 ease-out">"""
    
    panel_content = panel_content.replace(old_wrapper_start, new_wrapper_start)

    # Insert it near the bottom where other modals are
    modal_section_idx = content.find('{/* DYNAMIC MODAL: showVacationModal */}')
    if modal_section_idx == -1:
        modal_section_idx = content.find('{/* Date Pickers */}')
    
    if modal_section_idx != -1:
        new_content = content[:modal_section_idx] + panel_content + '\n' + content[modal_section_idx:]
    else:
        new_content = content + '\n' + panel_content

    with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print("Modal successfully converted to a floating overlay.")

if __name__ == '__main__':
    main()
