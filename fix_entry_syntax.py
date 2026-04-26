import re
import sys

def main():
    try:
        with open('pages/EntryPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    # 1. Identify the incorrectly nested calendar block
    pattern = r'\{/\* FLOATING OVERLAY CALENDAR \(FIXED\) \*/\}.*?</AnimatePresence>'
    match = re.search(pattern, content, flags=re.DOTALL)
    
    if not match:
        print("Could not find calendar block.")
        sys.exit(1)
        
    calendar_block = match.group(0)
    
    # Remove it and the surrounding broken tags
    content = content.replace(calendar_block, "")
    
    # We also need to fix the broken div closing that was misplaced
    # The deleteConfirm block ends with `</GlassCard>` followed by a closing `)` for the condition.
    # But currently it has an extra `</div>` after it in the wrong place.
    
    # Let's find the deleteConfirm end:
    delete_end_marker = """                            </button>
                        </div>
                    </GlassCard>"""
    
    # It should be followed by:
    #                 </div>
    #             )}
    
    # Currently it might look like:
    #                     </GlassCard>
    #                 
    #             
    # </div>
    #             )}

    # Let's just fix the whole ending section of the file.
    # We'll take everything from the start of deleteConfirm until the end of the file
    # and re-write it correctly.
    
    delete_start_marker = '{deleteConfirm.isOpen && ('
    idx_delete_start = content.find(delete_start_marker)
    
    if idx_delete_start == -1:
        print("Could not find delete confirm start.")
        sys.exit(1)
        
    # Content BEFORE deleteConfirm
    prefix = content[:idx_delete_start]
    
    # We need to find the logic INSIDE deleteConfirm to preserve it
    delete_content_start = content.find('<div', idx_delete_start)
    delete_content_end = content.find('</GlassCard>', delete_content_start) + len('</GlassCard>')
    
    delete_inner = content[delete_content_start:delete_content_end]
    
    new_ending = """            {deleteConfirm.isOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <GlassCard className="w-full max-w-sm !p-0 overflow-hidden ring-1 ring-red-500/20 shadow-2xl">
""" + content[content.find('<div className="p-5', idx_delete_start):content.find('</GlassCard>', idx_delete_start)] + """                    </GlassCard>
                </div>
            )}

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
            </AnimatePresence>
        </div>
    );
};

export default EntryPage;"""

    with open('pages/EntryPage.tsx', 'w', encoding='utf-8') as f:
        f.write(prefix + new_ending)
        
    print("Syntax fixed and calendar moved outside condition.")

if __name__ == '__main__':
    main()
