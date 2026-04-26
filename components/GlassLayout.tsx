import React, { ReactNode } from 'react';

interface GlassLayoutProps {
  children: ReactNode;
}

const GlassLayout: React.FC<GlassLayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen w-full relative bg-background text-foreground overflow-hidden font-sans flex flex-col">
      {/* Decorative Floating Blobs (Behind everything) */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[45%] h-[45%] bg-primary/10 rounded-full blur-[120px] animate-blob" />
        <div className="absolute bottom-[10%] right-[-5%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[100px] animate-blob animation-delay-2000" />
        <div className="absolute top-[40%] left-[30%] w-[35%] h-[35%] bg-purple-500/10 rounded-full blur-[110px] animate-blob animation-delay-4000" />
      </div>

      <style>{`
        /* Custom Scrollbar for the main content area */
        .glass-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .glass-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .glass-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .glass-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>

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
    return typeof window !== 'undefined' ? window.location.hash.includes('/office') : false;
  });

  React.useEffect(() => {
    const handleToggle = () => {
      setIsExpanded(localStorage.getItem('sidebarExpanded') === 'true');
    };
    const handleHash = () => {
      setIsFullWidth(window.location.hash.includes('/office'));
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
      <div className={`w-full h-full mx-auto ${isFullWidth ? 'max-w-[1800px] px-4 md:px-6 lg:px-8' : 'md:max-w-7xl px-0 md:px-4 lg:px-8'} flex-1 flex flex-col`}>
        {children}
      </div>
    </div>
  );
};

export default GlassLayout;