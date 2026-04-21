import React, { useState, useEffect } from 'react';
import { Clock, CheckCircle } from 'lucide-react';

interface SubmissionTimerProps {
  entryDate: string; // ISO YYYY-MM-DD
  submitted: boolean;
  isAbsence?: boolean;
}

export const SubmissionTimer: React.FC<SubmissionTimerProps> = ({ entryDate, submitted, isAbsence }) => {
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    if (submitted) return;

    const calculateTimeLeft = () => {
      // Deadline ist Beginn des Eintragungstages + 2 Tage (48 Stunden)
      // Beispiel: Eintrag 07.04. -> Start 07.04. 00:00 -> Ende 08.04. 23:59:59 (entspricht 09.04. 00:00)
      const entryStart = new Date(entryDate + 'T00:00:00');
      const deadline = new Date(entryStart.getTime() + 2 * 24 * 60 * 60 * 1000);
      const now = new Date();
      const diff = deadline.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft('Abgelaufen');
        setIsExpired(true);
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(timer);
  }, [entryDate, submitted]);

  if (submitted || (isAbsence && isExpired)) {
    return (
      <div className="flex items-center gap-1.5 text-emerald-400/80 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
        <CheckCircle size={10} />
        <span>Abgegeben</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border transition-colors ${
      isExpired ? 'text-red-400 bg-red-500/10 border-red-500/20' : 'text-orange-300 bg-orange-500/10 border-orange-500/20'
    }`}>
      <Clock size={10} className={isExpired ? '' : 'animate-pulse'} />
      <span>{isExpired ? 'Auto-Abgabe...' : `Abgabe in: ${timeLeft}`}</span>
    </div>
  );
};
