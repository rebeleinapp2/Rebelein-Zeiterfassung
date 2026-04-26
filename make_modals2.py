import re
import sys

def main():
    try:
        with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    # 1. Add state variables for the modals
    state_insertion_point = "const [selectedDay, setSelectedDay] = useState<Date | null>(null);"
    state_variables = """
    const [showVacationModal, setShowVacationModal] = useState(false);
    const [showWorkModelModal, setShowWorkModelModal] = useState(false);
    const [showBalanceModal, setShowBalanceModal] = useState(false);
"""
    if state_insertion_point in content and "setShowVacationModal" not in content:
        content = content.replace(state_insertion_point, state_insertion_point + state_variables)

    # 2. Make KPI cards clickable
    # Urlaubsverwaltung KPI
    urlaub_kpi_start = 'SpotlightCard className="bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-purple-500/50 relative overflow-hidden group"'
    urlaub_kpi_new = 'SpotlightCard onClick={() => setShowVacationModal(true)} className="cursor-pointer bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10 hover:-translate-y-1 relative overflow-hidden group"'
    content = content.replace(urlaub_kpi_start, urlaub_kpi_new)

    # Arbeitszeit-Modell KPI
    work_kpi_block = """{/* Arbeitszeit-Modell */}
                    <SpotlightCard className="bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-blue-500/50 relative overflow-hidden group">"""
    work_kpi_new = """{/* Arbeitszeit-Modell */}
                    <SpotlightCard onClick={() => setShowWorkModelModal(true)} className="cursor-pointer bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 hover:-translate-y-1 relative overflow-hidden group">"""
    content = content.replace(work_kpi_block, work_kpi_new)

    # Startsaldo KPI
    startsaldo_kpi_block = """{/* Startsaldo */}
                    <SpotlightCard className="bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-cyan-500/50 relative overflow-hidden group">"""
    startsaldo_kpi_new = """{/* Startsaldo */}
                    <SpotlightCard onClick={() => setShowBalanceModal(true)} className="cursor-pointer bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-cyan-500/50 hover:shadow-lg hover:shadow-cyan-500/10 hover:-translate-y-1 relative overflow-hidden group">"""
    content = content.replace(startsaldo_kpi_block, startsaldo_kpi_new)

    # 3. Extract the DETAILED SECTIONS and wrap them in Modals
    detailed_sections_start = '{/* DETAILED SECTIONS */}'
    modals_below_start = '{/* MODAL: Calendar Day Detail (RESTORED) */}'

    idx_start = content.find(detailed_sections_start)
    idx_end = content.find(modals_below_start)

    if idx_start == -1 or idx_end == -1:
        print("Could not find DETAILED SECTIONS or MODAL: Calendar Day Detail")
        sys.exit(1)

    detailed_sections_content = content[idx_start:idx_end]

    # Remove detailed sections from the main layout
    content = content[:idx_start] + content[idx_end:]

    # Parse the detailed_sections_content
    idx_urlaub = detailed_sections_content.find('{/* URLAUBSVERWALTUNG DETAILS */}')
    idx_arbeit = detailed_sections_content.find('{/* ARBEITSZEIT-MODELL DETAILS */}')
    idx_saldo = detailed_sections_content.find('{/* STARTSALDO / ÜBERTRAG DETAILS */}')
    
    urlaub_content = detailed_sections_content[idx_urlaub:idx_arbeit]
    arbeit_content = detailed_sections_content[idx_arbeit:idx_saldo]
    
    saldo_content = detailed_sections_content[idx_saldo:]
    
    # We need to strip the final `</div>\n            </div>` that closes the detailed sections grid
    saldo_content = saldo_content.rsplit('</div>', 2)[0] + '</div>'

    def make_modal(state_var, content_block, set_state_var):
        header_repl = f'<button onClick={{() => {set_state_var}(false)}} className="absolute top-4 right-4 p-2 bg-background hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-colors z-50"><X size={{20}} /></button>'
        
        return f"""
            {{/* DYNAMIC MODAL: {state_var} */}}
            {{ {state_var} && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={{(e) => {{ if (e.target === e.currentTarget) {set_state_var}(false); }}}}>
                    <GlassCard className="w-full max-w-4xl max-h-[90vh] overflow-y-auto relative shadow-2xl border-border !p-0 bg-background">
                        {header_repl}
                        <div className="p-4 md:p-6">
                            {content_block}
                        </div>
                    </GlassCard>
                </div>
            )}}
"""

    urlaub_modal = make_modal('showVacationModal', urlaub_content, 'setShowVacationModal')
    arbeit_modal = make_modal('showWorkModelModal', arbeit_content, 'setShowWorkModelModal')
    saldo_modal = make_modal('showBalanceModal', saldo_content, 'setShowBalanceModal')

    insertion_idx = content.find('{/* MODAL: Calendar Day Detail (RESTORED) */}')
    new_content = content[:insertion_idx] + urlaub_modal + arbeit_modal + saldo_modal + content[insertion_idx:]

    with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
        f.write(new_content)

    print("Modals created and applied!")

if __name__ == '__main__':
    main()
