import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { GlassCard, GlassButton, GlassInput } from '../components/GlassCard';
import { 
    ChevronLeft, ChevronRight, Settings, PartyPopper, Users, Shield, 
    Save, RotateCcw, Check, Info, Bell, Building2, Database,
    Lock, Unlock, FileDown, CheckSquare, Square, Download, Loader2, Briefcase, ChevronDown, X, Clock, Plus, Trash2, Palmtree
} from 'lucide-react';
import { getBavarianHolidays, DEFAULT_HOLIDAY_CONFIG, Holiday } from '../services/utils/holidayUtils';
import { useToast } from '../components/Toast';
import { useOfficeService, useDepartments, getLocalISOString } from '../services/dataService';
import { DailyTarget } from '../types';
import { fetchExportData, generateProjectPdfBlob, generateAttendancePdfBlob, generateMonthlyReportPdfBlob } from '../services/pdfExportService';
import JSZip from 'jszip';

const CATEGORIES = [
    { id: 'holidays', name: 'Feiertage', icon: PartyPopper },
    { id: 'schoolHolidays', name: 'Ferien', icon: Palmtree },
    { id: 'monthClosing', name: 'Monatsabschluss', icon: Lock },
    { id: 'departments', name: 'Abteilungen', icon: Building2 },
    { id: 'export', name: 'Stunden-Export', icon: FileDown },
    { id: 'roles', name: 'Rollen & Rechte', icon: Shield },
];

// Bayerische Schulferien-Vorlagen
const SCHOOL_HOLIDAY_TEMPLATES = [
    { id: 'winterferien', name: 'Winterferien', icon: '🏔️' },
    { id: 'osterferien', name: 'Osterferien', icon: '🐣' },
    { id: 'pfingstferien', name: 'Pfingstferien', icon: '🌸' },
    { id: 'sommerferien', name: 'Sommerferien', icon: '☀️' },
    { id: 'herbstferien', name: 'Herbstferien', icon: '🍂' },
    { id: 'weihnachtsferien', name: 'Weihnachtsferien', icon: '🎄' },
] as const;

interface SchoolHolidayPeriod {
    start: string;
    end: string;
}
type YearHolidays = Record<string, SchoolHolidayPeriod>;
interface SchoolHolidayConfig {
    showInCalendar: boolean;
    holidays: Record<string, YearHolidays>;
}

