
import React, { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { GlassCard, GlassButton } from './GlassCard';
import { DownloadCloud, RefreshCw, AlertTriangle, X } from 'lucide-react';

export const ReloadPrompt: React.FC = () => {
    // interval for checking updates (10 minutes)
    const intervalMS = 10 * 60 * 1000;

    const {
        offlineReady: [offlineReady, setOfflineReady],
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisteredSW(swUrl, r) {
            console.log(`Service Worker registered: ${swUrl}`);

            // Setup periodic update check
            if (r) {
                setInterval(() => {
                    console.log('Checking for Service Worker update...');
                    r.update();
                }, intervalMS);
            }
        },
        onRegisterError(error) {
            console.error('SW registration error', error);
        },
    });

    const close = () => {
        setOfflineReady(false);
        setNeedRefresh(false);
    };

    // If nothing to show, render nothing
    if (!offlineReady && !needRefresh) return null;

    return (
        <div className="fixed bottom-20 md:bottom-8 right-4 left-4 md:left-auto md:max-w-sm z-[9999] animate-in slide-in-from-bottom-5 fade-in duration-300">
            <GlassCard className="!p-0 border-l-4 border-l-emerald-500 overflow-hidden shadow-[0_0_30px_rgba(16,185,129,0.2)]">
                <div className="p-4 flex items-start gap-3 bg-card backdrop-blur-xl">
                    <div className="mt-1 shrink-0">
                        {needRefresh ? (
                            <DownloadCloud className="text-emerald-500 animate-bounce" size={24} />
                        ) : (
                            <AlertTriangle className="text-amber-500" size={24} />
                        )}
                    </div>

                    <div className="flex-1">
                        <h3 className="font-bold text-foreground text-sm">
                            {needRefresh ? 'Update verfügbar!' : 'Bereit zur Offline-Nutzung'}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed mb-3">
                            {needRefresh
                                ? 'Eine neue Version der App ist verfügbar. Klicke auf "Aktualisieren", um die neuesten Funktionen zu laden.'
                                : 'Die App wurde gecached und kann nun auch offline verwendet werden.'}
                        </p>

                        <div className="flex gap-2">
                            {needRefresh && (
                                <GlassButton
                                    onClick={() => updateServiceWorker(true)}
                                    className="!bg-emerald-600 hover:!bg-emerald-500 !text-foreground !text-xs !py-1.5 h-auto flex-1 justify-center flex gap-2 items-center"
                                >
                                    <RefreshCw size={12} /> Aktualisieren
                                </GlassButton>
                            )}
                            <button
                                onClick={close}
                                className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors border border-border rounded-lg hover:bg-muted"
                            >
                                Schließen
                            </button>
                        </div>
                    </div>

                    <button onClick={close} className="text-muted-foreground hover:text-muted-foreground transition-colors">
                        <X size={16} />
                    </button>
                </div>
            </GlassCard>
        </div>
    );
};
