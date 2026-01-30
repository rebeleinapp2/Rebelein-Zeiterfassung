import React, { useState, useEffect, Suspense } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Session } from '@supabase/supabase-js';
import { supabase } from './services/supabaseClient';
import GlassLayout from './components/GlassLayout';
import BottomNav from './components/BottomNav';
import AuthPage from './pages/AuthPage';

// Lazy Loading: Seiten werden erst geladen, wenn sie wirklich gebraucht werden.
// Das reduziert die initiale Bundle-Größe und verbessert die Startzeit auf iOS.
const EntryPage = React.lazy(() => import('./pages/EntryPage'));
const HistoryPage = React.lazy(() => import('./pages/HistoryPage'));
const AnalysisPage = React.lazy(() => import('./pages/AnalysisPage'));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage'));
const OfficeDashboard = React.lazy(() => import('./pages/OfficeDashboard'));
const OfficeUserListPage = React.lazy(() => import('./pages/OfficeUserListPage'));
const OfficeUserPage = React.lazy(() => import('./pages/OfficeUserPage'));
const AdvancedAnalysisPage = React.lazy(() => import('./pages/AdvancedAnalysisPage'));

// Ladekomponente für den Seitenübergang
const PageLoader = () => (
  <div className="flex items-center justify-center h-full text-white/30">
    <div className="flex flex-col items-center gap-3">
      <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
      <span className="text-sm">Lade Seite...</span>
    </div>
  </div>
);

const App: React.FC = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Service Worker State
  // Einfache Service Worker Registrierung ohne Auto-Update-Zwang
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(() => {
        console.log('Service Worker registered');
      });
    }
  }, []);

  useEffect(() => {
    const initSession = async () => {
      try {
        // Create a timeout promise that rejects after 2 seconds
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Session check timed out')), 2000)
        );

        // Race between session check and timeout
        const { data, error } = await Promise.race([
          supabase.auth.getSession(),
          timeoutPromise
        ]) as any;

        if (error) throw error;

        if (data && data.session) {
          setSession(data.session);
        }
      } catch (err) {
        console.error("Fehler beim Laden der Session (oder Timeout):", err);
        // On timeout or error, we just proceed as unauthenticated (show login)
        // instead of hanging forever.
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
      </GlassLayout>
    );
  }

  return (
    <Router>
      <GlassLayout>
        <div className="flex-1 h-full overflow-hidden relative">
          {/* Suspense-Boundary: Zeigt PageLoader während Lazy-Komponenten geladen werden */}
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<EntryPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/analysis" element={<AnalysisPage />} />
              <Route path="/settings" element={<SettingsPage />} />

              {/* Office Routes - werden erst geladen, wenn sie wirklich gebraucht werden */}
              <Route path="/office" element={<OfficeDashboard />} />
              <Route path="/office/users" element={<OfficeUserListPage />} />
              <Route path="/office/user/:userId" element={<OfficeUserPage />} />
              <Route path="/office/analysis" element={<AdvancedAnalysisPage />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
        <BottomNav />
      </GlassLayout>
    </Router>
  );
};

export default App;