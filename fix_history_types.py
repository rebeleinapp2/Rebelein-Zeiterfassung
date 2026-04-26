with open('pages/HistoryPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

config = """
const ENTRY_TYPES_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
    'work': { label: 'Arbeit', icon: Briefcase, color: 'text-primary' },
    'break': { label: 'Pause', icon: Coffee, color: 'text-orange-400' },
    'company': { label: 'Firma / Lager', icon: Building2, color: 'text-blue-400' },
    'office': { label: 'Büro', icon: Building, color: 'text-purple-400' },
    'warehouse': { label: 'Lager', icon: Warehouse, color: 'text-amber-400' },
    'car': { label: 'Firmenauto Pflege', icon: Car, color: 'text-slate-400' },
    'vacation': { label: 'Urlaub', icon: Palmtree, color: 'text-purple-400' },
    'sick': { label: 'Krank', icon: Stethoscope, color: 'text-red-400' },
    'holiday': { label: 'Feiertag', icon: PartyPopper, color: 'text-blue-400' },
    'unpaid': { label: 'Unbezahlt', icon: Ban, color: 'text-slate-500' },
    'sick_child': { label: 'Kind krank', icon: Stethoscope, color: 'text-red-400' },
    'sick_pay': { label: 'Krankengeld', icon: TrendingDown, color: 'text-rose-400' },
    'overtime_reduction': { label: 'Überstunden-Abbau', icon: TrendingDown, color: 'text-pink-400' },
    'emergency_service': { label: 'Notdienst', icon: Siren, color: 'text-rose-400' }
};
"""

insertion_point = "const HistoryPage: React.FC = () => {"
content = content.replace(insertion_point, config + "\n" + insertion_point)

with open('pages/HistoryPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed ENTRY_TYPES_CONFIG in HistoryPage.tsx")
