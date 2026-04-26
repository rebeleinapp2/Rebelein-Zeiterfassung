
import React from 'react';
import { GlassCard, GlassButton } from './GlassCard';
import { DownloadCloud, RefreshCw } from 'lucide-react';

interface UpdateNotificationProps {
  onUpdate: () => void;
}

export const UpdateNotification: React.FC<UpdateNotificationProps> = ({ onUpdate }) => {
  return (
    <div className="fixed bottom-20 md:bottom-8 right-4 left-4 md:left-auto md:max-w-sm z-[300] animate-in slide-in-from-bottom-4 duration-500">
      <GlassCard className="!bg-teal-900/80 !border-teal-500/50 shadow-[0_0_30px_rgba(20,184,166,0.3)] backdrop-blur-xl">
        <div className="flex items-start gap-4">
          <div className="bg-teal-500/20 p-3 rounded-full text-teal-300 animate-pulse">
            <DownloadCloud size={24} />
          </div>
          <div className="flex-1">
            <h3 className="text-foreground font-bold text-lg">Update verfügbar</h3>
            <p className="text-teal-100/70 text-xs mt-1 mb-3">
              Eine neue Version der Anwendung wurde heruntergeladen. Bitte aktualisieren, um die neuesten Funktionen zu nutzen.
            </p>
            <GlassButton 
              onClick={onUpdate}
              className="!py-2 !text-sm flex items-center justify-center gap-2 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400"
            >
              <RefreshCw size={16} /> Jetzt aktualisieren
            </GlassButton>
          </div>
        </div>
      </GlassCard>
    </div>
  );
};
