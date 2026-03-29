import React, { useState } from 'react';
import { useSettings } from '../services/dataService';
import { GlassCard, GlassInput, GlassButton } from '../components/GlassCard';
import { User, Clock, Save, LogOut, Calendar, Lock } from 'lucide-react';
import GlassDatePicker from '../components/GlassDatePicker';
import { useToast } from '../components/Toast';
import { DailyTarget, WorkConfig } from '../types';

const SettingsPage: React.FC = () => {
  const { showToast } = useToast();
  const { settings, updateSettings, logout } = useSettings();
  const [name, setName] = useState(settings.display_name);
  const [targets, setTargets] = useState(settings.target_hours);
  const [workConfig, setWorkConfig] = useState(settings.work_config || { 1: "07:00", 2: "07:00", 3: "07:00", 4: "07:00", 5: "07:00", 6: "07:00", 0: "07:00" });
  const [startDate, setStartDate] = useState(settings.employment_start_date || '');
  const [keyword, setKeyword] = useState(settings.invoice_keyword || '');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const isLocked = settings.work_config_locked || false;

  React.useEffect(() => {
    setName(settings.display_name);
    setTargets(settings.target_hours);
    // Fallback für ältere Daten ohne work_config
    setWorkConfig(settings.work_config || { 1: "07:00", 2: "07:00", 3: "07:00", 4: "07:00", 5: "07:00", 6: "07:00", 0: "07:00" });
    setStartDate(settings.employment_start_date || '');
    setKeyword(settings.invoice_keyword || '');
  }, [settings]);

  const handleSave = async () => {
    // Wenn gesperrt, dürfen targets, workConfig und employment_start_date nicht verändert werden
    const finalTargets = isLocked ? settings.target_hours : targets;
    const finalWorkConfig = isLocked ? settings.work_config : workConfig;
    const finalStartDate = isLocked ? settings.employment_start_date : startDate;

    const { error } = await updateSettings({
      display_name: name,
      role: settings.role,
      target_hours: finalTargets,
      work_config: finalWorkConfig,
      preferences: settings.preferences,
      vacation_days_yearly: settings.vacation_days_yearly,
      employment_start_date: finalStartDate || undefined,
      invoice_keyword: keyword
    });

    if (error) {
      // @ts-ignore - Error object might vary, handled safely in alert
      showToast("Fehler beim Speichern der Einstellungen:\n" + (error.message || JSON.stringify(error)), "error");
    } else {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    }
  };

  const handleTargetChange = (dayIndex: number, value: string) => {
    if (isLocked) return;
    const val = parseFloat(value) || 0;
    setTargets(prev => ({
      ...prev,
      [dayIndex as keyof DailyTarget]: val
    }));
  };

  const handleWorkStartChange = (dayIndex: number, value: string) => {
    if (isLocked) return;
    setWorkConfig(prev => ({
      ...prev,
      [dayIndex as keyof WorkConfig]: value
    }));
  };

  const dayNames = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Montag zuerst

  return (
    <div className="p-6 pb-24 h-full overflow-y-auto md:max-w-5xl md:mx-auto w-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">Einstellungen</h2>
        <GlassButton onClick={logout} variant="danger" className="md:hidden flex items-center justify-center gap-2 w-auto px-4 py-2">
          <LogOut size={18} />
        </GlassButton>
      </div>

      <div className="space-y-6">

        <div className="grid md:grid-cols-2 gap-6">
          {/* Profile Section */}
          <GlassCard>
            <div className="flex items-center gap-3 text-teal-300 mb-4">
              <User size={20} />
              <span className="font-bold text-sm uppercase tracking-wider">Profil</span>
            </div>
            <label className="block text-xs text-white/50 mb-2">Anzeigename</label>
            <GlassInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mb-4"
            />

            <label className="block text-xs text-white/50 mb-2">Eintrittsdatum</label>
            <div
              onClick={() => !isLocked && setShowDatePicker(true)}
              className={`flex items-center justify-between w-full border rounded-xl px-4 py-3 transition-colors ${isLocked ? 'bg-white/2 border-white/5 text-white/20 cursor-not-allowed' : 'bg-white/5 border-white/10 text-white cursor-pointer hover:bg-white/10'}`}
            >
              <span>{startDate ? new Date(startDate).toLocaleDateString('de-DE') : 'Ab erstem Eintrag'}</span>
              <Calendar size={18} className={isLocked ? 'text-white/10' : 'text-white/50'} />
            </div>
            {isLocked && <p className="text-[10px] text-orange-400/70 mt-1 italic">Dieses Feld wurde vom Büro gesperrt.</p>}
            <p className="text-[10px] text-white/30 mt-2">Berechnungen (Soll-Stunden) beginnen erst ab diesem Datum.</p>

            <div className="h-px bg-white/10 my-4" />

            <label className="block text-xs text-white/50 mb-2">PDF-Erkennungsschlüssel (z.B. Nachname)</label>
            <GlassInput
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="z.B. Göttfert"
              className="mb-2"
            />
            <p className="text-[10px] text-white/30">Wird verwendet, um Arbeitsstunden im Montagebericht zu finden.</p>
          </GlassCard>

          {/* Save Button Desktop */}
          <div className="hidden md:flex items-center">
            <GlassButton onClick={handleSave} className="flex items-center justify-center gap-2 w-full h-14">
              <Save size={18} />
              {isSaved ? 'Gespeichert!' : 'Einstellungen speichern'}
            </GlassButton>
          </div>
        </div>

        {/* Configuration Table */}
        <GlassCard className="overflow-hidden relative">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3 text-emerald-300">
              <Clock size={20} />
              <span className="font-bold text-sm uppercase tracking-wider">Wochenplan & Standardzeiten</span>
            </div>
            {isLocked && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                <Lock size={14} className="text-red-400" />
                <span className="text-[10px] font-bold text-red-300 uppercase tracking-wide">Vom Büro verwaltet</span>
              </div>
            )}
          </div>

          {/* Header Row */}
          <div className="grid grid-cols-3 gap-2 mb-2 px-2">
            <span className="text-xs font-bold text-white/30 uppercase">Tag</span>
            <span className="text-xs font-bold text-white/30 uppercase text-center">Start ab</span>
            <span className="text-xs font-bold text-white/30 uppercase text-right">Soll (h)</span>
          </div>

          <div className={`space-y-3 ${isLocked ? 'opacity-50 pointer-events-none' : ''}`}>
            {dayOrder.map((dayIndex) => (
              <div key={dayIndex} className="grid grid-cols-3 gap-2 items-center bg-white/5 rounded-lg p-2 border border-white/5">
                <span className="text-white font-medium text-sm">{dayNames[dayIndex]}</span>

                {/* Start Time Input */}
                <div className="flex justify-center">
                  <input
                    type="time"
                    className="bg-white/5 border border-white/20 rounded-lg px-2 py-1 text-center text-white text-sm focus:outline-none focus:border-teal-500/50 w-full max-w-[80px]"
                    value={workConfig[dayIndex as keyof typeof workConfig] || "07:00"}
                    onChange={(e) => handleWorkStartChange(dayIndex, e.target.value)}
                    disabled={isLocked}
                  />
                </div>

                {/* Target Hours Input */}
                <div className="flex justify-end">
                  <div className="relative w-20">
                    <input
                      type="number"
                      step="0.5"
                      className="w-full bg-white/5 border border-white/20 rounded-lg px-2 py-1 text-right text-white text-sm focus:outline-none focus:border-teal-500/50 pr-6"
                      value={targets[dayIndex as keyof typeof targets]}
                      onChange={(e) => handleTargetChange(dayIndex, e.target.value)}
                      disabled={isLocked}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 text-xs">h</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Mobile Save Button */}
        <div className="md:hidden pb-6">
          <GlassButton onClick={handleSave} className="flex items-center justify-center gap-2">
            <Save size={18} />
            {isSaved ? 'Gespeichert!' : 'Einstellungen speichern'}
          </GlassButton>
        </div>

        <div className="text-center text-xs text-white/30 mt-4">
          Version 1.4 • TimeGlass
        </div>
      </div>

      {showDatePicker && (
        <GlassDatePicker
          value={startDate}
          onChange={setStartDate}
          onClose={() => setShowDatePicker(false)}
        />
      )}
    </div>
  );
};

export default SettingsPage;