import React, { useState, useEffect } from 'react';
import { GlassCard } from './GlassCard';
import { X, FileDown, CheckSquare, Square, ChevronLeft, ChevronRight, Download, Loader2, Users } from 'lucide-react';
import { useOfficeService, getLocalISOString } from '../services/dataService';
import { fetchExportData, generateProjectPdfBlob, generateAttendancePdfBlob, generateMonthlyReportPdfBlob } from '../services/pdfExportService';
import JSZip from 'jszip';

// Helper for download
const saveBlob = (blob: Blob, fileName: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    window.URL.revokeObjectURL(url);
};

interface BatchExportModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const BatchExportModal: React.FC<BatchExportModalProps> = ({ isOpen, onClose }) => {
    const { users, fetchAllUsers } = useOfficeService();
    const [selectedMonth, setSelectedMonth] = useState(new Date());
    const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
    const [exportTypes, setExportTypes] = useState({ projects: true, attendance: true, monthly_report: true });
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState('');

    // Filter valid users with IDs
    const validUsers = users.filter(u => u.user_id);

    useEffect(() => {
        if (isOpen) {
            fetchAllUsers();
        }
    }, [isOpen, fetchAllUsers]);

    // Select all users by default when they load
    useEffect(() => {
        if (validUsers.length > 0 && selectedUsers.length === 0) {
            // @ts-ignore - we filtered for valid user_ids
            setSelectedUsers(validUsers.map(u => u.user_id));
        }
    }, [users]); // Only run when users change initially

    const handleToggleUser = (userId: string) => {
        if (selectedUsers.includes(userId)) {
            setSelectedUsers(prev => prev.filter(id => id !== userId));
        } else {
            setSelectedUsers(prev => [...prev, userId]);
        }
    };

    const handleSelectAll = () => {
        if (selectedUsers.length === validUsers.length) {
            setSelectedUsers([]);
        } else {
            // @ts-ignore
            setSelectedUsers(validUsers.map(u => u.user_id));
        }
    };

    const handleMonthChange = (offset: number) => {
        setSelectedMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
    };

