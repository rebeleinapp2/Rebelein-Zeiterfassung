import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react';

// Types
interface Toast {
    id: string;
    message: string;
    variant: 'success' | 'error' | 'info' | 'warning';
    duration?: number;
}

interface ToastContextType {
    showToast: (message: string, variant?: Toast['variant'], duration?: number) => void;
}

// Context
const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within ToastProvider');
    return ctx;
};

// Provider
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((message: string, variant: Toast['variant'] = 'info', duration = 3500) => {
        const id = Math.random().toString(36).slice(2);
        setToasts(prev => [...prev, { id, message, variant, duration }]);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </ToastContext.Provider>
    );
};

// Container
const ToastContainer: React.FC<{ toasts: Toast[]; onRemove: (id: string) => void }> = ({ toasts, onRemove }) => {
    return (
        <div className="fixed top-4 right-4 z-[300] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
            {toasts.map(toast => (
                <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
            ))}
        </div>
    );
};

// Single Toast Item
const ToastItem: React.FC<{ toast: Toast; onRemove: (id: string) => void }> = ({ toast, onRemove }) => {
    const [isExiting, setIsExiting] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            setIsExiting(true);
            setTimeout(() => onRemove(toast.id), 300);
        }, toast.duration || 3500);
        return () => clearTimeout(timer);
    }, [toast, onRemove]);

    const icons = {
        success: <CheckCircle size={18} className="text-emerald-400" />,
        error: <AlertTriangle size={18} className="text-red-400" />,
        warning: <AlertTriangle size={18} className="text-orange-400" />,
        info: <Info size={18} className="text-blue-400" />,
    };

    const borders = {
        success: 'border-emerald-500/30 bg-emerald-500/5',
        error: 'border-red-500/30 bg-red-500/5',
        warning: 'border-orange-500/30 bg-orange-500/5',
        info: 'border-blue-500/30 bg-blue-500/5',
    };

    return (
        <div
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl shadow-2xl transition-all duration-300 ${borders[toast.variant]} ${isExiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0 animate-in slide-in-from-right-4'
                }`}
        >
            {icons[toast.variant]}
            <p className="text-sm text-white font-medium flex-1">{toast.message}</p>
            <button
                onClick={() => {
                    setIsExiting(true);
                    setTimeout(() => onRemove(toast.id), 300);
                }}
                className="text-white/30 hover:text-white transition-colors p-0.5"
            >
                <X size={14} />
            </button>
        </div>
    );
};

export default ToastProvider;
