import React, { ReactNode } from 'react';


interface GlassLayoutProps {
  children: ReactNode;
}

const GlassLayout: React.FC<GlassLayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen w-full relative bg-gray-900 text-white overflow-hidden selection:bg-teal-500/30 flex flex-col">
      <style>{`
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .animate-pulse-slow {
          animation: pulse-slow 8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>

      {/* Dynamic Background Gradient Blobs */}
      <div className="fixed top-[-10%] left-[-10%] w-[50%] h-[50%] bg-emerald-600/40 rounded-full blur-[120px] animate-pulse-slow pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-teal-600/40 rounded-full blur-[120px] animate-pulse-slow pointer-events-none" style={{ animationDelay: '2s' }} />
      <div className="fixed top-[20%] right-[20%] w-[40%] h-[40%] bg-cyan-600/30 rounded-full blur-[100px] animate-pulse-slow pointer-events-none" style={{ animationDelay: '4s' }} />



      {/* Main Content Container 
          REMOVED: transition-all duration-300 to fix fixed positioning context bugs on mobile
      */}
      <SidebarAwareContainer>
        <div className="w-full md:max-w-7xl mx-auto h-full flex flex-col relative">
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

  React.useEffect(() => {
    const handleToggle = () => {
      setIsExpanded(localStorage.getItem('sidebarExpanded') === 'true');
    };
    window.addEventListener('sidebar-toggle', handleToggle);
    return () => window.removeEventListener('sidebar-toggle', handleToggle);
  }, []);

  return (
    <div className={`relative z-10 w-full h-full min-h-screen flex flex-col transition-[padding] duration-300 ease-in-out ${isExpanded ? 'md:pl-64' : 'md:pl-24'}`}>
      {children}
    </div>
  );
};

export default GlassLayout;