const OfficeSettingsPage: React.FC = () => {
    const { showToast } = useToast();
    const navigate = useNavigate();
    const { users, fetchAllUsers, updateOfficeUserSettings } = useOfficeService();
    const { departments, fetchDepartments, updateDepartment } = useDepartments();
    
    const [activeCategory, setActiveCategory] = useState('holidays');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [viewYear, setViewYear] = useState(new Date().getFullYear());
    
    // --- HOLIDAY STATE ---
    const [holidayConfig, setHolidayConfig] = useState<Record<string, boolean>>(DEFAULT_HOLIDAY_CONFIG);
    const [holidayOverrides, setHolidayOverrides] = useState<Record<string, Record<string, string>>>({});

    // --- SCHOOL HOLIDAY STATE ---
    const [schoolHolidayConfig, setSchoolHolidayConfig] = useState<SchoolHolidayConfig>({ showInCalendar: true, holidays: {} });
    const [schoolHolidayDirty, setSchoolHolidayDirty] = useState(false);

    // --- MONTH CLOSING STATE ---
    const [closedMonths, setClosedMonths] = useState<string[]>([]);

    // --- EXPORT STATE ---
    const [selectedExportMonth, setSelectedExportMonth] = useState(new Date());
    const [selectedExportUsers, setSelectedExportUsers] = useState<string[]>([]);
    const [exportTypes, setExportTypes] = useState({ projects: true, attendance: true, monthly_report: true });
    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState('');

    useEffect(() => {
        const init = async () => {
            setLoading(true);
            try {
                // Fetch Users & Depts
                await Promise.all([fetchAllUsers(), fetchDepartments()]);

                // Fetch Global Config (Holidays)
                const { data: configData } = await supabase
                    .from('global_config')
                    .select('*')
                    .eq('id', 'holiday_config')
                    .maybeSingle();
                
                if (configData && configData.config) {
                    // Extrahiere die flache Config (id -> boolean), egal wie tief verschachtelt
                    let rawActive = configData.config.active || configData.config;
                    // Falls active nochmals ein active-Objekt enthält (doppelte Verschachtelung), die tiefste Ebene nehmen
                    while (rawActive.active && typeof rawActive.active === 'object' && !Array.isArray(rawActive.active)) {
                        rawActive = rawActive.active;
                    }
                    // Nur boolean-Werte übernehmen (alles andere ignorieren)
                    const cleanConfig: Record<string, boolean> = {};
                    for (const [key, value] of Object.entries(rawActive)) {
                        if (typeof value === 'boolean') {
                            cleanConfig[key] = value;
                        }
                    }
                    setHolidayConfig({ ...DEFAULT_HOLIDAY_CONFIG, ...cleanConfig });
                    setHolidayOverrides(configData.config.overrides || {});
                }

                // Fetch Closed Months
                const { data: closedData } = await supabase.from('closed_months').select('month');
                if (closedData) setClosedMonths(closedData.map(c => c.month));

                // Fetch School Holidays
                const { data: schoolHolidayData } = await supabase
                    .from('global_config')
                    .select('*')
                    .eq('id', 'school_holidays')
                    .maybeSingle();
                
                if (schoolHolidayData && schoolHolidayData.config) {
                    // Migriere altes Format (holidays Array) zu neuem Format (holidays Object pro Jahr)
                    if (Array.isArray(schoolHolidayData.config.holidays)) {
                        // Altes Format: [{id, name, startDate, endDate, year}]
                        const oldHolidays = schoolHolidayData.config.holidays;
                        const migrated: Record<string, YearHolidays> = {};
                        for (const h of oldHolidays) {
                            const year = h.year?.toString() || new Date(h.startDate).getFullYear().toString();
                            if (!migrated[year]) migrated[year] = {};
                            // Versuche den Namen auf eine Vorlage zu mappen
                            const template = SCHOOL_HOLIDAY_TEMPLATES.find(t => 
                                h.name.toLowerCase().includes(t.id.replace('ferien', '')) ||
                                t.name.toLowerCase().includes(h.name.toLowerCase().replace('ferien', ''))
                            );
                            if (template) {
                                migrated[year][template.id] = { start: h.startDate, end: h.endDate };
                            }
                        }
                        setSchoolHolidayConfig({
                            showInCalendar: schoolHolidayData.config.showInCalendar ?? true,
                            holidays: migrated
                        });
                    } else {
                        setSchoolHolidayConfig({
                            showInCalendar: schoolHolidayData.config.showInCalendar ?? true,
                            holidays: schoolHolidayData.config.holidays || {}
                        });
                    }
                }

            } catch (err) {
                console.error("Error initializing settings:", err);
            } finally {
                setLoading(false);
            }
        };
        init();
    }, []);

    // --- HANDLERS: HOLIDAYS ---
    const handleSaveHolidays = async () => {
        setSaving(true);
        try {
            const { error } = await supabase
                .from('global_config')
                .upsert({ 
                    id: 'holiday_config', 
                    config: {
                        active: holidayConfig,
                        overrides: holidayOverrides
                    },
                    updated_at: new Date().toISOString()
                });
            if (error) throw error;
            showToast("Feiertags-Konfiguration gespeichert. Einträge werden automatisch für alle Mitarbeiter aktualisiert.", "success");
        } catch (err: any) {
            showToast("Fehler beim Speichern: " + err.message, "error");
        } finally {
            setSaving(false);
        }
    };



    // --- HANDLERS: SCHOOL HOLIDAYS ---
    const handleSaveSchoolHolidays = async () => {
        setSaving(true);
        try {
            const { error } = await supabase
                .from('global_config')
                .upsert({ 
                    id: 'school_holidays', 
                    config: schoolHolidayConfig,
                    updated_at: new Date().toISOString()
                });
            if (error) throw error;
            setSchoolHolidayDirty(false);
            showToast("Ferien-Konfiguration gespeichert.", "success");
        } catch (err: any) {
            showToast("Fehler: " + err.message, "error");
        } finally {
            setSaving(false);
        }
    };

    const updateSchoolHolidayDate = (year: number, holidayId: string, field: 'start' | 'end', value: string) => {
        setSchoolHolidayConfig(prev => ({
            ...prev,
            holidays: {
                ...prev.holidays,
                [year.toString()]: {
                    ...(prev.holidays[year.toString()] || {}),
                    [holidayId]: {
                        ...(prev.holidays[year.toString()]?.[holidayId] || { start: '', end: '' }),
                        [field]: value
                    }
                }
            }
        }));
        setSchoolHolidayDirty(true);
    };

    const toggleSchoolHolidayVisibility = () => {
        setSchoolHolidayConfig(prev => ({ ...prev, showInCalendar: !prev.showInCalendar }));
        setSchoolHolidayDirty(true);
    };

    // --- HANDLERS: MONTH CLOSING ---
    const handleToggleMonth = async (monthStr: string, isClosed: boolean) => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                showToast("Nicht authentifiziert.", "error");
                return;
            }

            if (isClosed) {
                const { error } = await supabase.from('closed_months').delete().eq('month', monthStr);
                if (error) throw error;
                setClosedMonths(prev => prev.filter(m => m !== monthStr));
                showToast(`${monthStr} wurde wieder geöffnet.`, "success");
            } else {
                const { error } = await supabase.from('closed_months').insert({ 
                    month: monthStr, 
                    closed_by: user.id 
                });
                if (error) throw error;
                setClosedMonths(prev => [...prev, monthStr]);
                showToast(`${monthStr} wurde erfolgreich abgeschlossen.`, "success");
            }
        } catch (err: any) {
            showToast("Fehler: " + err.message, "error");
        }
    };

    // --- HANDLERS: EXPORT ---
    const handleExport = async () => {
        const validUsers = users.filter(u => selectedExportUsers.includes(u.user_id!));
        if (validUsers.length === 0) return;

        setIsExporting(true);
        setExportProgress('Starte Export...');

        try {
            const zip = new JSZip();
            const year = selectedExportMonth.getFullYear();
            const month = selectedExportMonth.getMonth();
            const startDate = getLocalISOString(new Date(year, month, 1));
            const endDate = getLocalISOString(new Date(year, month + 1, 0));

            const monthName = selectedExportMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
            const folder = zip.folder(`Export_${monthName.replace(' ', '_')}`);

            for (let i = 0; i < validUsers.length; i++) {
                const user = validUsers[i];
                setExportProgress(`Verarbeite ${i + 1}/${validUsers.length}: ${user.display_name}`);
                
                const data = await fetchExportData(user.user_id!, startDate, endDate);
                const sanitizedName = user.display_name.replace(/[^a-zA-Z0-9]/g, '_');

                if (exportTypes.projects) folder?.file(`${sanitizedName}_Projekte.pdf`, generateProjectPdfBlob(data, startDate, endDate));
                if (exportTypes.attendance) folder?.file(`${sanitizedName}_Anwesenheit.pdf`, generateAttendancePdfBlob(data, startDate, endDate));
                if (exportTypes.monthly_report) folder?.file(`${sanitizedName}_Monatsbericht.pdf`, generateMonthlyReportPdfBlob(data, startDate, endDate));
            }

            const content = await zip.generateAsync({ type: 'blob' });
            const url = window.URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Stunden_Export_${monthName.replace(' ', '_')}.zip`;
            a.click();
            showToast("Export erfolgreich abgeschlossen.", "success");
        } catch (err: any) {
            showToast("Export fehlgeschlagen: " + err.message, "error");
        } finally {
            setIsExporting(false);
            setExportProgress('');
        }
    };

    // --- RENDERING ---

    const renderHolidays = () => (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="flex flex-col md:flex-row justify-between items-start gap-4">
                <div>
                    <h3 className="text-xl font-bold text-white mb-1">Feiertags-Konfiguration</h3>
                    <div className="flex items-center gap-2">
                        <p className="text-white/50 text-sm">Diese Einstellungen gelten global für alle Mitarbeiter.</p>
                        <div className="flex items-center bg-white/5 border border-white/10 rounded-lg px-2 py-0.5 gap-2 ml-2">
                            <button onClick={() => setViewYear(y => y - 1)} className="text-teal-400 hover:text-white transition-colors"><ChevronLeft size={14} /></button>
                            <span className="text-xs font-bold text-white w-10 text-center">{viewYear}</span>
                            <button onClick={() => setViewYear(y => y + 1)} className="text-teal-400 hover:text-white transition-colors"><ChevronRight size={14} /></button>
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap gap-3 w-full md:w-auto shrink-0">
                    <GlassButton onClick={handleSaveHolidays} disabled={saving} className="flex-1 md:flex-none !w-auto flex items-center gap-2 !bg-emerald-500/20 hover:!bg-emerald-500/30 !border-emerald-500/30 text-emerald-300">
                        {saving ? <RotateCcw size={18} className="animate-spin" /> : <Save size={18} />} Speichern
                    </GlassButton>
                </div>
            </div>

            <div className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/5">
                    {getBavarianHolidays(viewYear).map((h) => {
                        const isActive = holidayConfig[h.id] !== false;
                        const overrideDate = holidayOverrides[viewYear]?.[h.id];
                        const displayDate = overrideDate ? new Date(overrideDate) : h.date;
                        const isOverridden = !!overrideDate;

                        return (
                            <div key={h.id} className={`bg-gray-900/40 p-4 flex items-center justify-between transition-colors ${isActive ? 'bg-white/5' : 'opacity-40'}`}>
                                <div className="flex items-center gap-3">
                                    <div onClick={() => setHolidayConfig(prev => ({ ...prev, [h.id]: !isActive }))} className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all cursor-pointer ${isActive ? 'bg-rose-500/20 border-rose-500/40 text-rose-300' : 'bg-white/5 border-white/10 text-white/20'}`}>
                                        <PartyPopper size={20} />
                                    </div>
                                    <div>
                                        <div className={`font-bold transition-colors ${isActive ? 'text-white' : 'text-white/30'}`}>{h.name}</div>
                                        <div className="flex items-center gap-2 mt-1">
                                            <input type="date" value={displayDate.toISOString().split('T')[0]} onChange={(e) => setHolidayOverrides(prev => ({ ...prev, [viewYear]: { ...(prev[viewYear] || {}), [h.id]: e.target.value } }))} className={`bg-black/40 border rounded px-2 py-0.5 text-[10px] font-mono font-bold outline-none ${isOverridden ? 'border-amber-500/50 text-amber-400' : 'border-white/10 text-teal-400/70'}`} />
                                            {isOverridden && <button onClick={() => { const next = { ...(holidayOverrides[viewYear] || {}) }; delete next[h.id]; setHolidayOverrides(prev => ({ ...prev, [viewYear]: next })); }} className="text-amber-500/50 hover:text-amber-500"><RotateCcw size={12} /></button>}
                                        </div>
                                    </div>
                                </div>
                                <div className={`w-6 h-6 rounded-lg border flex items-center justify-center ${isActive ? 'bg-emerald-500 border-emerald-400 text-white' : 'bg-white/5 border-white/10 text-transparent'}`}><Check size={14} /></div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );

    const renderMonthClosing = () => (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
                <h3 className="text-xl font-bold text-white mb-1">Monatsabschluss & Sperrungen</h3>
                <p className="text-white/50 text-sm">Gesperrte Monate können von Mitarbeitern nicht mehr bearbeitet werden.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(12)].map((_, i) => {
                    const d = new Date(); d.setMonth(d.getMonth() - i);
                    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    const isClosed = closedMonths.includes(monthStr);
                    return (
                        <div key={monthStr} className="flex items-center justify-between bg-white/5 border border-white/10 p-4 rounded-2xl hover:bg-white/10 transition-colors">
                            <div>
                                <div className="font-bold text-white">{d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</div>
                                <div className={`text-[10px] font-bold uppercase ${isClosed ? 'text-rose-400' : 'text-emerald-400'}`}>{isClosed ? 'Abgeschlossen' : 'Offen'}</div>
                            </div>
                            <button onClick={() => handleToggleMonth(monthStr, isClosed)} className={`p-2 rounded-xl transition-all ${isClosed ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}>
                                {isClosed ? <Unlock size={18} /> : <Lock size={18} />}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    const renderDepartments = () => (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
                <h3 className="text-xl font-bold text-white mb-1">Abteilungs-Verwaltung</h3>
                <p className="text-white/50 text-sm">Zuständigkeiten und Vertretungsregelungen für die Freigabe.</p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {departments.map(dept => (
                    <GlassCard key={dept.id} className="!p-0 border-white/10 overflow-hidden">
                        <div className="bg-white/5 px-4 py-3 border-b border-white/10 flex justify-between items-center">
                            <span className="font-bold text-teal-300 uppercase text-xs tracking-widest flex items-center gap-2"><Briefcase size={14} /> {dept.label}</span>
                            <div className="flex gap-1.5">
                                <div className={`w-2 h-2 rounded-full ${dept.is_substitute_active ? 'bg-teal-500 shadow-[0_0_8px_rgba(20,184,166,0.6)]' : 'bg-white/10'}`} />
                                <div className={`w-2 h-2 rounded-full ${dept.is_retro_substitute_active ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)]' : 'bg-white/10'}`} />
                            </div>
                        </div>
                        <div className="p-4 space-y-4">
                            <div>
                                <label className="text-[10px] text-white/40 uppercase font-bold block mb-1.5">Verantwortlicher</label>
                                <select className="w-full bg-black/40 text-white text-sm rounded-xl border border-white/10 px-3 py-2 outline-none" value={dept.responsible_user_id || ''} onChange={(e) => updateDepartment(dept.id, { responsible_user_id: e.target.value })}>
                                    <option value="">- Kein -</option>
                                    {users.map(u => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}
                                </select>
                            </div>
                            <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10">
                                <span className="text-xs text-white/70 font-bold">Vertretung aktiv</span>
                                <button onClick={() => updateDepartment(dept.id, { is_substitute_active: !dept.is_substitute_active })} className={`w-10 h-6 rounded-full p-1 transition-all flex items-center ${dept.is_substitute_active ? 'bg-teal-500 justify-end' : 'bg-white/10 justify-start'}`}><div className="w-4 h-4 rounded-full bg-white shadow-sm" /></button>
                            </div>

                            {/* Additional Responsible Users */}
                            <div className="pt-2">
                                <label className="text-[10px] text-white/40 uppercase font-bold block mb-1.5">Weitere Zuständige</label>
                                <div className="bg-black/20 rounded-xl p-2 border border-white/10 space-y-2">
                                    <div className="flex flex-wrap gap-1.5">
                                        {(dept.additional_responsible_ids || []).map(id => {
                                            const u = users.find(user => user.user_id === id);
                                            return (
                                                <div key={id} className="flex items-center gap-1 bg-teal-500/10 text-teal-200 pl-2 pr-1 py-1 rounded-lg text-[10px] border border-teal-500/20">
                                                    <span>{u?.display_name || 'Unbekannt'}</span>
                                                    <button onClick={() => {
                                                        const newIds = (dept.additional_responsible_ids || []).filter(existingId => existingId !== id);
                                                        updateDepartment(dept.id, { additional_responsible_ids: newIds });
                                                    }} className="hover:bg-teal-500/20 rounded p-0.5 text-teal-400 hover:text-white">
                                                        <X size={10} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                        {(dept.additional_responsible_ids || []).length === 0 && <span className="text-white/20 text-[10px] italic px-1">Keine</span>}
                                    </div>
                                    <select 
                                        className="w-full bg-transparent text-teal-100/50 text-[10px] outline-none cursor-pointer border-t border-white/5 pt-1.5 mt-1"
                                        value=""
                                        onChange={(e) => {
                                            const id = e.target.value;
                                            if (!id) return;
                                            const current = dept.additional_responsible_ids || [];
                                            if (!current.includes(id)) updateDepartment(dept.id, { additional_responsible_ids: [...current, id] });
                                        }}
                                    >
                                        <option value="">+ Hinzufügen</option>
                                        {users.filter(u => u.user_id && u.user_id !== dept.responsible_user_id && !(dept.additional_responsible_ids || []).includes(u.user_id)).map(u => (
                                            <option key={u.user_id} value={u.user_id} className="bg-slate-900">{u.display_name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Retroactive Settings */}
                            <div className="pt-4 border-t border-white/5 space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] text-orange-400/70 uppercase font-bold flex items-center gap-1.5"><Clock size={10} /> Rückwirkend</label>
                                    <button onClick={() => updateDepartment(dept.id, { is_retro_substitute_active: !dept.is_retro_substitute_active })} className={`w-10 h-6 rounded-full p-1 transition-all flex items-center ${dept.is_retro_substitute_active ? 'bg-orange-500 justify-end' : 'bg-white/10 justify-start'}`}><div className="w-4 h-4 rounded-full bg-white shadow-sm" /></button>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[9px] text-white/30 uppercase font-bold block mb-1 ml-1">Chef</label>
                                        <select className="w-full bg-black/40 text-orange-100 text-[11px] rounded-lg border border-orange-500/10 p-1.5 outline-none" value={dept.retro_responsible_user_id || ''} onChange={(e) => updateDepartment(dept.id, { retro_responsible_user_id: e.target.value })}>
                                            <option value="">Standard</option>
                                            {users.map(u => <option key={u.user_id} value={u.user_id} className="bg-slate-900">{u.display_name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[9px] text-white/30 uppercase font-bold block mb-1 ml-1">Vertr.</label>
                                        <select className="w-full bg-black/40 text-orange-100 text-[11px] rounded-lg border border-orange-500/10 p-1.5 outline-none" value={dept.retro_substitute_user_id || ''} onChange={(e) => updateDepartment(dept.id, { retro_substitute_user_id: e.target.value })}>
                                            <option value="">Standard</option>
                                            {users.map(u => <option key={u.user_id} value={u.user_id} className="bg-slate-900">{u.display_name}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </GlassCard>
                ))}
            </div>
        </div>
    );

    const renderExport = () => (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
                <h3 className="text-xl font-bold text-white mb-1">Stunden-Export (Batch)</h3>
                <p className="text-white/50 text-sm">Laden Sie Stundenberichte für mehrere Mitarbeiter gleichzeitig herunter.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-teal-300 uppercase tracking-widest">Zeitraum</label>
                        <div className="flex items-center justify-between bg-white/5 p-2 rounded-2xl border border-white/10">
                            <button onClick={() => setSelectedExportMonth(new Date(selectedExportMonth.getFullYear(), selectedExportMonth.getMonth() - 1, 1))} className="p-2 hover:bg-white/10 rounded-xl text-white"><ChevronLeft /></button>
                            <span className="font-bold text-white">{selectedExportMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</span>
                            <button onClick={() => setSelectedExportMonth(new Date(selectedExportMonth.getFullYear(), selectedExportMonth.getMonth() + 1, 1))} className="p-2 hover:bg-white/10 rounded-xl text-white"><ChevronRight /></button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-teal-300 uppercase tracking-widest">Export-Typen</label>
                        <div className="space-y-2">
                            {['projects', 'attendance', 'monthly_report'].map(type => (
                                <button key={type} onClick={() => setExportTypes(prev => ({ ...prev, [type]: !prev[type as keyof typeof exportTypes] }))} className={`w-full p-3 rounded-xl border flex items-center gap-3 transition-all ${exportTypes[type as keyof typeof exportTypes] ? 'bg-teal-500/10 border-teal-500/30 text-white' : 'bg-white/5 border-white/10 text-white/40'}`}>
                                    {exportTypes[type as keyof typeof exportTypes] ? <CheckSquare size={18} /> : <Square size={18} />}
                                    <span className="font-bold text-sm uppercase">{type === 'projects' ? 'Projektbericht' : type === 'attendance' ? 'Anwesenheit' : 'Monatsbericht'}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex flex-col h-full space-y-2">
                    <div className="flex justify-between items-center">
                        <label className="text-xs font-bold text-teal-300 uppercase tracking-widest">Mitarbeiter ({selectedExportUsers.length})</label>
                        <button onClick={() => setSelectedExportUsers(selectedExportUsers.length === users.length ? [] : users.map(u => u.user_id!))} className="text-[10px] font-bold text-white/30 hover:text-white uppercase">Alle wählen</button>
                    </div>
                    <div className="bg-white/5 rounded-2xl border border-white/10 overflow-y-auto max-h-[400px] p-2 custom-scrollbar">
                        {users.map(u => (
                            <button key={u.user_id} onClick={() => setSelectedExportUsers(prev => prev.includes(u.user_id!) ? prev.filter(id => id !== u.user_id) : [...prev, u.user_id!])} className={`w-full p-3 rounded-xl mb-1 flex items-center gap-3 text-left transition-all ${selectedExportUsers.includes(u.user_id!) ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5'}`}>
                                {selectedExportUsers.includes(u.user_id!) ? <CheckSquare size={16} className="text-teal-400" /> : <Square size={16} />}
                                <span className="text-sm font-medium">{u.display_name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <GlassButton onClick={handleExport} disabled={isExporting || selectedExportUsers.length === 0} className="w-full !py-6 !bg-gradient-to-r from-teal-500 to-emerald-600 !border-teal-400/30 shadow-2xl">
                {isExporting ? <div className="flex flex-col items-center gap-1"><Loader2 className="animate-spin" /> <span className="text-[10px] uppercase font-mono">{exportProgress}</span></div> : <div className="flex items-center gap-3 text-xl font-bold uppercase"><Download /> Export starten</div>}
            </GlassButton>
        </div>
    );

    const renderSchoolHolidays = () => {
        const yearData = schoolHolidayConfig.holidays[viewYear.toString()] || {};
        const filledCount = SCHOOL_HOLIDAY_TEMPLATES.filter(t => yearData[t.id]?.start && yearData[t.id]?.end).length;

        return (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="flex flex-col md:flex-row justify-between items-start gap-4">
                    <div>
                        <h3 className="text-xl font-bold text-white mb-1">Schulferien (Bayern)</h3>
                        <div className="flex items-center gap-2">
                            <p className="text-white/50 text-sm">Zeiträume werden in den Kalendern farblich markiert.</p>
                            <div className="flex items-center bg-white/5 border border-white/10 rounded-lg px-2 py-0.5 gap-2 ml-2">
                                <button onClick={() => setViewYear(y => y - 1)} className="text-teal-400 hover:text-white transition-colors"><ChevronLeft size={14} /></button>
                                <span className="text-xs font-bold text-white w-10 text-center">{viewYear}</span>
                                <button onClick={() => setViewYear(y => y + 1)} className="text-teal-400 hover:text-white transition-colors"><ChevronRight size={14} /></button>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-3 w-full md:w-auto shrink-0 items-center">
                        {/* Toggle: In Kalendern anzeigen */}
                        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                            <span className="text-xs font-bold text-white/50">Kalender</span>
                            <button
                                type="button"
                                onClick={toggleSchoolHolidayVisibility}
                                className={`w-10 h-5 rounded-full p-0.5 transition-colors duration-200 relative ${schoolHolidayConfig.showInCalendar ? 'bg-teal-500' : 'bg-white/10'}`}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${schoolHolidayConfig.showInCalendar ? 'translate-x-5' : 'translate-x-0'}`} />
                            </button>
                        </div>
                        <GlassButton onClick={handleSaveSchoolHolidays} disabled={saving || !schoolHolidayDirty} className={`flex-1 md:flex-none !w-auto flex items-center gap-2 !bg-emerald-500/20 hover:!bg-emerald-500/30 !border-emerald-500/30 text-emerald-300 ${!schoolHolidayDirty ? 'opacity-40' : ''}`}>
                            {saving ? <RotateCcw size={18} className="animate-spin" /> : <Save size={18} />} Speichern
                        </GlassButton>
                    </div>
                </div>

                <div className="text-xs text-white/30 font-bold uppercase tracking-widest">
                    {filledCount} / {SCHOOL_HOLIDAY_TEMPLATES.length} Ferienzeiten eingetragen
                </div>

                <div className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                    <div className="divide-y divide-white/5">
                        {SCHOOL_HOLIDAY_TEMPLATES.map((template) => {
                            const period = yearData[template.id];
                            const hasData = period?.start && period?.end;

                            return (
                                <div key={template.id} className={`p-4 flex flex-col md:flex-row md:items-center gap-3 transition-colors ${hasData ? 'bg-white/5' : ''}`}>
                                    <div className="flex items-center gap-3 md:w-48 shrink-0">
                                        <span className="text-xl">{template.icon}</span>
                                        <span className={`font-bold transition-colors ${hasData ? 'text-white' : 'text-white/30'}`}>{template.name}</span>
                                    </div>
                                    <div className="flex items-center gap-2 flex-1">
                                        <input
                                            type="date"
                                            value={period?.start || ''}
                                            onChange={(e) => updateSchoolHolidayDate(viewYear, template.id, 'start', e.target.value)}
                                            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-teal-400 font-mono outline-none focus:border-teal-500/50 transition-colors"
                                        />
                                        <span className="text-white/20 text-xs font-bold">—</span>
                                        <input
                                            type="date"
                                            value={period?.end || ''}
                                            onChange={(e) => updateSchoolHolidayDate(viewYear, template.id, 'end', e.target.value)}
                                            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-teal-400 font-mono outline-none focus:border-teal-500/50 transition-colors"
                                        />
                                    </div>
                                    {hasData && (
                                        <div className="text-[10px] text-white/20 font-mono md:w-20 text-right">
                                            {Math.ceil((new Date(period!.end).getTime() - new Date(period!.start).getTime()) / (1000 * 60 * 60 * 24)) + 1} Tage
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    const renderContent = () => {
        switch (activeCategory) {
            case 'holidays': return renderHolidays();
            case 'schoolHolidays': return renderSchoolHolidays();
            case 'monthClosing': return renderMonthClosing();
            case 'departments': return renderDepartments();
            case 'export': return renderExport();
            default: return <div className="flex flex-col items-center justify-center h-64 text-white/20 italic"><Database size={48} className="mb-4 opacity-10" /> Sektion im Aufbau</div>;
        }
    };

    return (
        <div className="p-6 pb-24 h-full overflow-hidden flex flex-col md:max-w-7xl md:mx-auto w-full">
            <div className="flex items-center justify-between mb-8 shrink-0">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate('/office')} className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/50 hover:text-white transition-colors border border-white/10"><ChevronLeft size={24} /></button>
                    <div><h1 className="text-3xl font-bold text-white tracking-tight">Verwaltung</h1><p className="text-white/40 text-sm">Systemweite Einstellungen & Konfiguration</p></div>
                </div>
            </div>
            <div className="flex-1 flex flex-col md:flex-row gap-6 min-h-0">
                <div className="w-full md:w-64 shrink-0 flex flex-col gap-2 overflow-y-auto pr-2 custom-scrollbar">
                    {CATEGORIES.map(cat => (
                        <button key={cat.id} onClick={() => setActiveCategory(cat.id)} className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 text-sm font-bold border ${activeCategory === cat.id ? 'bg-gradient-to-r from-teal-500 to-emerald-600 text-white border-teal-400/50 shadow-lg shadow-teal-900/20' : 'bg-white/5 text-white/40 border-white/5 hover:bg-white/10 hover:text-white/60'}`}>
                            <cat.icon size={20} className={activeCategory === cat.id ? 'text-white' : 'text-white/30'} /> {cat.name}
                        </button>
                    ))}
                </div>
                <div className="flex-1 min-w-0 overflow-y-auto pr-2 custom-scrollbar">
                    <GlassCard className="h-full !p-8 border-white/10 bg-black/20 backdrop-blur-xl relative !overflow-visible">
                        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-teal-500/5 rounded-full blur-3xl pointer-events-none" />
                        {loading ? <div className="flex flex-col items-center justify-center h-full gap-4 text-white/30"><div className="w-10 h-10 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div><span className="font-bold text-sm tracking-widest uppercase">Lade Konfiguration...</span></div> : renderContent()}
                    </GlassCard>
                </div>
            </div>
        </div>
    );
};

export default OfficeSettingsPage;
