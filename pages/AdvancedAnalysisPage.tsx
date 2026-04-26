import React, { useState, useEffect, useMemo } from 'react';
import { useOfficeService, getLocalISOString, getDailyTargetForDate, useDepartments } from '../services/dataService';
import { supabase } from '../services/supabaseClient';
import { GlassCard, GlassButton, GlassInput } from '../components/GlassCard';
import { Filter, Save, FileDown, PieChart, BarChart3, Users, CheckSquare, Square, Calculator, Coins, Trash2, FileText, Layers, Briefcase, ChevronDown, ChevronRight } from 'lucide-react';
import GlassDatePicker from '../components/GlassDatePicker';
import { TimeEntry, UserAbsence } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';

interface AnalysisStats {
    userId: string;
    displayName: string;
    totalHours: number;
    targetHours: number;
    billableHours: number; 
    overheadHours: number; 
    absenceHours: number;
    breakHours: number;
    surchargeHours: number;
    efficiency: number; 
    costEstimate: number;
    typeBreakdown: Record<string, number>;
    initialBalance: number; // Übertrag / Startsaldo
    accountBalance: number; // Aktuelles Überstundenkonto inkl. Historie
}

interface OrderStats {
    orderNumber: string;
    totalHours: number;
    billableHours: number;
    surchargeHours: number;
    costEstimate: number;
    usersCount: number;
    userIds: Set<string>;
    entries: TimeEntry[];
}

interface FilterPreset {
    id: string;
    name: string;
    filters: {
        startDate: string;
        endDate: string;
        selectedUserIds: string[];
        selectedTypes: string[];
        selectedDepartments?: string[];
        viewMode?: 'user' | 'order';
    }
}

const TYPE_LABELS: Record<string, string> = {
    work: 'Arbeit / Projekt',
    company: 'Firma',
    office: 'Büro',
    warehouse: 'Lager',
    car: 'Auto / Fahrt',
    break: 'Pause',
    vacation: 'Urlaub',
    sick: 'Krank',
    sick_child: 'Kind krank',
    sick_pay: 'Krankengeld',
    holiday: 'Feiertag',
    special_holiday: 'Sonderurlaub',
    emergency_service: 'Notdienst',
    overtime_reduction: 'Gutstunden',
    unpaid: 'Unbezahlt'
};

const TYPE_GROUPS = {
    'Arbeitszeit': ['work', 'company', 'office', 'warehouse', 'car'],
    'Abwesenheiten': ['vacation', 'sick', 'sick_child', 'sick_pay', 'holiday', 'special_holiday', 'unpaid', 'overtime_reduction'],
    'Sonstiges': ['break', 'emergency_service']
};

