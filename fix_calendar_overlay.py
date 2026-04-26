import re
import sys

def main():
    try:
        with open('pages/EntryPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    # 1. Remove the current inline calendar block
    inline_start = '{/* INLINE ANIMATED CALENDAR */}'
    inline_end = '</AnimatePresence>'
    
    start_idx = content.find(inline_start)
    # Careful: we need to find the correct AnimatePresence close tag
    # The block we added is quite specific
    
    if start_idx != -1:
        # We search for the end of our specific block
        end_idx = content.find(inline_end, start_idx) + len(inline_end)
        content = content[:start_idx] + content[end_idx:]

    # 2. Add the new Floating Overlay version
    # We want it to be absolute positioned relative to a container, 
    # but still above everything.
    
    # We find the DATE CARD container to make it relative
    # Original: <div className="mb-6 relative">
    # (The one wrapping the Date Card)
    
    # Let's search for the Date Card again
    card_marker = 'relative !p-6 flex items-center justify-between group cursor-pointer'
    idx_card = content.find(card_marker)
    
    # Find the parent div of this card
    # It's usually the one with "mb-6 relative"
    parent_idx = content.rfind('<div className="mb-6 relative">', 0, idx_card)
    
    if parent_idx == -1:
        # Fallback: search for any div before it
        parent_idx = content.rfind('<div', 0, idx_card)

    # We insert the absolute positioned calendar INSIDE this relative parent, 
    # but after the GlassCard.
    
    # Find the closing of the GlassCard
    close_card = '</GlassCard>'
    idx_close_card = content.find(close_card, idx_card) + len(close_card)
    
    floating_calendar = """
                    {/* FLOATING OVERLAY CALENDAR */}
                    <AnimatePresence>
                        {showDatePicker && (
                            <>
                                {/* Invisible Backdrop to close on click outside */}
                                <div className="fixed inset-0 z-[100]" onClick={() => setShowDatePicker(false)} />
                                
                                <motion.div
                                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                    transition={{ duration: 0.2, ease: "easeOut" }}
                                    className="absolute top-full left-0 right-0 z-[110] mt-2 origin-top"
                                >
                                    <div className="w-full max-w-sm mx-auto">
                                        {RANGE_ABSENCE_TYPES.includes(entryType) ? (
                                            <GlassDatePicker
                                                value={date}
                                                onChange={setDate}
                                                onClose={() => setShowDatePicker(false)}
                                                rangeMode={true}
                                                rangeStart={date}
                                                rangeEnd={endDate || date}
                                                onRangeChange={(start, end) => {
                                                    setDate(start);
                                                    setEndDate(end);
                                                }}
                                                inline={true}
                                            />
                                        ) : (
                                            <GlassDatePicker
                                                value={date}
                                                onChange={setDate}
                                                onClose={() => setShowDatePicker(false)}
                                                gracePeriodCutoff={gracePeriodCutoff}
                                                inline={true}
                                            />
                                        )}
                                    </div>
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence>"""

    new_content = content[:idx_close_card] + floating_calendar + content[idx_close_card:]

    with open('pages/EntryPage.tsx', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Calendar converted to floating overlay!")

if __name__ == '__main__':
    main()
