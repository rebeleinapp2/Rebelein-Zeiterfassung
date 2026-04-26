import re
import sys

def main():
    try:
        with open('pages/EntryPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    # 1. Update the Main Date Card to not just set true, but toggle or handle the inline state
    # 2. Add AnimatePresence and motion.div for the inline calendar
    
    # We find the showDatePicker condition for the modal and remove it
    modal_block_start = '{/* MODAL: Date Picker */}' # Let's hope there's a comment or we find the block
    
    # Let's search for the block we identified earlier:
    # {
    #     showDatePicker && (
    #         RANGE_ABSENCE_TYPES.includes(entryType) ? (
    
    pattern = r'\{\s*showDatePicker\s*&&\s*\(\s*RANGE_ABSENCE_TYPES\.includes\(entryType\)\s*\?\s*\(\s*<GlassDatePicker.*?/>\s*\)\s*:\s*\(\s*<GlassDatePicker.*?/>\s*\)\s*\)\s*\}'
    content = re.sub(pattern, '', content, flags=re.DOTALL)

    # 3. Find the MAIN DATE CARD and insert the inline calendar below it
    date_card_end = '</GlassCard>'
    # We search for the specific GlassCard that handles date selection
    # It has `className={`relative !p-6 flex items-center justify-between group cursor-pointer`
    
    card_marker = 'relative !p-6 flex items-center justify-between group cursor-pointer'
    idx_card = content.find(card_marker)
    if idx_card == -1:
        print("Could not find Main Date Card.")
        sys.exit(1)
        
    # Find the closing tag of THIS GlassCard
    idx_close_card = content.find(date_card_end, idx_card) + len(date_card_end)
    
    inline_calendar_block = """
                    {/* INLINE ANIMATED CALENDAR */}
                    <AnimatePresence>
                        {showDatePicker && (
                            <motion.div
                                initial={{ height: 0, opacity: 0, marginTop: 0 }}
                                animate={{ height: 'auto', opacity: 1, marginTop: 16 }}
                                exit={{ height: 0, opacity: 0, marginTop: 0 }}
                                transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                                className="overflow-hidden"
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
                        )}
                    </AnimatePresence>"""

    new_content = content[:idx_close_card] + inline_calendar_block + content[idx_close_card:]

    with open('pages/EntryPage.tsx', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Entry calendar converted to inline animated version!")

if __name__ == '__main__':
    main()
