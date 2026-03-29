import React, { ReactNode } from 'react';

interface GlassLayoutProps {
  children: ReactNode;
}

const GlassLayout: React.FC<GlassLayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen w-full relative bg-slate-950 text-slate-100 overflow-hidden selection:bg-teal-500/30 font-sans flex flex-col">
      <style>{`
        /* Dynamic Mesh Gradient Animation */
        /* Dynamic Mesh Gradient Animation REMOVED for Performance */
        


        /* Custom Scrollbar for the main content area */
        .glass-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .glass-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.02);
        }
        .glass-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .glass-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>

      {/* PERFORMANCE FIX: 
         Statt echter <div> Blobs mit Blur-Filter nutzen wir einen einzigen CSS-Hintergrund.
         Das sieht fast genauso aus, kostet aber 0% Leistung.
      */}
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(circle at 90% 10%, rgba(20, 184, 166, 0.15) 0%, transparent 40%),
            radial-gradient(circle at 10% 90%, rgba(5, 150, 105, 0.15) 0%, transparent 40%),
            linear-gradient(to bottom right, #0f172a, #020617)
          `
        }}
      />

      {/* Main Content Container */}
      <SidebarAwareContainer>
        <div className="relative z-10 w-full h-full flex flex-col pointer-events-auto">
          {children}
        </div>
      </SidebarAwareContainer>
    </div>
  );
};

// Internal component to handle sidebar state to avoid re-rendering the whole layout unecessarily
const SidebarAwareContainer: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isExpanded, setIsExpanded] = React.useState(() => {
    return typeof window !== 'undefined' ? localStorage.getItem('sidebarExpanded') === 'true' : false;
  });

  const [isFullWidth, setIsFullWidth] = React.useState(() => {
    return typeof window !== 'undefined' ? window.location.hash.includes('/office/analysis') : false;
  });

  React.useEffect(() => {
    const handleToggle = () => {
      setIsExpanded(localStorage.getItem('sidebarExpanded') === 'true');
    };
    const handleHash = () => {
      setIsFullWidth(window.location.hash.includes('/office/analysis'));
    };

    // Initial check
    handleHash();

    window.addEventListener('sidebar-toggle', handleToggle);
    window.addEventListener('hashchange', handleHash);
    
    return () => {
      window.removeEventListener('sidebar-toggle', handleToggle);
      window.removeEventListener('hashchange', handleHash);
    };
  }, []);

  return (
    <div className={`relative z-10 w-full h-full min-h-screen flex flex-col transition-[padding] duration-300 ease-in-out ${isExpanded ? 'md:pl-64' : 'md:pl-24'}`}>
      {/* Max width container for large screens to prevent stretching, disabled on fullWidth routes */}
      <div className={`w-full h-full mx-auto ${isFullWidth ? '' : 'md:max-w-7xl px-0 md:px-4 lg:px-8'} flex-1 flex flex-col`}>
        {children}
      </div>
    </div>
  );
};

export default GlassLayout;