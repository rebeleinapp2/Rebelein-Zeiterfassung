import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { GlassCard } from './GlassCard';
import { supabase } from '../services/supabaseClient';

interface GlassDatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  onClose: () => void;
  gracePeriodCutoff?: Date;
  // NEU: Range-Modus
  rangeMode?: boolean;
  rangeStart?: string; // YYYY-MM-DD
  rangeEnd?: string;   // YYYY-MM-DD
  onRangeChange?: (start: string, end: string) => void;
  inline?: boolean;
}

const GlassDatePicker: React.FC<GlassDatePickerProps> = ({ value, onChange, onClose, gracePeriodCutoff, rangeMode, rangeStart, rangeEnd, onRangeChange, inline = false }) => {
  // Initialisiere mit dem übergebenen Datum oder heute
  const [currentViewDate, setCurrentViewDate] = useState(() => {
    return value ? new Date(value) : new Date();
  });

  // DB State for Closed Months
  const [closedMonths, setClosedMonths] = useState<string[]>([]);
  const [isPrivileged, setIsPrivileged] = useState(true);

  useEffect(() => {
    const checkRoleAndMonths = async () => {
      // Wenn wir in einem Bereich-Modus (z.B. für Auswertungen) sind, sperren wir nichts.
      if (rangeMode) {
        setIsPrivileged(true);
        return;
      }

      // Einträge dürfen nur noch über /office/user für gesperrte Monate bearbeitet werden
      const isOfficeUserPage = window.location.pathname.includes('/office/user');
      setIsPrivileged(isOfficeUserPage);

      if (!isOfficeUserPage) {
        const { data: closed } = await supabase.from('closed_months').select('month');
        if (closed) setClosedMonths(closed.map(c => c.month));
      }
    };
    checkRoleAndMonths();
  }, [rangeMode]);

  // Range selection state: first click = start, second click = end
  const [rangeSelectionStep, setRangeSelectionStep] = useState<'start' | 'end'>(
    rangeMode && rangeStart && rangeEnd && rangeStart !== rangeEnd ? 'end' : 'start'
  );
  const [tempRangeStart, setTempRangeStart] = useState(rangeStart || '');
  const [tempRangeEnd, setTempRangeEnd] = useState(rangeEnd || '');

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

  const formatDay = (day: number) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const handleDayClick = (day: number) => {
    const formattedDate = formatDay(day);

    if (rangeMode && onRangeChange) {
      if (rangeSelectionStep === 'start') {
        // First click: set start date
        setTempRangeStart(formattedDate);
        setTempRangeEnd('');
        setRangeSelectionStep('end');
      } else {
        // Second click: set end date
        if (formattedDate < tempRangeStart) {
          // If end is before start, swap
          setTempRangeEnd(tempRangeStart);
          setTempRangeStart(formattedDate);
          onRangeChange(formattedDate, tempRangeStart);
        } else {
          setTempRangeEnd(formattedDate);
          onRangeChange(tempRangeStart, formattedDate);
        }
        onClose();
      }
    } else {
      onChange(formattedDate);
      onClose();
    }
  };

  // Überprüfen, ob ein Tag der aktuell ausgewählte ist
  const isSelected = (day: number) => {
    if (rangeMode) return false; // In range mode, we use different highlight
    if (!value) return false;
    const [vYear, vMonth, vDay] = value.split('-').map(Number);
    return vYear === year && vMonth - 1 === month && vDay === day;
  };

  // Check if a day falls in a closed month for restricted users
  const isClosedMonth = (day: number) => {
    if (isPrivileged) return false;
    const monthStr = formatDay(day).substring(0, 7);
    return closedMonths.includes(monthStr);
  };

  // Range highlight checks
  const isRangeStart = (day: number) => {
    if (!rangeMode) return false;
    const dateStr = formatDay(day);
    return dateStr === tempRangeStart;
  };

  const isRangeEnd = (day: number) => {
    if (!rangeMode) return false;
    const dateStr = formatDay(day);
    return dateStr === tempRangeEnd;
  };

  const isInRange = (day: number) => {
    if (!rangeMode || !tempRangeStart || !tempRangeEnd) return false;
    const dateStr = formatDay(day);
    return dateStr > tempRangeStart && dateStr < tempRangeEnd;
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
    dateToCheck.setHours(23, 59, 59, 999);
    return dateToCheck < gracePeriodCutoff;
  };

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanks = Array.from({ length: startDayIndex }, (_, i) => i);
  const weekDays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  const datePickerContent = (
    <GlassCard className={`w-full ${inline ? '' : 'max-w-xs'} relative shadow-2xl !p-0 overflow-hidden ring-1 ring-white/10 bg-slate-900/40 backdrop-blur-3xl`}>
      {/* Header */}
      <div className={`p-4 border-b border-border flex items-center justify-between ${rangeMode ? 'bg-gradient-to-r from-blue-900/50 to-indigo-900/50' : 'bg-gradient-to-r from-teal-900/50 to-emerald-900/50'}`}>
        <button onClick={handlePrevMonth} className="p-1 hover:bg-card rounded text-muted-foreground transition-colors">
          <ChevronLeft size={20} />
        </button>
        <span className="text-lg font-bold text-foreground tracking-wide">
          {currentViewDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
        </span>
        <button onClick={handleNextMonth} className="p-1 hover:bg-card rounded text-muted-foreground transition-colors">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Range Mode Instruction */}
      {rangeMode && (
        <div className="px-4 pt-3 pb-1">
          <div className={`text-xs font-bold uppercase tracking-wider text-center py-1.5 px-3 rounded-lg ${rangeSelectionStep === 'start'
            ? 'text-blue-300 bg-blue-500/10 border border-blue-500/20'
            : 'text-indigo-300 bg-indigo-500/10 border border-indigo-500/20'
            }`}>
            {rangeSelectionStep === 'start' ? '① Startdatum wählen' : '② Enddatum wählen'}
          </div>
        </div>
      )}

      <div className="p-4">
        {/* Wochentage */}
        <div className="grid grid-cols-7 mb-2">
          {weekDays.map(d => (
            <div key={d} className={`text-center text-xs font-bold uppercase py-1 ${rangeMode ? 'text-blue-200/60' : 'text-teal-200/60'}`}>
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
            const rStart = isRangeStart(day);
            const rEnd = isRangeEnd(day);
            const inRange = isInRange(day);
            const closed = isClosedMonth(day);

            return (
              <button
                key={day}
                onClick={() => !closed && handleDayClick(day)}
                disabled={closed}
                title={closed ? 'Dieser Monat ist bereits für Änderungen gesperrt' : ''}
                className={`
                    aspect-square flex items-center justify-center rounded-full text-sm font-medium transition-all duration-200
                    ${closed
                    ? 'bg-red-900/20 text-red-500/50 cursor-not-allowed border border-red-500/20'
                    : selected
                      ? 'bg-gradient-to-tr from-emerald-500 to-teal-400 text-foreground shadow-[0_0_15px_rgba(20,184,166,0.5)] scale-105'
                      : rStart
                        ? 'bg-gradient-to-tr from-blue-500 to-blue-400 text-foreground shadow-[0_0_15px_rgba(59,130,246,0.5)] scale-105'
                        : rEnd
                          ? 'bg-gradient-to-tr from-indigo-500 to-indigo-400 text-foreground shadow-[0_0_15px_rgba(99,102,241,0.5)] scale-105'
                          : inRange
                            ? 'bg-blue-500/20 text-blue-200 border border-blue-500/30'
                            : late
                              ? 'bg-orange-500/10 text-orange-200 hover:bg-orange-500/20 border border-orange-500/30'
                              : 'hover:bg-card text-foreground'
                  }
                    ${!closed && !selected && !rStart && !rEnd && !inRange && today ? `border ${rangeMode ? 'border-blue-400 text-blue-300' : 'border-teal-400 text-teal-300'}` : ''}
                  `}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>

      {/* Range Summary */}
      {rangeMode && tempRangeStart && rangeSelectionStep === 'end' && (
        <div className="px-4 pb-3">
          <div className="text-[10px] text-center text-blue-300/60">
            Start: <span className="font-bold text-blue-200">{new Date(tempRangeStart + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
          </div>
        </div>
      )}

      {/* Footer / Close */}
      <div className="flex border-t border-border">
        {rangeMode && rangeSelectionStep === 'end' && (
          <button
            onClick={() => {
              setRangeSelectionStep('start');
              setTempRangeStart('');
              setTempRangeEnd('');
            }}
            className="flex-1 py-3 bg-muted hover:bg-card text-sm text-blue-300/60 hover:text-blue-300 uppercase tracking-wider font-bold transition-colors"
          >
            Zurücksetzen
          </button>
        )}
        <button
          onClick={onClose}
          className="flex-1 py-3 bg-muted hover:bg-card text-sm text-muted-foreground uppercase tracking-wider font-bold transition-colors"
        >
          {inline ? 'Fertig' : 'Abbrechen'}
        </button>
      </div>
    </GlassCard>
  );

  if (inline) {
    return datePickerContent;
  }

  return (
    /* Z-Index erhöht auf 200, damit es über dem PDF-Modal (z-100) liegt */
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-in fade-in duration-200">
      {datePickerContent}
    </div>
  );
};

export default GlassDatePicker;