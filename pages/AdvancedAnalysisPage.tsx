
import React, { useState, useEffect, useMemo } from 'react';
import { useOfficeService, getLocalISOString, getDailyTargetForDate } from '../services/dataService';
import { supabase } from '../services/supabaseClient';
import { formatDuration } from '../services/utils/timeUtils';
import { GlassCard, GlassButton, GlassInput } from '../components/GlassCard';
import { Calendar, Filter, Save, FileDown, PieChart, BarChart3, TrendingUp, Users, CheckSquare, Square, RefreshCcw, Calculator, Coins, Trash2 } from 'lucide-react';
import GlassDatePicker from '../components/GlassDatePicker';
import { TimeEntry, UserSettings, UserAbsence } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';

// Typen für die Auswertung
interface AnalysisStats {
    userId: string;
    displayName: string;
    totalHours: number;
    targetHours: number;
    billableHours: number; // type: work
    overheadHours: number; // type: company, office, warehouse, car
    absenceHours: number;
    breakHours: number;
    efficiency: number; // billable / total presence
    costEstimate: number;
}

interface FilterPreset {
    id: string;
    name: string;
    filters: {
        startDate: string;
        endDate: string;
        selectedUserIds: string[];
        selectedTypes: string[];
    }
}

// Translations for Filter UI
const TYPE_LABELS: Record<string, string> = {
    work: 'Arbeit / Projekt',
    company: 'Firma',
    office: 'Büro',
    warehouse: 'Lager',
    car: 'Auto / Fahrt',
    break: 'Pause',
    overtime_reduction: 'Gutstunden'
};

