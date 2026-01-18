import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { GlassCard } from './GlassCard';

interface GlassDatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  onClose: () => void;
  gracePeriodCutoff?: Date;
}

const GlassDatePicker: React.FC<GlassDatePickerProps> = ({ value, onChange, onClose, gracePeriodCutoff }) => {
  // Initialisiere mit dem übergebenen Datum oder heute
  const [currentViewDate, setCurrentViewDate] = useState(() => {
    return value ? new Date(value) : new Date();
  });

  const year = currentViewDate.getFullYear();
  const month = currentViewDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 = Sonntag
  // Anpassung: Montag soll 0 sein für unser Grid
  const startDayIndex = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

  const handlePrevMonth = () => {
    setCurrentViewDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentViewDate(new Date(year, month + 1, 1));
  };

  const handleDayClick = (day: number) => {
    // Zeitzonen-sichere Erstellung des Strings
    const selectedDate = new Date(year, month, day);
    // Manuell YYYY-MM-DD formatieren, um Zeitzonenprobleme zu vermeiden
    const formattedDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onChange(formattedDate);
    onClose();
  };

  // Überprüfen, ob ein Tag der aktuell ausgewählte ist
  const isSelected = (day: number) => {
    if (!value) return false;
    const [vYear, vMonth, vDay] = value.split('-').map(Number);
    return vYear === year && vMonth - 1 === month && vDay === day;
  };

  // Überprüfen, ob ein Tag "Heute" ist
  const isToday = (day: number) => {
    const today = new Date();
    return today.getDate() === day && today.getMonth() === month && today.getFullYear() === year;
  };

  // Überprüfen, ob ein Tag in der "Vergangenheit" liegt (Grace Period)
  const isLate = (day: number) => {
    if (!gracePeriodCutoff) return false;
    const dateToCheck = new Date(year, month, day);
    dateToCheck.setHours(23, 59, 59, 999); // End of day to be generous or start? Cutoff is usually midnight.
    // Cutoff is the first VALID day. Date < Cutoff is LATE.
    return dateToCheck < gracePeriodCutoff;
  };

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanks = Array.from({ length: startDayIndex }, (_, i) => i);
  const weekDays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  return (
    /* Z-Index erhöht auf 200, damit es über dem PDF-Modal (z-100) liegt */
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <GlassCard className="w-full max-w-xs relative shadow-2xl !p-0 overflow-hidden ring-1 ring-white/20">
        {/* Header */}
        <div className="p-4 bg-gradient-to-r from-teal-900/50 to-emerald-900/50 border-b border-white/10 flex items-center justify-between">
          <button onClick={handlePrevMonth} className="p-1 hover:bg-white/10 rounded text-white/80 transition-colors">
            <ChevronLeft size={20} />
          </button>
          <span className="text-lg font-bold text-white tracking-wide">
            {currentViewDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
          </span>
          <button onClick={handleNextMonth} className="p-1 hover:bg-white/10 rounded text-white/80 transition-colors">
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="p-4">
          {/* Wochentage */}
          <div className="grid grid-cols-7 mb-2">
            {weekDays.map(d => (
              <div key={d} className="text-center text-xs font-bold text-teal-200/60 uppercase py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Kalender Grid */}
          <div className="grid grid-cols-7 gap-2">
            {blanks.map((_, i) => <div key={`blank-${i}`} />)}

            {days.map(day => {
              const selected = isSelected(day);
              const today = isToday(day);
              const late = isLate(day);

              return (
                <button
                  key={day}
                  onClick={() => handleDayClick(day)}
                  className={`
                    aspect-square flex items-center justify-center rounded-full text-sm font-medium transition-all duration-200
                    ${selected
                      ? 'bg-gradient-to-tr from-emerald-500 to-teal-400 text-white shadow-[0_0_15px_rgba(20,184,166,0.5)] scale-105'
                      : late
                        ? 'bg-orange-500/10 text-orange-200 hover:bg-orange-500/20 border border-orange-500/30' // LATE Days
                        : 'hover:bg-white/10 text-white' // Normal Days
                    }
                    ${!selected && today ? 'border border-teal-400 text-teal-300' : ''}
                  `}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer / Close */}
        <button
          onClick={onClose}
          className="w-full py-3 bg-white/5 hover:bg-white/10 border-t border-white/10 text-sm text-white/50 uppercase tracking-wider font-bold transition-colors"
        >
          Abbrechen
        </button>
      </GlassCard>
    </div>
  );
};

export default GlassDatePicker;