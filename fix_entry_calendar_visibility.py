import re
import sys

def main():
    try:
        with open('pages/EntryPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    # 1. Remove the current floating overlay block from its nested position
    pattern = r'\{/\* FLOATING OVERLAY CALENDAR \*/\}.*?</AnimatePresence>'
    content = re.sub(pattern, '', content, flags=re.DOTALL)

    # 2. Re-insert it at the end of the return block, before the closing </div> of the component
    # This ensures it's above everything and not clipped by overflow-hidden
    
    floating_calendar_fixed = """
            {/* FLOATING OVERLAY CALENDAR (FIXED) */}
            <AnimatePresence>
                {showDatePicker && (
                    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
                        {/* Backdrop with Blur */}
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowDatePicker(false)}
                            className="absolute inset-0 bg-background/60 backdrop-blur-sm"
                        />
                        
                        {/* Calendar Card */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            transition={{ type: "spring", damping: 25, stiffness: 300 }}
                            className="relative z-10 w-full max-w-sm"
                        >
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
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>"""

    # Find the very last </div> of the main return
    # The component ends with:
    #             {/* TEAM CONFIRM MODAL */}
    #             ...
    #         </div>
    #     );
    # };
    
    # Let's find the last </div> before the return ends.
    last_div_idx = content.rfind('</div>')
    
    if last_div_idx != -1:
        new_content = content[:last_div_idx] + floating_calendar_fixed + '\n' + content[last_div_idx:]
        with open('pages/EntryPage.tsx', 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("Calendar fixed and moved to root level overlay.")
    else:
        print("Could not find insertion point.")

if __name__ == '__main__':
    main()
