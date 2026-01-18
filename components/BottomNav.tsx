
import React from 'react';
import { PlusCircle, Calendar, PieChart, Settings, LogOut, LayoutDashboard, Users, Presentation, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSettings } from '../services/dataService';

const BottomNav: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { settings, logout } = useSettings();

    // SIDEBAR EXPANSION STATE (PERSISTED)
    const [isExpanded, setIsExpanded] = React.useState(() => {
        return localStorage.getItem('sidebarExpanded') === 'true';
    });

    const toggleSidebar = () => {
        const newState = !isExpanded;
        setIsExpanded(newState);
        localStorage.setItem('sidebarExpanded', String(newState));
        window.dispatchEvent(new Event('sidebar-toggle'));
    };

    // Check Role
    const isOfficeOrAdmin = settings.role === 'admin' || settings.role === 'office';

    const NavItem = ({ path, icon: Icon, label, onClick, colorClass }: { path?: string; icon: any; label: string; onClick?: () => void, colorClass?: string }) => {
        const isActive = path ? location.pathname === path : false;

        const handleClick = () => {
            if (onClick) onClick();
            else if (path) navigate(path);
        };

        return (
            <button
                type="button"
                onClick={handleClick}
                className={`group flex items-center transition-all duration-300 relative cursor-pointer
            ${/* Mobile Styles (unchanged) */ ''}
            flex-col w-full h-full md:flex-row md:h-12 md:rounded-xl md:px-3 md:gap-3
            ${/* Desktop Styles */ ''}
            ${isActive ? 'text-teal-400 bg-white/5' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}
            ${colorClass && !isActive ? colorClass : ''}
            ${!isExpanded ? 'md:justify-center' : 'md:justify-start'}
        `}
                title={!isExpanded ? label : undefined}
            >
                <Icon size={24} strokeWidth={isActive ? 2.5 : 1.5} className="transition-transform group-hover:scale-110 flex-shrink-0" />

                {/* Mobile Label */}
                <span className="text-[10px] mt-1 font-medium md:hidden">{label}</span>

                {/* Desktop Label (Only if Expanded) */}
                {isExpanded && (
                    <span className="hidden md:block text-sm font-medium whitespace-nowrap animate-in fade-in slide-in-from-left-2 duration-300">
                        {label}
                    </span>
                )}

                {/* Desktop Tooltip / Indicator (Only if Collapsed) */}
                {isActive && !isExpanded && <div className="hidden md:block absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-teal-400 rounded-r-full" />}
                {/* Desktop Active Indicator (If Expanded) */}
                {isActive && isExpanded && <div className="hidden md:block absolute right-2 w-2 h-2 bg-teal-400 rounded-full" />}
            </button>
        );
    };

    return (
        <>
            {/* MOBILE: Bottom Navigation */}
            <div className="fixed bottom-0 left-0 w-full z-[100] flex justify-center pb-4 pointer-events-none md:hidden">
                <div className="w-full pointer-events-auto">
                    <div className="mx-4 mb-2 bg-gray-900/80 backdrop-blur-xl border border-white/10 rounded-2xl h-16 shadow-2xl flex justify-between items-center px-2">
                        <NavItem path="/" icon={PlusCircle} label="Erfassen" />
                        <NavItem path="/history" icon={Calendar} label="Verlauf" />

                        {/* Office Modules Mobile */}
                        {isOfficeOrAdmin && (
                            <>
                                <NavItem path="/office" icon={LayoutDashboard} label="Büro" colorClass="text-orange-400/70" />
                                <NavItem path="/office/users" icon={Users} label="Benutzer" colorClass="text-orange-400/70" />
                            </>
                        )}

                        <NavItem path="/analysis" icon={PieChart} label="Analyse" />
                        <NavItem path="/settings" icon={Settings} label="Optionen" />
                    </div>
                </div>
            </div>

            {/* DESKTOP: Sidebar Navigation */}
            <div className={`hidden md:flex fixed top-0 left-0 h-full flex-col z-50 pointer-events-auto transition-all duration-300 ease-in-out ${isExpanded ? 'w-64' : 'w-24'}`}>
                {/* Glass Container for Sidebar */}
                <div className={`absolute inset-y-4 left-4 bg-gray-900/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col py-6 gap-6 transition-all duration-300 ${isExpanded ? 'w-[calc(100%-1rem)] px-4 items-start' : 'w-16 items-center'}`}>

                    {/* Header / Logo / Toggle */}
                    <div className={`w-full flex items-center mb-2 ${isExpanded ? 'justify-between' : 'justify-center flex-col gap-4'}`}>
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-500 shadow-[0_0_15px_rgba(20,184,166,0.5)] flex-shrink-0" />
                        {isExpanded && <span className="font-bold text-lg text-white tracking-wide">Stunden</span>}

                        <button
                            onClick={toggleSidebar}
                            className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors"
                        >
                            {isExpanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                        </button>
                    </div>

                    {/* Nav Items */}
                    <div className="flex flex-col gap-2 w-full flex-1 overflow-y-auto overflow-x-hidden">
                        <NavItem path="/" icon={PlusCircle} label="Erfassen" />
                        <NavItem path="/history" icon={Calendar} label="Verlauf" />
                        <NavItem path="/analysis" icon={PieChart} label="Analyse" />
                        <NavItem path="/settings" icon={Settings} label="Optionen" />

                        {/* Office Modules Desktop Separator */}
                        {isOfficeOrAdmin && (
                            <div className="w-full h-px bg-white/10 my-2" />
                        )}

                        {isOfficeOrAdmin && (
                            <>
                                <NavItem path="/office" icon={LayoutDashboard} label="Dashboard" colorClass="text-orange-400/70" />
                                <NavItem path="/office/users" icon={Users} label="Benutzer" colorClass="text-orange-400/70" />
                                <NavItem path="/office/analysis" icon={Presentation} label="Profi-Auswertung" colorClass="text-purple-400/70" />
                            </>
                        )}
                    </div>

                    <div className="mt-auto w-full">
                        <button
                            onClick={logout}
                            className={`flex items-center rounded-xl transition-all h-10 hover:text-red-400 hover:bg-red-500/10 text-white/30 ${isExpanded ? 'w-full px-3 gap-3 justify-start' : 'w-10 justify-center'}`}
                            title="Abmelden"
                        >
                            <LogOut size={20} />
                            {isExpanded && <span className="text-sm font-medium">Abmelden</span>}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};

export default BottomNav;
