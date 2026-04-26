
import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { GlassCard, GlassInput, GlassButton } from '../components/GlassCard';
import { Lock, Mail, LogIn, UserPlus, AlertCircle, User } from 'lucide-react';

const AuthPage: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMsg(null);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else {
        // Registration
        if (!displayName.trim()) {
            throw new Error("Bitte gib einen Anzeigenamen ein.");
        }

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName, // Save display name in user metadata
            }
          }
        });
        if (error) throw error;
        setMsg("Registrierung erfolgreich! Bitte prüfe jetzt dein E-Mail-Postfach und klicke auf den Bestätigungslink.");
        setIsLogin(true); // Switch to login view
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes("Invalid login credentials")) {
        setError("Login fehlgeschlagen. Ist das Passwort falsch oder hast du deine E-Mail noch nicht bestätigt?");
      } else {
        setError(err.message || "Ein unbekannter Fehler ist aufgetreten.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col justify-center h-full p-6">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 to-teal-200">
          Zeiterfassung
        </h1>
        <p className="text-muted-foreground mt-2">Deine Zeit. Deine Kontrolle.</p>
      </div>

      <GlassCard>
        <div className="flex justify-center mb-6 border-b border-border pb-4">
          <button
            onClick={() => { setIsLogin(true); setError(null); setMsg(null); }}
            className={`mx-4 pb-1 text-sm font-medium transition-colors ${
              isLogin ? 'text-teal-400 border-b-2 border-teal-400' : 'text-muted-foreground'
            }`}
          >
            Anmelden
          </button>
          <button
            onClick={() => { setIsLogin(false); setError(null); setMsg(null); }}
            className={`mx-4 pb-1 text-sm font-medium transition-colors ${
              !isLogin ? 'text-teal-400 border-b-2 border-teal-400' : 'text-muted-foreground'
            }`}
          >
            Registrieren
          </button>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          
          {!isLogin && (
             <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-center gap-2 text-teal-200 mb-2 text-xs uppercase tracking-wider font-bold">
                  <User size={14} /> Anzeigename
                </div>
                <GlassInput
                  type="text"
                  name="displayName"
                  placeholder="Max Mustermann"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required={!isLogin}
                />
             </div>
          )}

          <div>
            <div className="flex items-center gap-2 text-teal-200 mb-2 text-xs uppercase tracking-wider font-bold">
              <Mail size={14} /> Email
            </div>
            <GlassInput
              type="email"
              name="email"
              autoComplete="email"
              placeholder="name@beispiel.de"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
             <div className="flex items-center gap-2 text-teal-200 mb-2 text-xs uppercase tracking-wider font-bold">
              <Lock size={14} /> Passwort
            </div>
            <GlassInput
              type="password"
              name="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-500/50 p-3 rounded-lg text-red-200 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {msg && (
            <div className="bg-emerald-500/20 border border-emerald-500/50 p-3 rounded-lg text-emerald-200 text-sm">
              {msg}
            </div>
          )}

          <GlassButton type="submit" disabled={loading} className="mt-4 flex items-center justify-center gap-2">
            {loading ? 'Lade...' : isLogin ? <><LogIn size={18}/> Einloggen</> : <><UserPlus size={18}/> Account erstellen</>}
          </GlassButton>
        </form>
      </GlassCard>
    </div>
  );
};

export default AuthPage;