const AdvancedAnalysisPage: React.FC = () => {
    const { showToast } = useToast();
    const { users, fetchAllUsers } = useOfficeService();

    // --- STATE ---

    // Filter State
    const [startDate, setStartDate] = useState(() => {
        const d = new Date(); d.setDate(1); return getLocalISOString(d); // 1. des Monats
    });
    const [endDate, setEndDate] = useState(getLocalISOString());
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [selectedTypes, setSelectedTypes] = useState<string[]>(['work', 'company', 'office', 'warehouse', 'car']);

    // UI State
    const [showStartPicker, setShowStartPicker] = useState(false);
    const [showEndPicker, setShowEndPicker] = useState(false);
    const [hourlyRate, setHourlyRate] = useState<number>(35.00); // Standardkostensatz
    const [loading, setLoading] = useState(false);

    // Data State
    const [rawData, setRawData] = useState<{ entries: TimeEntry[], absences: UserAbsence[] }>({ entries: [], absences: [] });

    // Presets (Database Backed)
    const [presets, setPresets] = useState<FilterPreset[]>([]);
    const [presetName, setPresetName] = useState('');
    const [confirmDeleteDialog, setConfirmDeleteDialog] = useState<{ isOpen: boolean, presetId: string | null }>({ isOpen: false, presetId: null });

    // --- INITIALIZATION ---
    useEffect(() => {
        fetchAllUsers();
        fetchPresets();

        // Realtime Subscription für Presets
        const channel = supabase
            .channel('realtime_presets')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'analysis_presets' }, () => {
                fetchPresets();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const fetchPresets = async () => {
        const { data, error } = await supabase
            .from('analysis_presets')
            .select('*')
            .order('name');

        if (error) console.error("Fehler beim Laden der Vorlagen:", error);
        else setPresets(data as FilterPreset[]);
    }

    // Default select all users once loaded if none selected
    useEffect(() => {
        if (users.length > 0 && selectedUserIds.length === 0) {
            setSelectedUserIds(users.map(u => u.user_id!));
        }
    }, [users]);

    // --- DATA FETCHING ---
    const fetchData = async () => {
        setLoading(true);

        // Fetch Entries
        const { data: entriesData, error: entError } = await supabase
            .from('time_entries')
            .select('*')
            .gte('date', startDate)
            .lte('date', endDate);

        // Fetch Absences (für Soll-Korrektur und Anzeige)
        const { data: absData, error: absError } = await supabase
            .from('user_absences')
            .select('*')
            .lte('start_date', endDate)
            .gte('end_date', startDate);

        if (entError || absError) {
            console.error(entError, absError);
            showToast("Fehler beim Laden der Daten.", "error");
        } else {
            setRawData({
                entries: entriesData as TimeEntry[],
                absences: absData as UserAbsence[]
            });
        }
        setLoading(false);
    };

    // Auto-Fetch on Filter Change (Debounced could be better, but direct is fine for now)
    useEffect(() => {
        if (startDate && endDate) fetchData();
    }, [startDate, endDate]);


    // --- CALCULATION ENGINE ---
    const stats: AnalysisStats[] = useMemo(() => {
        if (!rawData.entries) return [];

        return selectedUserIds.map(uid => {
            const user = users.find(u => u.user_id === uid);
            if (!user) return null;

            // Filter entries for this user
            const userEntries = rawData.entries.filter(e => e.user_id === uid);
            const userAbsences = rawData.absences.filter(a => a.user_id === uid);

            // Calculate Metrics
            let billable = 0;
            let overhead = 0;
            let breaks = 0;

            userEntries.forEach(e => {
                if (e.type === 'break') {
                    breaks += e.hours;
                } else if (e.type === 'work') {
                    billable += e.hours;
                } else if (['company', 'office', 'warehouse', 'car'].includes(e.type || '')) {
                    overhead += e.hours;
                }
            });

            // Soll-Stunden Berechnung für den Zeitraum
            let target = 0;
            let absenceHours = 0;

            const cur = new Date(startDate);
            const end = new Date(endDate);

            while (cur <= end) {
                const dStr = getLocalISOString(cur);
                const dayTarget = getDailyTargetForDate(dStr, user.target_hours);

                // Prüfen auf Abwesenheit
                const abs = userAbsences.find(a => dStr >= a.start_date && dStr <= a.end_date);

                if (abs) {
                    if (abs.type !== 'unpaid') absenceHours += dayTarget;
                } else {
                    target += dayTarget;
                }
                cur.setDate(cur.getDate() + 1);
            }

            // Filter based on selected Types for TOTAL display
            let displayedTotal = 0;
            userEntries.forEach(e => {
                if (selectedTypes.includes(e.type || 'work')) {
                    displayedTotal += e.hours;
                }
            });

            const totalPresence = billable + overhead;
            const efficiency = totalPresence > 0 ? (billable / totalPresence) * 100 : 0;
            const cost = displayedTotal * hourlyRate; // Einfache Kalkulation auf angezeigte Stunden

            return {
                userId: uid,
                displayName: user.display_name,
                totalHours: displayedTotal,
                targetHours: target,
                billableHours: billable,
                overheadHours: overhead,
                absenceHours: absenceHours,
                breakHours: breaks,
                efficiency,
                costEstimate: cost
            };
        }).filter(Boolean) as AnalysisStats[];

    }, [rawData, selectedUserIds, selectedTypes, users, startDate, endDate, hourlyRate]);

    // Aggregierte Gesamtwerte
    const totals = useMemo(() => {
        return stats.reduce((acc, curr) => ({
            billable: acc.billable + curr.billableHours,
            overhead: acc.overhead + curr.overheadHours,
            total: acc.total + curr.totalHours,
            cost: acc.cost + curr.costEstimate
        }), { billable: 0, overhead: 0, total: 0, cost: 0 });
    }, [stats]);


    // --- HANDLERS ---

    const toggleUser = (id: string) => {
        setSelectedUserIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const toggleType = (type: string) => {
        setSelectedTypes(prev =>
            prev.includes(type) ? prev.filter(x => x !== type) : [...prev, type]
        );
    };

    const savePreset = async () => {
        if (!presetName) return showToast("Bitte Namen eingeben", "warning");

        const filters = { startDate, endDate, selectedUserIds, selectedTypes };

        const { error } = await supabase.from('analysis_presets').insert({
            name: presetName,
            filters: filters
        });

        if (error) {
            showToast("Fehler beim Speichern: " + error.message, "error");
        } else {
            setPresetName('');
        }
    };

    const loadPreset = (preset: FilterPreset) => {
        if (preset.filters.startDate) setStartDate(preset.filters.startDate);
        if (preset.filters.endDate) setEndDate(preset.filters.endDate);
        if (preset.filters.selectedUserIds) setSelectedUserIds(preset.filters.selectedUserIds);
        if (preset.filters.selectedTypes) setSelectedTypes(preset.filters.selectedTypes);
    };

    const deletePreset = async (id: string, confirmed: boolean = false) => {
        if (!confirmed) {
            setConfirmDeleteDialog({ isOpen: true, presetId: id });
            return;
        }
        const { error } = await supabase.from('analysis_presets').delete().eq('id', id);
        if (error) showToast("Fehler beim Löschen: " + error.message, "error");
        setConfirmDeleteDialog({ isOpen: false, presetId: null });
    };

    // --- EXPORT FUNCTIONALITY ---

    const exportCSV = () => {
        const header = ["Mitarbeiter", "Soll (h)", "Ist (Gesamt h)", "Verrechenbar (h)", "Gemeinkosten (h)", "Effizienz (%)", "Kosten (EUR)"];
        const rows = stats.map(s => [
            s.displayName,
            s.targetHours.toFixed(2),
            s.totalHours.toFixed(2),
            s.billableHours.toFixed(2),
            s.overheadHours.toFixed(2),
            s.efficiency.toFixed(1) + '%',
            s.costEstimate.toFixed(2)
        ]);

        const csvContent = "data:text/csv;charset=utf-8,"
            + header.join(";") + "\n"
            + rows.map(e => e.join(";")).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `auswertung_${startDate}_${endDate}.csv`);
        document.body.appendChild(link);
        link.click();
    };

    const generatePDF = () => {
        const doc = new jsPDF('l', 'mm', 'a4'); // Landscape for more columns

        // Header
        doc.setFontSize(18);
        doc.setFont("helvetica", "bold");
        doc.text("Detaillierte Auswertung (Profi)", 14, 20);

        doc.setFontSize(11);
        doc.setFont("helvetica", "normal");
        doc.text(`Zeitraum: ${new Date(startDate).toLocaleDateString('de-DE')} bis ${new Date(endDate).toLocaleDateString('de-DE')}`, 14, 28);
        doc.text(`Erstellt am: ${new Date().toLocaleDateString('de-DE')}`, 14, 34);

        // Summary Box
        doc.setDrawColor(20, 184, 166); // Teal
        doc.setLineWidth(0.5);
        doc.rect(200, 15, 80, 25);
        doc.setFontSize(10);
        doc.text("Gesamtstunden:", 205, 22);
        doc.text(totals.total.toFixed(2) + " h", 275, 22, { align: 'right' });
        doc.text("Davon Verrechenbar:", 205, 28);
        doc.text(totals.billable.toFixed(2) + " h", 275, 28, { align: 'right' });
        doc.text("Kostenschätzung:", 205, 34);
        doc.text(totals.cost.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }), 275, 34, { align: 'right' });

        // Table
        const tableBody = stats.map(s => [
            s.displayName,
            s.targetHours.toFixed(2),
            s.totalHours.toFixed(2),
            s.billableHours.toFixed(2),
            s.overheadHours.toFixed(2),
            s.absenceHours.toFixed(2),
            s.efficiency.toFixed(1) + '%',
            s.costEstimate.toFixed(0) + ' €'
        ]);

        autoTable(doc, {
            startY: 45,
            head: [['Mitarbeiter', 'Soll (h)', 'Ist (h)', 'Verrech. (h)', 'Gemein. (h)', 'Urlaub/Kr (h)', 'Quote', 'Kosten']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [20, 184, 166], textColor: [255, 255, 255], fontStyle: 'bold' },
            columnStyles: {
                0: { fontStyle: 'bold' },
                1: { halign: 'right' },
                2: { halign: 'right', fontStyle: 'bold' },
                3: { halign: 'right', textColor: [20, 184, 166] },
                4: { halign: 'right' },
                5: { halign: 'right' },
                6: { halign: 'right' },
                7: { halign: 'right' }
            },
            foot: [[
                'GESAMT',
                '-',
                totals.total.toFixed(2),
                totals.billable.toFixed(2),
                totals.overhead.toFixed(2),
                '-',
                ((totals.billable / (totals.billable + totals.overhead || 1)) * 100).toFixed(1) + '%',
                totals.cost.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
            ]],
            footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'right' }
        });

        doc.save(`profi_auswertung_${startDate}_${endDate}.pdf`);
    };

    // --- RENDER ---

    return (
        <div className="hidden md:flex flex-row h-full w-full bg-gray-900 text-white overflow-hidden">

            {/* SIDEBAR: FILTER & PRESETS */}
            <div className="w-80 flex-shrink-0 border-r border-white/10 bg-gray-900/50 p-6 overflow-y-auto flex flex-col gap-8">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2 mb-6 text-purple-300">
                        <Filter size={24} /> Filter
                    </h2>

                    {/* Date Range */}
                    <div className="space-y-4 mb-6">
                        <div>
                            <label className="text-xs uppercase font-bold text-white/50 mb-1 block">Zeitraum Start</label>
                            <GlassInput value={startDate} readOnly onClick={() => setShowStartPicker(true)} className="cursor-pointer text-sm" />
                        </div>
                        <div>
                            <label className="text-xs uppercase font-bold text-white/50 mb-1 block">Zeitraum Ende</label>
                            <GlassInput value={endDate} readOnly onClick={() => setShowEndPicker(true)} className="cursor-pointer text-sm" />
                        </div>
                    </div>

                    {/* Entry Types */}
                    <div className="mb-6">
                        <label className="text-xs uppercase font-bold text-white/50 mb-2 block">Kategorien</label>
                        <div className="space-y-1">
                            {['work', 'company', 'office', 'warehouse', 'car', 'break', 'overtime_reduction'].map(type => (
                                <button
                                    key={type}
                                    onClick={() => toggleType(type)}
                                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold transition-all ${selectedTypes.includes(type) ? 'bg-teal-500/20 text-teal-200 border border-teal-500/30' : 'bg-white/5 text-white/40 border border-transparent'
                                        }`}
                                >
                                    {selectedTypes.includes(type) ? <CheckSquare size={14} /> : <Square size={14} />}
                                    <span className="uppercase">{TYPE_LABELS[type] || type}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Cost Config */}
                    <div className="mb-6">
                        <label className="text-xs uppercase font-bold text-white/50 mb-1 block flex items-center gap-1"><Coins size={12} /> Kostensatz (EUR/h)</label>
                        <GlassInput
                            type="number"
                            value={hourlyRate}
                            onChange={e => setHourlyRate(parseFloat(e.target.value))}
                            className="text-right font-mono text-sm"
                        />
                    </div>
                </div>

                {/* Users List */}
                <div className="flex-1">
                    <div className="flex justify-between items-center mb-2">
                        <label className="text-xs uppercase font-bold text-white/50">Mitarbeiter</label>
                        <button onClick={() => setSelectedUserIds(selectedUserIds.length === users.length ? [] : users.map(u => u.user_id!))} className="text-[10px] text-teal-400 hover:underline">
                            {selectedUserIds.length === users.length ? 'Keine' : 'Alle'}
                        </button>
                    </div>
                    <div className="max-h-60 overflow-y-auto space-y-1 pr-2">
                        {users.map(u => (
                            <button
                                key={u.user_id}
                                onClick={() => toggleUser(u.user_id!)}
                                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold transition-all ${selectedUserIds.includes(u.user_id!) ? 'bg-purple-500/20 text-purple-200 border border-purple-500/30' : 'bg-white/5 text-white/40 border border-transparent'
                                    }`}
                            >
                                <span>{u.display_name}</span>
                                {selectedUserIds.includes(u.user_id!) && <CheckSquare size={12} />}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Presets */}
                <div className="border-t border-white/10 pt-4">
                    <label className="text-xs uppercase font-bold text-white/50 mb-2 block">Vorlagen (Geteilt)</label>
                    <div className="flex gap-2 mb-2">
                        <GlassInput
                            placeholder="Name..."
                            value={presetName}
                            onChange={e => setPresetName(e.target.value)}
                            className="!py-1 !px-2 !text-xs h-8"
                        />
                        <button onClick={savePreset} className="p-2 bg-teal-500 rounded text-white hover:bg-teal-400"><Save size={14} /></button>
                    </div>
                    <div className="space-y-1">
                        {presets.length === 0 && <p className="text-[10px] text-white/30 italic">Keine Vorlagen gespeichert.</p>}
                        {presets.map(p => (
                            <div key={p.id} className="flex justify-between items-center bg-white/5 px-2 py-1 rounded text-xs group hover:bg-white/10 transition-colors">
                                <button onClick={() => loadPreset(p)} className="flex-1 text-left text-white/70 hover:text-white truncate">{p.name}</button>
                                <button onClick={() => deletePreset(p.id)} className="text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 p-1"><Trash2 size={12} /></button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* MAIN CONTENT */}
            <div className="flex-1 flex flex-col overflow-hidden relative">
                <div className="p-6 pb-0 flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <PieChart className="text-purple-400" /> Profi-Auswertung
                        </h1>
                        <p className="text-white/50 text-sm mt-1">
                            {new Date(startDate).toLocaleDateString()} - {new Date(endDate).toLocaleDateString()} • {selectedUserIds.length} Mitarbeiter
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <GlassButton onClick={generatePDF} className="w-auto px-4 py-2 flex items-center gap-2 text-sm !bg-red-500/20 !border-red-500/30 hover:!bg-red-500/30">
                            <FileDown size={16} /> PDF
                        </GlassButton>
                        <GlassButton onClick={exportCSV} className="w-auto px-4 py-2 flex items-center gap-2 text-sm">
                            <FileDown size={16} /> CSV
                        </GlassButton>
                    </div>
                </div>

                {loading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : (
                    <div className="p-6 overflow-y-auto space-y-6">
                        {/* KPI CARDS */}
                        <div className="grid grid-cols-4 gap-6">
                            <GlassCard className="bg-emerald-900/10 border-emerald-500/20">
                                <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2">Stunden Gesamt</div>
                                <div className="text-3xl font-mono font-bold text-white">{totals.total.toFixed(2)} <span className="text-sm text-white/40">h</span></div>
                                <div className="text-xs text-white/40 mt-1">Alle gewählten Kategorien</div>
                            </GlassCard>

                            <GlassCard className="bg-blue-900/10 border-blue-500/20">
                                <div className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">Verrechenbar</div>
                                <div className="text-3xl font-mono font-bold text-white">{totals.billable.toFixed(2)} <span className="text-sm text-white/40">h</span></div>
                                <div className="text-xs text-white/40 mt-1">Kategorie "Arbeit/Projekt"</div>
                            </GlassCard>

                            <GlassCard className="bg-yellow-900/10 border-yellow-500/20">
                                <div className="text-xs font-bold text-yellow-400 uppercase tracking-wider mb-2">Effizienz-Quote</div>
                                <div className="text-3xl font-mono font-bold text-white">
                                    {(totals.billable / (totals.billable + totals.overhead || 1) * 100).toFixed(1)} <span className="text-sm text-white/40">%</span>
                                </div>
                                <div className="text-xs text-white/40 mt-1">Anteil Projektzeit</div>
                            </GlassCard>

                            <GlassCard className="bg-gray-800/20 border-gray-500/20 relative overflow-hidden">
                                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Kosten-Schätzung</div>
                                <div className="text-3xl font-mono font-bold text-white">{totals.cost.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                                <div className="text-xs text-white/40 mt-1">@{hourlyRate.toFixed(2)}€/h</div>
                                <Calculator className="absolute -bottom-4 -right-4 text-white/5 w-24 h-24" />
                            </GlassCard>
                        </div>

                        {/* CHART VISUALIZATION */}
                        <GlassCard>
                            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><BarChart3 size={16} className="text-teal-400" /> Stundenverteilung pro Mitarbeiter</h3>
                            <div className="w-full h-64 flex items-end gap-4 p-4 bg-black/20 rounded-xl overflow-x-auto">
                                {stats.map(s => {
                                    const maxH = Math.max(...stats.map(x => x.totalHours), 1);
                                    const hPercent = (s.totalHours / maxH) * 100;
                                    const billablePercent = (s.billableHours / s.totalHours) * 100;

                                    return (
                                        <div key={s.userId} className="flex flex-col items-center gap-2 flex-1 min-w-[60px] group">
                                            <div className="relative w-12 bg-gray-700 rounded-t-lg overflow-hidden transition-all duration-500 group-hover:w-14" style={{ height: `${hPercent}%` }}>
                                                {/* Billable Part */}
                                                <div
                                                    className="absolute bottom-0 w-full bg-teal-500 transition-all duration-500 hover:bg-teal-400"
                                                    style={{ height: `${billablePercent}%` }}
                                                    title={`Verrechenbar: ${s.billableHours.toFixed(2)}h`}
                                                />
                                                {/* Overhead Part (Implicitly the background gray/top part) */}
                                            </div>
                                            <span className="text-[10px] text-white/60 font-bold truncate max-w-[80px]">{s.displayName.split(' ')[0]}</span>
                                            <span className="text-[10px] text-white/30 font-mono">{s.totalHours.toFixed(2)}h</span>
                                        </div>
                                    )
                                })}
                            </div>
                            <div className="flex gap-4 justify-center mt-4 text-xs">
                                <div className="flex items-center gap-2"><span className="w-3 h-3 bg-teal-500 rounded-sm"></span> Verrechenbar</div>
                                <div className="flex items-center gap-2"><span className="w-3 h-3 bg-gray-700 rounded-sm"></span> Gemeinkosten</div>
                            </div>
                        </GlassCard>

                        {/* DATA TABLE */}
                        <GlassCard className="overflow-hidden !p-0">
                            <table className="w-full text-left text-sm text-white/70">
                                <thead className="bg-white/5 text-white font-bold uppercase text-xs">
                                    <tr>
                                        <th className="p-4">Mitarbeiter</th>
                                        <th className="p-4 text-right text-emerald-300">Projekt (h)</th>
                                        <th className="p-4 text-right text-orange-300">Gemein. (h)</th>
                                        <th className="p-4 text-right text-purple-300">Urlaub/Krank (h)</th>
                                        <th className="p-4 text-right">Quote</th>
                                        <th className="p-4 text-right">Soll (h)</th>
                                        <th className="p-4 text-right">Kosten</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {stats.map(s => (
                                        <tr key={s.userId} className="hover:bg-white/5 transition-colors">
                                            <td className="p-4 font-bold text-white">{s.displayName}</td>
                                            <td className="p-4 text-right font-mono text-emerald-100">{s.billableHours.toFixed(2)}</td>
                                            <td className="p-4 text-right font-mono text-orange-100">{s.overheadHours.toFixed(2)}</td>
                                            <td className="p-4 text-right font-mono text-purple-100">{s.absenceHours.toFixed(2)}</td>
                                            <td className="p-4 text-right font-mono font-bold">
                                                <span className={`${s.efficiency > 75 ? 'text-emerald-400' : s.efficiency > 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                                                    {s.efficiency.toFixed(1)}%
                                                </span>
                                            </td>
                                            <td className="p-4 text-right font-mono opacity-50">{s.targetHours.toFixed(2)}</td>
                                            <td className="p-4 text-right font-mono opacity-70">{s.costEstimate.toFixed(0)} €</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </GlassCard>
                    </div>
                )}

                {/* Date Pickers */}
                {showStartPicker && <GlassDatePicker value={startDate} onChange={setStartDate} onClose={() => setShowStartPicker(false)} />}
                {showEndPicker && <GlassDatePicker value={endDate} onChange={setEndDate} onClose={() => setShowEndPicker(false)} />}
            </div>

            {/* MOBILE BLOCKER (Technically hidden via flex md:flex, but purely as safeguard) */}
            <div className="md:hidden fixed inset-0 bg-gray-900 z-[9999] flex items-center justify-center p-8 text-center">
                <div>
                    <div className="mx-auto w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center text-red-400 mb-4">
                        <BarChart3 size={32} />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-2">Desktop-Funktion</h2>
                    <p className="text-white/50">Die erweiterte Analyse ist für große Bildschirme optimiert. Bitte öffne diese Seite auf einem PC oder Mac.</p>
                </div>
            </div>

            <ConfirmDialog
                isOpen={confirmDeleteDialog.isOpen}
                title="Vorlage löschen"
                message="Möchten Sie diese Vorlage wirklich löschen? Sie ist dann für alle Benutzer entfernt."
                confirmLabel="Löschen"
                variant="danger"
                onConfirm={() => {
                    if (confirmDeleteDialog.presetId) deletePreset(confirmDeleteDialog.presetId, true);
                }}
                onCancel={() => setConfirmDeleteDialog({ isOpen: false, presetId: null })}
            />
        </div>
    );
};

export default AdvancedAnalysisPage;
