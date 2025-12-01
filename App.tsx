import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Session } from '@supabase/supabase-js';
import { supabase } from './services/supabaseClient';
import GlassLayout from './components/GlassLayout';
import BottomNav from './components/BottomNav';
import EntryPage from './pages/EntryPage';
import HistoryPage from './pages/HistoryPage';
import AnalysisPage from './pages/AnalysisPage';
import SettingsPage from './pages/SettingsPage';
import AuthPage from './pages/AuthPage';
import OfficeDashboard from './pages/OfficeDashboard';
import OfficeUserPage from './pages/OfficeUserPage';
import AdvancedAnalysisPage from './pages/AdvancedAnalysisPage';
import { UpdateNotification } from './components/UpdateNotification';
import { InstallPrompt } from './components/InstallPrompt';

// Wrapper component to handle route changes for SW updates
const ServiceWorkerUpdater: React.FC<{ registration: ServiceWorkerRegistration | null }> = ({ registration }) => {
    const location = useLocation();

    useEffect(() => {
        if (registration) {
            // Check for updates on every route change
            console.log('Route changed, checking for PWA updates...');
            registration.update().catch(err => console.error("SW Update check failed:", err));
        }
    }, [location, registration]);

    // Periodische Überprüfung alle 60 Minuten
    useEffect(() => {
        if (!registration) return;
        const interval = setInterval(() => {
            console.log("Checking for SW updates (interval)...");
            registration.update().catch(err => console.error("Auto-Update check failed:", err));
        }, 60 * 60 * 1000); // 1 Stunde
        return () => clearInterval(interval);
    }, [registration]);

    return null;
};

const App: React.FC = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Service Worker State
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [showUpdateParams, setShowUpdateParams] = useState(false);

  // 1. Service Worker Registration & Listener
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((registration) => {
        console.log('Service Worker registered with scope:', registration.scope);
        setSwRegistration(registration);

        // Check if there is already a waiting worker (update ready but not active)
        if (registration.waiting) {
            console.log('Service Worker: Update waiting immediately on load');
            setWaitingWorker(registration.waiting);
            setShowUpdateParams(true);
        }

        // Listen for new updates found
        registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            console.log('Service Worker: Update found, installing...');
            if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        // New update available
                        console.log('Service Worker: New version installed and waiting');
                        setWaitingWorker(newWorker);
                        setShowUpdateParams(true);
                    }
                });
            }
        });
      }).catch(err => console.log('Service Worker registration failed: ', err));

      // Ensure refresh when new SW takes control
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!refreshing) {
              window.location.reload();
              refreshing = true;
          }
      });
    }
  }, []);

  const handleUpdateApp = () => {
      if (waitingWorker) {
          console.log('User clicked update, skipping waiting...');
          waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      }
  };

  useEffect(() => {
    const initSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        setSession(data.session);
      } catch (err) {
        console.error("Fehler beim Laden der Session:", err);
      } finally {
        setLoading(false);
      }
    };

    initSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <GlassLayout>
        <div className="flex flex-col items-center justify-center h-full text-white/50 gap-4">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm">Lade App...</span>
        </div>
      </GlassLayout>
    );
  }

  if (!session) {
    return (
      <GlassLayout>
         <AuthPage />
         {showUpdateParams && <UpdateNotification onUpdate={handleUpdateApp} />}
         {!showUpdateParams && <InstallPrompt />}
      </GlassLayout>
    );
  }

  return (
    <Router>
      <ServiceWorkerUpdater registration={swRegistration} />
      <GlassLayout>
        <div className="flex-1 h-full overflow-hidden relative">
          <Routes>
            <Route path="/" element={<EntryPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            
            {/* Office Routes */}
            <Route path="/office" element={<OfficeDashboard />} />
            <Route path="/office/users" element={<OfficeDashboard />} /> 
            <Route path="/office/user/:userId" element={<OfficeUserPage />} />
            <Route path="/office/analysis" element={<AdvancedAnalysisPage />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <BottomNav />
        {/* Global Update Notification & Install Prompt */}
        {showUpdateParams && <UpdateNotification onUpdate={handleUpdateApp} />}
        {!showUpdateParams && <InstallPrompt />}
      </GlassLayout>
    </Router>
  );
};

export default App;