    const handleExport = async () => {
        if (selectedUsers.length === 0) return;
        if (!exportTypes.projects && !exportTypes.attendance && !exportTypes.monthly_report) return;

        setIsGenerating(true);
        setProgress('Starte Export...');

        try {
            const zip = new JSZip();
            const year = selectedMonth.getFullYear();
            const month = selectedMonth.getMonth();
            const startOfMonth = new Date(year, month, 1);
            const endOfMonth = new Date(year, month + 1, 0); // Last day
            const startDate = getLocalISOString(startOfMonth);
            const endDate = getLocalISOString(endOfMonth);

            const monthName = selectedMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
            const folderName = `Export_${monthName.replace(' ', '_')}`;
            const folder = zip.folder(folderName);

            for (let i = 0; i < selectedUsers.length; i++) {
                const userId = selectedUsers[i];
                const user = users.find(u => u.user_id === userId);
                const userName = user?.display_name || 'Unbekannt';
                const sanitizedUserName = userName.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_');

                setProgress(`Verarbeite ${i + 1} von ${selectedUsers.length}: ${userName}`);

                try {
                    const data = await fetchExportData(userId, startDate, endDate);

                    if (exportTypes.projects) {
                        const blob = generateProjectPdfBlob(data, startDate, endDate);
                        folder?.file(`${sanitizedUserName}_Projekte_${startDate}.pdf`, blob);
                    }

                    if (exportTypes.attendance) {
                        const blob = generateAttendancePdfBlob(data, startDate, endDate);
                        folder?.file(`${sanitizedUserName}_Anwesenheit_${startDate}.pdf`, blob);
                    }

                    if (exportTypes.monthly_report) {
                        const blob = generateMonthlyReportPdfBlob(data, startDate, endDate);
                        folder?.file(`${sanitizedUserName}_Monatsbericht_${startDate}.pdf`, blob);
                    }

                } catch (err) {
                    console.error(`Error exporting for ${userName}:`, err);
                    // Continue with other users
                    folder?.file(`${sanitizedUserName}_ERROR.txt`, `Fehler beim Export: ${err}`);
                }
            }

            setProgress('Erstelle ZIP-Datei...');
            const content = await zip.generateAsync({ type: 'blob' });
            saveBlob(content, `Stunden_Export_${monthName.replace(' ', '_')}.zip`);

            onClose();
        } catch (error) {
            console.error("Export failed:", error);
            alert("Fehler beim Exportieren. Bitte Konsole prüfen.");
        } finally {
            setIsGenerating(false);
            setProgress('');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <GlassCard className="w-full max-w-2xl relative shadow-2xl flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-6 border-b border-white/10 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <FileDown className="text-teal-400" />
                        Stunden-Export (Batch)
                    </h2>
                    {!isGenerating && (
                        <button onClick={onClose} className="text-white/50 hover:text-white transition-colors">
                            <X size={24} />
                        </button>
                    )}
                </div>

                <div className="p-6 overflow-y-auto flex-1 space-y-6">

                    {/* 1. Date Selection */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-teal-200 uppercase tracking-wide">Zeitraum</label>
                        <div className="flex items-center justify-between bg-white/5 p-2 rounded-xl border border-white/10">
                            <button onClick={() => handleMonthChange(-1)} className="p-2 hover:bg-white/10 rounded-lg text-white">
                                <ChevronLeft />
                            </button>
                            <span className="text-lg font-bold text-white">
                                {selectedMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
                            </span>
                            <button onClick={() => handleMonthChange(1)} className="p-2 hover:bg-white/10 rounded-lg text-white">
                                <ChevronRight />
                            </button>
                        </div>
                    </div>

                    {/* 2. Export Types */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-teal-200 uppercase tracking-wide">Export-Typen</label>
                        <div className="flex gap-4 overflow-x-auto pb-2">
                            <button
                                onClick={() => setExportTypes(prev => ({ ...prev, projects: !prev.projects }))}
                                className={`flex-1 min-w-[140px] p-3 rounded-xl border flex items-center gap-3 transition-all ${exportTypes.projects ? 'bg-teal-500/20 border-teal-500/50 text-white' : 'bg-white/5 border-white/10 text-white/50'}`}
                            >
                                {exportTypes.projects ? <CheckSquare /> : <Square />}
                                <span className="font-bold">Projektbericht</span>
                            </button>
                            <button
                                onClick={() => setExportTypes(prev => ({ ...prev, attendance: !prev.attendance }))}
                                className={`flex-1 min-w-[140px] p-3 rounded-xl border flex items-center gap-3 transition-all ${exportTypes.attendance ? 'bg-blue-500/20 border-blue-500/50 text-white' : 'bg-white/5 border-white/10 text-white/50'}`}
                            >
                                {exportTypes.attendance ? <CheckSquare /> : <Square />}
                                <span className="font-bold">Anwesenheit</span>
                            </button>
                            <button
                                onClick={() => setExportTypes(prev => ({ ...prev, monthly_report: !prev.monthly_report }))}
                                className={`flex-1 min-w-[140px] p-3 rounded-xl border flex items-center gap-3 transition-all ${exportTypes.monthly_report ? 'bg-purple-500/20 border-purple-500/50 text-white' : 'bg-white/5 border-white/10 text-white/50'}`}
                            >
                                {exportTypes.monthly_report ? <CheckSquare /> : <Square />}
                                <span className="font-bold">Monatsbericht</span>
                            </button>
                        </div>
                    </div>

                    {/* 3. User Selection */}
                    <div className="space-y-2 flex-1 min-h-0 flex flex-col">
                        <div className="flex justify-between items-center">
                            <label className="text-sm font-bold text-teal-200 uppercase tracking-wide">Mitarbeiter ({selectedUsers.length})</label>
                            <button onClick={handleSelectAll} className="text-xs text-white/50 hover:text-white transition-colors">
                                {selectedUsers.length === validUsers.length ? 'Alle abwählen' : 'Alle auswählen'}
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 overflow-y-auto max-h-60 p-1">
                            {validUsers.map(user => {
                                // Safe implicit assertion since we filtered
                                const uid = user.user_id!;
                                return (
                                    <button
                                        key={uid}
                                        onClick={() => handleToggleUser(uid)}
                                        className={`p-3 rounded-lg border text-left flex items-center gap-3 transition-all ${selectedUsers.includes(uid) ? 'bg-white/10 border-white/30 text-white' : 'bg-transparent border-white/5 text-white/40 hover:bg-white/5'}`}
                                    >
                                        {selectedUsers.includes(uid) ? <CheckSquare size={18} className="text-teal-400" /> : <Square size={18} />}
                                        <span className="truncate">{user.display_name}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="p-6 border-t border-white/10 bg-black/20">
                    {isGenerating ? (
                        <div className="w-full flex flex-col items-center justify-center p-2 text-white/70">
                            <Loader2 className="animate-spin mb-2" size={24} />
                            <span className="text-sm font-mono">{progress}</span>
                        </div>
                    ) : (
                        <button
                            onClick={handleExport}
                            disabled={selectedUsers.length === 0 || (!exportTypes.projects && !exportTypes.attendance && !exportTypes.monthly_report)}
                            className="w-full py-4 bg-gradient-to-r from-teal-500 to-emerald-600 rounded-xl text-white font-bold text-lg shadow-lg hover:shadow-teal-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-2"
                        >
                            <Download /> Export {selectedUsers.length > 0 ? `für ${selectedUsers.length} Mitarbeiter` : ''} starten
                        </button>
                    )}
                </div>

            </GlassCard>
        </div>
    );
};

export default BatchExportModal;