const AdvancedAnalysisPage: React.FC = () => {
    const { showToast } = useToast();
    const { users, fetchAllUsers } = useOfficeService();
    const { departments, fetchDepartments } = useDepartments();

    // --- STATE ---
    const [viewMode, setViewMode] = useState<'user' | 'order'>('user');

    const [startDate, setStartDate] = useState(() => {
        const d = new Date(); d.setDate(1); return getLocalISOString(d); 
    });
    const [endDate, setEndDate] = useState(getLocalISOString());
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
    const [selectedTypes, setSelectedTypes] = useState<string[]>(Object.keys(TYPE_LABELS));

    const [showStartPicker, setShowStartPicker] = useState(false);
    const [showEndPicker, setShowEndPicker] = useState(false);
    const [hourlyRate, setHourlyRate] = useState<number>(35.00); 
    const [userRates, setUserRates] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(false);
    const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
    const [orderSearchQuery, setOrderSearchQuery] = useState('');

    const [rawData, setRawData] = useState<{ 
        entries: TimeEntry[], 
        absences: UserAbsence[],
        manualAdjustments: any[] 
    }>({ entries: [], absences: [], manualAdjustments: [] });

    const [presets, setPresets] = useState<FilterPreset[]>([]);
    const [presetName, setPresetName] = useState('');
    const [confirmDeleteDialog, setConfirmDeleteDialog] = useState<{ isOpen: boolean, presetId: string | null }>({ isOpen: false, presetId: null });

    // --- INITIALIZATION ---
    useEffect(() => {
        fetchAllUsers();
        fetchDepartments();
        fetchPresets();

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

    useEffect(() => {
        if (users.length > 0 && selectedUserIds.length === 0) {
            setSelectedUserIds(users.map(u => u.user_id!));
        }
    }, [users]);

    // --- DATA FETCHING ---
    const fetchData = async () => {
        setLoading(true);

        // Wir laden ALLE Daten bis zum gewählten Ende, um den Überstunden-Stand (Saldo) 
        // korrekt inkl. Historie berechnen zu können.
        const { data: entriesData, error: entError } = await supabase
            .from('time_entries')
            .select('*')
            .lte('date', endDate)
            .eq('is_deleted', false);

        const { data: absData, error: absError } = await supabase
            .from('user_absences')
            .select('*')
            .lte('start_date', endDate)
            .eq('is_deleted', false);

        const { data: balData, error: balError } = await supabase
            .from('overtime_balance_entries')
            .select('*');

        if (entError || absError || balError) {
            console.error(entError, absError, balError);
            showToast("Fehler beim Laden der Daten.", "error");
        } else {
            setRawData({
                entries: entriesData as TimeEntry[],
                absences: absData as UserAbsence[],
                manualAdjustments: balData || []
            });
        }
        setLoading(false);
    };

    useEffect(() => {
        if (startDate && endDate) fetchData();
    }, [startDate, endDate]);


    // --- CALCULATION ENGINE (USER MODE) ---
    const stats: AnalysisStats[] = useMemo(() => {
        if (!rawData.entries || viewMode !== 'user') return [];

        const periodStart = new Date(startDate);
        const periodEnd = new Date(endDate);

        return selectedUserIds.map(uid => {
            const user = users.find(u => u.user_id === uid);
            if (!user) return null;

            const initialBalance = Number(user.initial_overtime_balance) || 0;
            const manualBalanceTotal = rawData.manualAdjustments
                .filter(m => m.user_id === uid)
                .reduce((sum, m) => sum + (Number(m.hours) || 0), 0);

            const employmentStartStr = user.employment_start_date || '2026-01-01'; // Fallback
            const employmentStart = new Date(employmentStartStr);

            const userEntries = rawData.entries.filter(e => e.user_id === uid);
            const userAbsences = rawData.absences.filter(a => a.user_id === uid);

            // Stat-Sammler
            let periodSoll = 0;
            let periodIst = 0;
            let periodSurcharges = 0;
            let billableHours = 0;
            let overheadHours = 0;
            let breakHours = 0;
            let typeBreakdown: Record<string, number> = {};
            Object.keys(TYPE_LABELS).forEach(t => typeBreakdown[t] = 0);

            // History-Sammler (für Konto-Stand)
            let historySoll = 0;
            let historyIst = 0;

            // 1. ITERIERE ÜBER GESAMTE HISTORIE (von Eintritt bis Ende-Zeitraum)
            // Dies berechnet den absolut exakten Kontostand inkl. aller Gutschriften
            let curr = new Date(employmentStart);
            const calcEnd = new Date(periodEnd);

            while (curr <= calcEnd) {
                const dStr = getLocalISOString(curr);
                const dayTarget = getDailyTargetForDate(dStr, user.target_hours);
                
                const isInPeriod = curr >= periodStart && curr <= periodEnd;

                if (isInPeriod) periodSoll += dayTarget;
                historySoll += dayTarget;

                const dayEntries = userEntries.filter(e => e.date === dStr);
                const dayAbsRecord = userAbsences.find(a => dStr >= a.start_date && dStr <= a.end_date);
                const processedAbsTypes = new Set<string>();

                // Zeiteinträge verarbeiten
                dayEntries.forEach(e => {
                    const type = e.type || 'work';
                    const duration = Number(e.hours) || 0;
                    const surHours = (duration * (e.surcharge || 0)) / 100;

                    // Abwesenheiten (Urlaub, Krank etc.)
                    if (['vacation', 'sick', 'holiday', 'special_holiday', 'sick_child', 'sick_pay', 'unpaid', 'overtime_reduction'].includes(type)) {
                        if (!processedAbsTypes.has(type)) {
                            if (dayTarget > 0) {
                                if (isInPeriod) typeBreakdown[type] += dayTarget;
                                // Nur bezahlte Abwesenheiten zählen als Ist
                                if (type !== 'unpaid' && type !== 'overtime_reduction') {
                                    if (isInPeriod) periodIst += dayTarget;
                                    historyIst += dayTarget;
                                }
                                processedAbsTypes.add(type);
                            }
                        }
                    } else if (type === 'break') {
                        if (isInPeriod) {
                            typeBreakdown[type] += duration;
                            breakHours += duration;
                        }
                    } else {
                        // Arbeit / Fahrt / Büro etc.
                        if (isInPeriod) {
                            typeBreakdown[type] += duration;
                            const effective = (type === 'emergency_service') ? (duration + surHours) : duration;
                            periodIst += effective;
                            periodSurcharges += surHours;

                            if (type === 'work' || type === 'emergency_service') {
                                billableHours += effective;
                            } else {
                                overheadHours += effective;
                            }
                        }
                        
                        // History immer (inkl. Zuschlag bei Notdienst)
                        const histEffective = (type === 'emergency_service') ? (duration + surHours) : duration;
                        historyIst += histEffective;
                    }
                });

                // Abwesenheits-Zeitraum (Tabelle) prüfen
                if (dayAbsRecord && dayTarget > 0) {
                    const type = dayAbsRecord.type;
                    if (!processedAbsTypes.has(type)) {
                        if (isInPeriod) typeBreakdown[type] += dayTarget;
                        if ((type as string) !== 'unpaid') {
                            if (isInPeriod) periodIst += dayTarget;
                            historyIst += dayTarget;
                        }
                        processedAbsTypes.add(type);
                    }
                }

                curr.setDate(curr.getDate() + 1);
            }

            const totalPresence = billableHours + overheadHours;
            const efficiency = totalPresence > 0 ? (billableHours / totalPresence) * 100 : 0;
            const userRate = userRates[uid] || hourlyRate;
            const cost = (periodIst) * userRate; 

            return {
                userId: uid,
                displayName: user.display_name,
                totalHours: periodIst,
                targetHours: periodSoll,
                billableHours,
                overheadHours,
                absenceHours: periodIst - totalPresence,
                breakHours,
                surchargeHours: periodSurcharges,
                efficiency,
                costEstimate: cost,
                typeBreakdown,
                initialBalance,
                accountBalance: (historyIst - historySoll) + initialBalance + manualBalanceTotal
            };
        }).filter(Boolean) as AnalysisStats[];

    }, [rawData, selectedUserIds, selectedTypes, users, startDate, endDate, hourlyRate, viewMode, userRates]);

    // --- CALCULATION ENGINE (ORDER MODE) ---
    const orderStats: OrderStats[] = useMemo(() => {
        if (!rawData.entries || viewMode !== 'order') return [];
        
        const map = new Map<string, OrderStats>();
        
        rawData.entries.forEach(e => {
             if (!selectedUserIds.includes(e.user_id)) return;
             if (!selectedTypes.includes(e.type || 'work')) return;
             
             const order = e.order_number?.trim() || 'Ohne Auftrag';
             if (!map.has(order)) {
                 map.set(order, { orderNumber: order, totalHours: 0, billableHours: 0, surchargeHours: 0, costEstimate: 0, usersCount: 0, userIds: new Set(), entries: [] });
             }
             
             const s = map.get(order)!;
             const duration = Number(e.hours) || 0;
             const sur = (duration * (e.surcharge || 0)) / 100;
             const effective = (e.type === 'emergency_service') ? (duration + sur) : duration;

             s.totalHours += effective;
             if (e.type === 'work' || e.type === 'emergency_service') s.billableHours += effective;
             s.surchargeHours += sur;
             
             const userRate = userRates[e.user_id] || hourlyRate;
             s.costEstimate += (effective) * userRate;
             s.userIds.add(e.user_id);
             s.usersCount = s.userIds.size;
             s.entries.push(e);
        });
        
        return Array.from(map.values()).sort((a,b) => b.totalHours - a.totalHours); 
    }, [rawData, selectedUserIds, selectedTypes, viewMode, hourlyRate, userRates]);


    const filteredOrderStats = useMemo(() => {
        if (!orderSearchQuery) return orderStats;
        const query = orderSearchQuery.toLowerCase();
        return orderStats.filter(s => {
            const hasOrderMatch = s.orderNumber.toLowerCase().includes(query);
            const hasProjectMatch = s.entries.some(e => (e.client_name || '').toLowerCase().includes(query) || (e.note || '').toLowerCase().includes(query));
            return hasOrderMatch || hasProjectMatch;
        });
    }, [orderStats, orderSearchQuery]);

    // Aggregierte Gesamtwerte
    const totals = useMemo(() => {
        if (viewMode === 'user') {
            return stats.reduce((acc, curr) => ({
                billable: acc.billable + curr.billableHours,
                overhead: acc.overhead + curr.overheadHours,
                total: acc.total + curr.totalHours,
                surcharge: acc.surcharge + curr.surchargeHours,
                cost: acc.cost + curr.costEstimate,
                company: acc.company + (curr.typeBreakdown['company'] || 0),
                office: acc.office + (curr.typeBreakdown['office'] || 0),
                warehouse: acc.warehouse + (curr.typeBreakdown['warehouse'] || 0),
                car: acc.car + (curr.typeBreakdown['car'] || 0)
            }), { billable: 0, overhead: 0, total: 0, surcharge: 0, cost: 0, company: 0, office: 0, warehouse: 0, car: 0 });
        } else {
            return filteredOrderStats.reduce((acc, curr) => {
                let company = 0;
                let office = 0;
                let warehouse = 0;
                let car = 0;
                curr.entries.forEach(e => {
                    if (e.type === 'company') company += e.hours;
                    if (e.type === 'office') office += e.hours;
                    if (e.type === 'warehouse') warehouse += e.hours;
                    if (e.type === 'car') car += e.hours;
                });
                return {
                    billable: acc.billable + curr.billableHours,
                    overhead: acc.overhead + (curr.totalHours - curr.billableHours),
                    total: acc.total + curr.totalHours,
                    surcharge: acc.surcharge + curr.surchargeHours,
                    cost: acc.cost + curr.costEstimate,
                    company: acc.company + company,
                    office: acc.office + office,
                    warehouse: acc.warehouse + warehouse,
                    car: acc.car + car
                };
            }, { billable: 0, overhead: 0, total: 0, surcharge: 0, cost: 0, company: 0, office: 0, warehouse: 0, car: 0 });
        }
    }, [stats, filteredOrderStats, viewMode]);

    const filteredUsersForList = useMemo(() => {
        let u = users;
        if (selectedDepartments.length > 0) {
            u = u.filter(user => user.department_id && selectedDepartments.includes(user.department_id));
        }
        return u;
    }, [users, selectedDepartments]);

    // --- HANDLERS ---
    const toggleUser = (id: string) => {
        setSelectedUserIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleDepartment = (id: string) => {
        setSelectedDepartments(prev => {
            const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
            const usersInDeps = users.filter(u => u.department_id && next.includes(u.department_id)).map(u => u.user_id!);
            if (next.length > 0) {
                setSelectedUserIds(usersInDeps);
            } else {
                setSelectedUserIds(users.map(u => u.user_id!));
            }
            return next;
        });
    };

    const toggleType = (type: string) => {
        setSelectedTypes(prev => prev.includes(type) ? prev.filter(x => x !== type) : [...prev, type]);
    };

    const toggleTypeGroup = (groupName: keyof typeof TYPE_GROUPS) => {
        const typesInGroup = TYPE_GROUPS[groupName];
        const allSelected = typesInGroup.every(t => selectedTypes.includes(t));
        
        if (allSelected) {
            setSelectedTypes(prev => prev.filter(t => !typesInGroup.includes(t)));
        } else {
            setSelectedTypes(prev => Array.from(new Set([...prev, ...typesInGroup])));
        }
    };

    const savePreset = async () => {
        if (!presetName) return showToast("Bitte Namen eingeben", "warning");

        const filters = { startDate, endDate, selectedUserIds, selectedTypes, selectedDepartments, viewMode };

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
        if (preset.filters.selectedDepartments) setSelectedDepartments(preset.filters.selectedDepartments);
        if (preset.filters.viewMode) setViewMode(preset.filters.viewMode);
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
        let header = [];
        let rows = [];

        if (viewMode === 'user') {
            const dynamicHeaders = selectedTypes.map(t => `${TYPE_LABELS[t] || t} (h)`);
            header = ["Mitarbeiter", "Soll (h)", "Ist (Gesamt h)", ...dynamicHeaders, "Zuschläge (h)", "Effizienz (%)", "Kosten (EUR)"];
            rows = stats.map(s => {
                const dynamicVals = selectedTypes.map(t => (s.typeBreakdown[t] || 0).toFixed(2));
                return [
                    s.displayName,
                    s.targetHours.toFixed(2),
                    s.totalHours.toFixed(2),
                    ...dynamicVals,
                    s.surchargeHours.toFixed(2),
                    s.efficiency.toFixed(1) + '%',
                    s.costEstimate.toFixed(2)
                ];
            });
        } else {
            header = ["Auftrag", "Gesamtstunden (h)", "Verrechenbar (h)", "Zuschläge (h)", "Mitarbeiter (Anzahl)", "Kosten (EUR)"];
            rows = orderStats.map(s => [
                s.orderNumber,
                s.totalHours.toFixed(2),
                s.billableHours.toFixed(2),
                s.surchargeHours.toFixed(2),
                s.usersCount.toString(),
                s.costEstimate.toFixed(2)
            ]);
        }

        const csvContent = "data:text/csv;charset=utf-8,"
            + header.join(";") + "\n"
            + rows.map(e => e.join(";")).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `auswertung_${viewMode}_${startDate}_${endDate}.csv`);
        document.body.appendChild(link);
        link.click();
    };

    const generatePDF = () => {
        const doc = new jsPDF('l', 'mm', 'a4'); 

        doc.setFontSize(18);
        doc.setFont("helvetica", "bold");
        doc.text(`Detaillierte Auswertung: ${viewMode === 'user' ? 'Mitarbeiter' : 'Aufträge'}`, 14, 20);

        doc.setFontSize(11);
        doc.setFont("helvetica", "normal");
        doc.text(`Zeitraum: ${new Date(startDate).toLocaleDateString('de-DE')} bis ${new Date(endDate).toLocaleDateString('de-DE')}`, 14, 28);
        doc.text(`Erstellt am: ${new Date().toLocaleDateString('de-DE')}`, 14, 34);

        doc.setDrawColor(20, 184, 166);
        doc.setLineWidth(0.5);
        doc.rect(200, 15, 80, 25);
        doc.setFontSize(10);
        doc.text("Gesamtstunden:", 205, 22);
        doc.text(totals.total.toFixed(2) + " h", 275, 22, { align: 'right' });
        doc.text("Davon Verrechenbar:", 205, 28);
        doc.text(totals.billable.toFixed(2) + " h", 275, 28, { align: 'right' });
        doc.text("Kostenschätzung:", 205, 34);
        doc.text(totals.cost.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }), 275, 34, { align: 'right' });

        if (viewMode === 'user') {
            const dynamicHeaders = selectedTypes.map(t => `${TYPE_LABELS[t] || t} (h)`);
            const tableBody = stats.map(s => {
                const dynamicVals = selectedTypes.map(t => (s.typeBreakdown[t] || 0).toFixed(2));
                return [
                    s.displayName,
                    s.targetHours.toFixed(2),
                    s.totalHours.toFixed(2),
                    ...dynamicVals,
                    s.surchargeHours.toFixed(2),
                    s.efficiency.toFixed(1) + '%',
                    s.costEstimate.toFixed(0) + ' €'
                ];
            });

            autoTable(doc, {
                startY: 45,
                head: [['Mitarbeiter', 'Soll (h)', 'Ist (h)', ...dynamicHeaders, 'Zuschlag (h)', 'Quote', 'Kosten']],
                body: tableBody,
                theme: 'grid',
                headStyles: { fillColor: [20, 184, 166], textColor: [255, 255, 255], fontStyle: 'bold' },
                styles: { fontSize: 8 },
                columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' }, 2: { halign: 'right', fontStyle: 'bold' } },
                foot: [['GESAMT', '-', totals.total.toFixed(2), ...selectedTypes.map(() => '-'), totals.surcharge.toFixed(2), ((totals.billable / (totals.billable + totals.overhead || 1)) * 100).toFixed(1) + '%', totals.cost.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })]],
                footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'right' }
            });
        } else {
            const tableBody = orderStats.map(s => [
                s.orderNumber,
                s.totalHours.toFixed(2),
                s.billableHours.toFixed(2),
                s.surchargeHours.toFixed(2),
                s.usersCount.toString(),
                s.costEstimate.toFixed(0) + ' €'
            ]);

            autoTable(doc, {
                startY: 45,
                head: [['Auftrag', 'Gesamt (h)', 'Verrechenbar (h)', 'Zuschlag (h)', 'Mitarbeiter (Anz.)', 'Kosten']],
                body: tableBody,
                theme: 'grid',
                headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255], fontStyle: 'bold' },
                columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right', fontStyle: 'bold' }, 2: { halign: 'right', textColor: [20, 184, 166] }, 3: { halign: 'right' }, 4: { halign: 'center' }, 5: { halign: 'right' } },
                foot: [['GESAMT', totals.total.toFixed(2), totals.billable.toFixed(2), totals.surcharge.toFixed(2), '-', totals.cost.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })]],
                footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'right' }
            });
        }

        doc.save(`profi_auswertung_${viewMode}_${startDate}_${endDate}.pdf`);
    };

    // --- RENDER ---
    return (
        <div className="hidden md:flex flex-row h-full w-full bg-background text-foreground overflow-hidden">
            {/* SIDEBAR: FILTER & PRESETS */}
            <div className="w-80 flex-shrink-0 border-r border-border bg-card p-6 overflow-y-auto flex flex-col gap-8 custom-scrollbar">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2 mb-6 text-purple-300">
                        <Filter size={24} /> Filter
                    </h2>

                    <div className="space-y-4 mb-6">
                        <div>
                            <label className="text-xs uppercase font-bold text-muted-foreground mb-1 block">Zeitraum Start</label>
                            <GlassInput 
                                value={new Date(startDate).toLocaleDateString('de-DE')} 
                                readOnly 
                                onClick={() => setShowStartPicker(true)} 
                                className="cursor-pointer text-sm" 
                            />
                        </div>
                        <div>
                            <label className="text-xs uppercase font-bold text-muted-foreground mb-1 block">Zeitraum Ende</label>
                            <GlassInput 
                                value={new Date(endDate).toLocaleDateString('de-DE')} 
                                readOnly 
                                onClick={() => setShowEndPicker(true)} 
                                className="cursor-pointer text-sm" 
                            />
                        </div>
                        <div className="flex gap-2 mt-2">
                            <button 
                                onClick={() => {
                                    const year = new Date().getFullYear();
                                    setStartDate(`${year}-01-01`);
                                    setEndDate(`${year}-12-31`);
                                }}
                                className="flex-1 bg-muted hover:bg-card text-muted-foreground text-[10px] font-bold py-1.5 rounded transition-colors"
                            >
                                Aktuelles Jahr
                            </button>
                            <button 
                                onClick={() => {
                                    const year = new Date().getFullYear() - 1;
                                    setStartDate(`${year}-01-01`);
                                    setEndDate(`${year}-12-31`);
                                }}
                                className="flex-1 bg-muted hover:bg-card text-muted-foreground text-[10px] font-bold py-1.5 rounded transition-colors"
                            >
                                Letztes Jahr
                            </button>
                        </div>
                    </div>

                    {/* Departments Filter */}
                    {departments.length > 0 && (
                        <div className="mb-6">
                            <label className="text-xs uppercase font-bold text-muted-foreground mb-2 block">Abteilungen</label>
                            <div className="flex flex-wrap gap-2">
                                {departments.map(d => (
                                    <button
                                        key={d.id}
                                        onClick={() => toggleDepartment(d.id)}
                                        className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${selectedDepartments.includes(d.id) ? 'bg-blue-500/20 text-blue-200 border border-blue-500/50' : 'bg-muted text-muted-foreground border border-transparent hover:bg-card'}`}
                                    >
                                        {d.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Entry Types */}
                    <div className="mb-6">
                        <label className="text-xs uppercase font-bold text-muted-foreground mb-2 block">Kategorien</label>
                        <div className="space-y-4">
                            {(Object.keys(TYPE_GROUPS) as Array<keyof typeof TYPE_GROUPS>).map(group => (
                                <div key={group}>
                                    <button 
                                        onClick={() => toggleTypeGroup(group)}
                                        className="text-[10px] uppercase font-bold text-muted-foreground mb-1 flex items-center gap-2 hover:text-foreground transition-colors w-full text-left"
                                    >
                                        {TYPE_GROUPS[group].every(t => selectedTypes.includes(t)) ? <CheckSquare size={12}/> : <Square size={12}/>}
                                        {group}
                                    </button>
                                    <div className="grid grid-cols-2 gap-1">
                                        {TYPE_GROUPS[group].map(type => (
                                            <button
                                                key={type}
                                                onClick={() => toggleType(type)}
                                                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[10px] font-bold transition-all ${selectedTypes.includes(type) ? 'bg-teal-500/20 text-teal-200 border border-teal-500/30' : 'bg-muted text-muted-foreground border border-transparent hover:bg-card'}`}
                                            >
                                                <div className="truncate">{TYPE_LABELS[type] || type}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Cost Config */}
                    <div className="mb-6">
                        <label className="text-xs uppercase font-bold text-muted-foreground mb-1 flex items-center gap-1"><Coins size={12} /> Kostensatz (EUR/h)</label>
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
                        <label className="text-xs uppercase font-bold text-muted-foreground">Mitarbeiter ({filteredUsersForList.length})</label>
                        <button onClick={() => setSelectedUserIds(selectedUserIds.length === filteredUsersForList.length ? [] : filteredUsersForList.map(u => u.user_id!))} className="text-[10px] text-teal-400 hover:underline">
                            {selectedUserIds.length === filteredUsersForList.length ? 'Keine' : 'Alle'}
                        </button>
                    </div>
                    <div className="max-h-60 overflow-y-auto space-y-1 pr-2 custom-scrollbar">
                        {filteredUsersForList.map(u => (
                            <div
                                key={u.user_id}
                                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedUserIds.includes(u.user_id!) ? 'bg-purple-500/20 text-purple-200 border border-purple-500/30' : 'bg-muted text-muted-foreground border border-transparent hover:bg-card'}`}
                            >
                                <button
                                    onClick={() => toggleUser(u.user_id!)}
                                    className="flex-1 flex items-center justify-start text-left truncate"
                                >
                                    <span className="truncate mr-2">{u.display_name}</span>
                                    {selectedUserIds.includes(u.user_id!) && <CheckSquare size={12} className="flex-shrink-0" />}
                                </button>
                                {selectedUserIds.includes(u.user_id!) && (
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={userRates[u.user_id!] || ''}
                                            placeholder={hourlyRate.toFixed(2)}
                                            onChange={(e) => setUserRates(prev => ({ ...prev, [u.user_id!]: parseFloat(e.target.value) || 0 }))}
                                            className="w-14 bg-input border border-border rounded px-1 py-0.5 text-right text-[10px] text-foreground focus:border-teal-500 outline-none"
                                            title="Individueller Kostensatz (€/h)"
                                        />
                                        <span className="text-[10px] text-muted-foreground">€</span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Presets */}
                <div className="border-t border-border pt-4 pb-6">
                    <label className="text-xs uppercase font-bold text-muted-foreground mb-2 block">Vorlagen (Geteilt)</label>
                    <div className="flex gap-2 mb-2">
                        <GlassInput
                            placeholder="Name..."
                            value={presetName}
                            onChange={e => setPresetName(e.target.value)}
                            className="!py-1 !px-2 !text-xs h-8"
                        />
                        <button onClick={savePreset} className="p-2 bg-teal-500 rounded text-foreground hover:bg-teal-400"><Save size={14} /></button>
                    </div>
                    <div className="space-y-1">
                        {presets.length === 0 && <p className="text-[10px] text-muted-foreground italic">Keine Vorlagen gespeichert.</p>}
                        {presets.map(p => (
                            <div key={p.id} className="flex justify-between items-center bg-muted px-2 py-1 rounded text-xs group hover:bg-card transition-colors">
                                <button onClick={() => loadPreset(p)} className="flex-1 text-left text-muted-foreground hover:text-foreground truncate">{p.name}</button>
                                <button onClick={() => deletePreset(p.id)} className="text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 p-1"><Trash2 size={12} /></button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* MAIN CONTENT */}
            <div className="flex-1 flex flex-col overflow-hidden relative">
                <div className="p-6 pb-0 flex flex-col gap-4">
                    <div className="flex justify-between items-start">
                        <div>
                            <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
                                <PieChart className="text-purple-400" /> Profi-Auswertung
                            </h1>
                            <p className="text-muted-foreground text-sm mt-1">
                                {new Date(startDate).toLocaleDateString()} - {new Date(endDate).toLocaleDateString()}
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

                    {/* View Toggles & Search */}
                    <div className="flex items-center gap-4">
                        <div className="flex p-1 bg-input rounded-lg w-max border border-border">
                            <button 
                                onClick={() => setViewMode('user')}
                                className={`flex items-center gap-2 px-6 py-2 rounded-md text-sm font-bold transition-all ${viewMode === 'user' ? 'bg-card text-foreground shadow-lg' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                <Users size={16} /> Mitarbeiter-Sicht
                            </button>
                            <button 
                                onClick={() => setViewMode('order')}
                                className={`flex items-center gap-2 px-6 py-2 rounded-md text-sm font-bold transition-all ${viewMode === 'order' ? 'bg-card text-foreground shadow-lg' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                <Briefcase size={16} /> Auftrags-Sicht
                            </button>
                        </div>

                        {viewMode === 'order' && (
                            <div className="flex-1 max-w-sm">
                                <input
                                    type="text"
                                    placeholder="Suche Auftrag oder Notiz..."
                                    value={orderSearchQuery}
                                    onChange={(e) => setOrderSearchQuery(e.target.value)}
                                    className="w-full bg-input border border-border rounded-lg px-4 py-2 text-sm text-foreground focus:border-blue-500 outline-none transition-colors placeholder:text-muted-foreground"
                                />
                            </div>
                        )}
                    </div>
                </div>

                {loading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : (
                    <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
                        {/* KPI CARDS */}
                        <div className="grid grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
                            <GlassCard className="col-span-2 bg-emerald-900/10 border-emerald-500/20">
                                <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2">Stunden Gesamt</div>
                                <div className="text-3xl font-mono font-bold text-foreground">{totals.total.toFixed(2)} <span className="text-sm text-muted-foreground">h</span></div>
                                <div className="text-[10px] text-muted-foreground mt-1">Alle Kategorien</div>
                            </GlassCard>

                            <GlassCard className="col-span-2 bg-blue-900/10 border-blue-500/20">
                                <div className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">Projekt</div>
                                <div className="text-3xl font-mono font-bold text-foreground">{totals.billable.toFixed(2)} <span className="text-sm text-muted-foreground">h</span></div>
                                <div className="text-[10px] text-muted-foreground mt-1">Verrechenbar</div>
                            </GlassCard>

                            <GlassCard className="col-span-2 bg-orange-900/10 border-orange-500/20">
                                <div className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-2">Zuschläge</div>
                                <div className="text-3xl font-mono font-bold text-foreground">{totals.surcharge.toFixed(2)} <span className="text-sm text-muted-foreground">h</span></div>
                                <div className="text-[10px] text-muted-foreground mt-1">Generiert</div>
                            </GlassCard>

                            <GlassCard className="col-span-2 bg-card border-border relative overflow-hidden">
                                <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Kosten</div>
                                <div className="text-3xl font-mono font-bold text-foreground">{totals.cost.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                                <div className="text-[10px] text-muted-foreground mt-1">Schätzung inkl. Zuschlag</div>
                                <Calculator className="absolute -bottom-2 -right-2 text-foreground/5 w-16 h-16" />
                            </GlassCard>

                            {/* Secondary Row of KPIs for generic times */}
                            <GlassCard className="col-span-2 xl:col-span-2 bg-indigo-900/10 border-indigo-500/20 !p-3">
                                <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-1">Firma</div>
                                <div className="text-xl font-mono font-bold text-foreground">{totals.company.toFixed(2)} <span className="text-xs text-muted-foreground">h</span></div>
                            </GlassCard>

                            <GlassCard className="col-span-2 xl:col-span-2 bg-purple-900/10 border-purple-500/20 !p-3">
                                <div className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-1">Büro</div>
                                <div className="text-xl font-mono font-bold text-foreground">{totals.office.toFixed(2)} <span className="text-xs text-muted-foreground">h</span></div>
                            </GlassCard>

                            <GlassCard className="col-span-2 xl:col-span-2 bg-amber-900/10 border-amber-500/20 !p-3">
                                <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">Lager</div>
                                <div className="text-xl font-mono font-bold text-foreground">{totals.warehouse.toFixed(2)} <span className="text-xs text-muted-foreground">h</span></div>
                            </GlassCard>

                            <GlassCard className="col-span-2 xl:col-span-2 bg-rose-900/10 border-rose-500/20 !p-3">
                                <div className="text-[10px] font-bold text-rose-400 uppercase tracking-wider mb-1">Auto / Fahrt</div>
                                <div className="text-xl font-mono font-bold text-foreground">{totals.car.toFixed(2)} <span className="text-xs text-muted-foreground">h</span></div>
                            </GlassCard>
                        </div>

                        {/* DATA TABLE */}
                        <GlassCard className="overflow-hidden !p-0">
                            {viewMode === 'user' ? (
                                <div className="max-h-[500px] overflow-y-auto overflow-x-auto custom-scrollbar">
                                    <table className="w-full text-left text-sm text-muted-foreground relative">
                                        <thead className="bg-card text-foreground font-bold uppercase text-xs sticky top-0 z-10 shadow-md">
                                            <tr>
                                                <th className="p-4 border-b border-border whitespace-nowrap">Mitarbeiter</th>
                                                <th className="p-4 text-right opacity-50 border-b border-border whitespace-nowrap">Soll (h)</th>
                                                <th className="p-4 text-right border-b border-border whitespace-nowrap text-emerald-300">Gesamt (h)</th>
                                                <th className="p-4 text-right border-b border-border whitespace-nowrap text-blue-300">Saldo (h)</th>
                                                <th className="p-4 text-right border-b border-border whitespace-nowrap text-yellow-300" title="Konto-Stand inkl. Übertrag und gesamter Historie">Überstundenkonto</th>
                                                {selectedTypes.map(t => (
                                                    <th key={t} className="p-4 text-right text-muted-foreground border-b border-border whitespace-nowrap">
                                                        {TYPE_LABELS[t] || t}
                                                    </th>
                                                ))}
                                                <th className="p-4 text-right text-orange-300 border-b border-border whitespace-nowrap">Zuschlag (h)</th>
                                                <th className="p-4 text-right border-b border-border whitespace-nowrap">Quote</th>
                                                <th className="p-4 text-right border-b border-border whitespace-nowrap">Kosten</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {stats.map(s => (
                                                <tr key={s.userId} className="hover:bg-muted transition-colors">
                                                    <td className="p-4 font-bold text-foreground whitespace-nowrap">{s.displayName}</td>
                                                    <td className="p-4 text-right font-mono opacity-50">{s.targetHours.toFixed(2)}</td>
                                                    <td className="p-4 text-right font-mono font-bold text-emerald-100">{s.totalHours.toFixed(2)}</td>
                                                    <td className={`p-4 text-right font-mono font-bold ${(s.totalHours - s.targetHours) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                        {(s.totalHours - s.targetHours) >= 0 ? '+' : ''}{(s.totalHours - s.targetHours).toFixed(2)}
                                                    </td>
                                                    <td className={`p-4 text-right font-mono font-bold ${s.accountBalance >= 0 ? 'text-yellow-400' : 'text-rose-500'}`}>
                                                        {s.accountBalance >= 0 ? '+' : ''}{s.accountBalance.toFixed(2)}
                                                    </td>
                                                    {selectedTypes.map(t => {
                                                        const val = s.typeBreakdown[t] || 0;
                                                        return (
                                                            <td key={t} className="p-4 text-right font-mono text-gray-100">
                                                                {val > 0 ? val.toFixed(2) : '-'}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="p-4 text-right font-mono text-orange-200">
                                                        {s.surchargeHours > 0 ? `+${s.surchargeHours.toFixed(2)}` : '-'}
                                                    </td>
                                                    <td className="p-4 text-right font-mono font-bold">
                                                        <span className={`${s.efficiency > 75 ? 'text-emerald-400' : s.efficiency > 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                                                            {s.efficiency.toFixed(1)}%
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-right font-mono font-bold text-foreground">{s.costEstimate.toFixed(0)} €</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
                                    <table className="w-full text-left text-sm text-muted-foreground relative">
                                        <thead className="bg-card text-foreground font-bold uppercase text-xs sticky top-0 z-10 shadow-md">
                                            <tr>
                                                <th className="p-4 border-b border-border">Auftrag / Projekt</th>
                                                <th className="p-4 text-right text-foreground border-b border-border">Gesamt (h)</th>
                                                <th className="p-4 text-right text-emerald-300 border-b border-border">Verrechenbar (h)</th>
                                                <th className="p-4 text-right text-orange-300 border-b border-border">Zuschlag (h)</th>
                                                <th className="p-4 text-center text-blue-300 border-b border-border">Mitarbeiter</th>
                                                <th className="p-4 text-right border-b border-border">Kosten</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {filteredOrderStats.length === 0 ? (
                                                <tr>
                                                    <td colSpan={6} className="p-8 text-center text-muted-foreground italic">Keine Daten für die gewählten Filter.</td>
                                                </tr>
                                            ) : (
                                                filteredOrderStats.map(s => (
                                                    <React.Fragment key={s.orderNumber}>
                                                        <tr 
                                                            className="hover:bg-muted transition-colors cursor-pointer"
                                                            onClick={() => setExpandedOrder(expandedOrder === s.orderNumber ? null : s.orderNumber)}
                                                        >
                                                            <td className="p-4 font-bold text-foreground flex items-center gap-2">
                                                                {expandedOrder === s.orderNumber ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
                                                                <FileText size={16} className="text-blue-400" /> {s.orderNumber}
                                                            </td>
                                                            <td className="p-4 text-right font-mono text-foreground font-bold">{s.totalHours.toFixed(2)}</td>
                                                            <td className="p-4 text-right font-mono text-emerald-100">{s.billableHours.toFixed(2)}</td>
                                                            <td className="p-4 text-right font-mono text-orange-200">
                                                                {s.surchargeHours > 0 ? `+${s.surchargeHours.toFixed(2)}` : '-'}
                                                            </td>
                                                            <td className="p-4 text-center font-mono text-blue-200">
                                                                <div className="flex items-center justify-center gap-1">
                                                                    <Users size={12}/> {s.usersCount}
                                                                </div>
                                                            </td>
                                                            <td className="p-4 text-right font-mono font-bold text-foreground">{s.costEstimate.toFixed(0)} €</td>
                                                        </tr>
                                                        {expandedOrder === s.orderNumber && (
                                                            <tr>
                                                                <td colSpan={6} className="p-0 bg-input border-b border-border">
                                                                    <div className="p-4 pl-12 space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                                                                        {s.entries.map((entry, idx) => {
                                                                            const user = users.find(u => u.user_id === entry.user_id);
                                                                            return (
                                                                                <div key={idx} className="flex items-start justify-between text-xs text-muted-foreground bg-muted p-2 rounded border border-border">
                                                                                    <div className="flex flex-col gap-1 w-2/3">
                                                                                        <div className="flex items-center gap-2 font-bold text-foreground">
                                                                                            <span className="text-blue-300">{user?.display_name || 'Unbekannt'}</span>
                                                                                            <span className="text-muted-foreground">•</span>
                                                                                            <span>{new Date(entry.date).toLocaleDateString('de-DE')}</span>
                                                                                            <span className="text-muted-foreground">•</span>
                                                                                            <span className="text-[10px] uppercase text-emerald-300">{TYPE_LABELS[entry.type || 'work']}</span>
                                                                                        </div>
                                                                                        {entry.note ? (
                                                                                            <p className="text-muted-foreground italic">{entry.note}</p>
                                                                                        ) : (
                                                                                            <p className="text-muted-foreground italic">Keine Notiz</p>
                                                                                        )}
                                                                                    </div>
                                                                                    <div className="text-right flex flex-col items-end">
                                                                                        <span className="font-mono font-bold text-foreground">{entry.hours.toFixed(2)} h</span>
                                                                                        {entry.surcharge ? (
                                                                                            <span className="text-[10px] font-mono text-orange-300">+{entry.surcharge}% Zuschlag</span>
                                                                                        ) : null}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </GlassCard>
                    </div>
                )}

                {showStartPicker && <GlassDatePicker value={startDate} onChange={setStartDate} onClose={() => setShowStartPicker(false)} />}
                {showEndPicker && <GlassDatePicker value={endDate} onChange={setEndDate} onClose={() => setShowEndPicker(false)} />}
            </div>

            <div className="md:hidden fixed inset-0 bg-background z-[9999] flex items-center justify-center p-8 text-center">
                <div>
                    <div className="mx-auto w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center text-red-400 mb-4">
                        <BarChart3 size={32} />
                    </div>
                    <h2 className="text-xl font-bold text-foreground mb-2">Desktop-Funktion</h2>
                    <p className="text-muted-foreground">Die erweiterte Analyse ist für große Bildschirme optimiert. Bitte öffne diese Seite auf einem PC oder Mac.</p>
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