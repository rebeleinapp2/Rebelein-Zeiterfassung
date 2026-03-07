import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'warning' | 'default';
    onConfirm: () => void;
    onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    isOpen,
    title,
    message,
    confirmLabel = 'Bestätigen',
    cancelLabel = 'Abbrechen',
    variant = 'default',
    onConfirm,
    onCancel
}) => {
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onCancel();
            } else if (e.key === 'Enter') {
                onConfirm();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onCancel, onConfirm]);

    if (!isOpen) return null;

    const colors = {
        danger: { bg: 'from-red-900/30', icon: 'text-red-400', btn: 'bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30' },
        warning: { bg: 'from-orange-900/30', icon: 'text-orange-400', btn: 'bg-orange-500/20 text-orange-300 border-orange-500/30 hover:bg-orange-500/30' },
        default: { bg: 'from-teal-900/30', icon: 'text-teal-400', btn: 'bg-teal-500/20 text-teal-300 border-teal-500/30 hover:bg-teal-500/30' },
    };
    const c = colors[variant];

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
            <div
                ref={dialogRef}
                className={`w-full max-w-sm rounded-2xl border border-white/10 bg-gradient-to-b ${c.bg} to-slate-900/95 shadow-2xl ring-1 ring-white/10 overflow-hidden`}
            >
                <div className="p-5">
                    <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-full bg-white/5 ${c.icon}`}>
                            <AlertTriangle size={20} />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-white font-bold text-base mb-1">{title}</h3>
                            <p className="text-white/60 text-sm leading-relaxed">{message}</p>
                        </div>
                        <button onClick={onCancel} className="text-white/30 hover:text-white p-1 hover:bg-white/10 rounded-full transition-colors">
                            <X size={18} />
                        </button>
                    </div>
                </div>
                <div className="flex gap-3 p-4 bg-black/20 border-t border-white/5">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white/50 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold border transition-colors ${c.btn}`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmDialog;
