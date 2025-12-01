import React, { useState, useEffect } from 'react';
import { GlassCard, GlassButton } from './GlassCard';
import { Download, X } from 'lucide-react';

export const InstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Check if app is already running in standalone mode (installed)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                         // @ts-ignore
                         (window.navigator.standalone === true);

    if (isStandalone) {
        console.log("App is running in standalone mode. Hiding install prompt.");
        return;
    }

    // 1. Check if the event was already captured in index.html script
    // @ts-ignore
    if (window.deferredInstallPrompt) {
        console.log("Found cached install prompt");
        // @ts-ignore
        setDeferredPrompt(window.deferredInstallPrompt);
        setShow(true);
    }

    // 2. Also listen for the event if it happens later
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // @ts-ignore
      window.deferredInstallPrompt = e; // Sync global
      setShow(true);
      console.log("Install prompt event fired in component");
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    // Zeige den nativen Prompt
    deferredPrompt.prompt();

    // Warte auf die Entscheidung des Nutzers
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
    } else {
      console.log('User dismissed the install prompt');
    }

    // Event kann nur einmal genutzt werden, daher reset
    setDeferredPrompt(null);
    // @ts-ignore
    window.deferredInstallPrompt = null;
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-20 md:bottom-8 right-4 left-4 md:left-auto md:max-w-sm z-[290] animate-in slide-in-from-bottom-4 duration-500">
      <GlassCard className="!bg-blue-900/90 !border-blue-500/50 shadow-[0_0_30px_rgba(59,130,246,0.3)] backdrop-blur-xl relative">
        <button 
            onClick={() => setShow(false)} 
            className="absolute top-2 right-2 p-1 text-white/50 hover:text-white transition-colors"
        >
            <X size={16} />
        </button>
        <div className="flex items-start gap-4">
          <div className="bg-blue-500/20 p-3 rounded-full text-blue-300">
            <Download size={24} />
          </div>
          <div className="flex-1 pr-4">
            <h3 className="text-white font-bold text-lg">App installieren</h3>
            <p className="text-blue-100/70 text-xs mt-1 mb-3">
              Installiere die App auf deinem Startbildschirm für den schnellsten Zugriff und Offline-Funktionen.
            </p>
            <GlassButton 
              onClick={handleInstallClick}
              className="!py-2 !text-sm flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-400 hover:to-cyan-400"
            >
              Jetzt installieren
            </GlassButton>
          </div>
        </div>
      </GlassCard>
    </div>
  );
};